// Sends the customer emails that are due (email_outbox, migration 017).
// Runs as app_owner, from scripts/email-dispatch.mjs (Railway cron, every
// 5 minutes). Safe to run twice at once: rows are claimed with SKIP LOCKED
// and a 5-minute lease, so two runs never take the same email.
//
// Modes (EMAIL_MODE):
//   off      do nothing (emails stay queued; anything older than a day expires)
//   preview  render each email and keep a copy for Settings → Emails; send nothing
//   live     send through Brevo; on staging only to EMAIL_ALLOWLIST (others "skipped")
//
// Every email gets its own tracking token (only its SHA-256 is stored). The
// copy kept in the database has the link blanked out.
import { createHash, randomBytes } from 'node:crypto'
import { renderEmail } from './templates.mjs'

export const MAX_ATTEMPTS = 6
const BACKOFF_MIN = [1, 5, 15, 60, 360] // minutes before attempt 2, 3, 4, 5, 6
const sha = (s) => createHash('sha256').update(s).digest('hex')
const LINK_PLACEHOLDER = '[your private tracking link]'

/** "a@b.com, @hotel.example" → a function telling whether an address may be emailed. */
export function allowlistFrom(raw) {
  const items = String(raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!items.length) return null
  return (email) => items.some((i) => (i.startsWith('@') ? email.endsWith(i) : email === i))
}

export function backoffMinutes(attempts) {
  return BACKOFF_MIN[Math.min(Math.max(attempts, 1), BACKOFF_MIN.length) - 1]
}

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db  connected as app_owner
 * @param {{ mode: 'off'|'preview'|'live', baseUrl: string, from: { email: string, name: string },
 *           allow?: ((email: string) => boolean) | null, send?: Function, batch?: number,
 *           log?: (m: string) => void }} opts
 */
export async function dispatch(db, opts) {
  const { mode, baseUrl, from, allow = null, send, batch = 25, log = console.log } = opts
  const summary = { sent: 0, previewed: 0, skipped: 0, retry: 0, failed: 0, expired: 0, stopped: false }

  // Older than a day and never sent: too late to be useful (e.g. while EMAIL_MODE was off).
  summary.expired = (await db.query(
    `update public.email_outbox set status = 'expired', locked_until = null
      where status in ('queued', 'retry') and created_at < now() - interval '1 day' returning id`)).rows.length
  // A run that died mid-send: its lease ran out, so try again.
  await db.query(`update public.email_outbox set status = 'retry', locked_until = null
                   where status = 'sending' and locked_until < now()`)
  if (mode === 'off') {
    log(`EMAIL_MODE is off: nothing sent${summary.expired ? `, ${summary.expired} expired` : ''}`)
    return summary
  }

  const rows = (await db.query(
    `with due as (
       select id from public.email_outbox
        where status in ('queued', 'retry') and next_attempt_at <= now()
        order by id limit $1
        for update skip locked)
     update public.email_outbox o
        set status = 'sending', attempts = o.attempts + 1, locked_until = now() + interval '5 minutes'
       from due where o.id = due.id
     returning o.id, o.request_id, o.template, o.recipient, o.attempts`, [batch])).rows

  for (const row of rows) {
    const r = (await db.query(
      `select r.reference, r.report_type, r.item_name, r.created_at, r.status,
              p.name, p.contact_email, p.contact_phone, p.support_hours, p.slug, p.brand_colour, p.brand_intro,
              p.logo_key, p.logo_version
         from public.customer_requests r join public.properties p on p.id = r.property_id
        where r.id = $1`, [row.request_id])).rows[0]
    if (!r) continue // report deleted meanwhile: the row went with it
    // Branding (migration 019). The logo is linked, not attached; it is served
    // by the app at /brand/<slug>/logo, so it only appears with an https address.
    const hotel = { name: r.name, contactEmail: r.contact_email, contactPhone: r.contact_phone, supportHours: r.support_hours,
      colour: r.brand_colour ?? null, intro: r.brand_intro ?? null,
      logoUrl: r.logo_key && r.slug ? `${baseUrl}/brand/${encodeURIComponent(r.slug)}/logo?v=${r.logo_version}` : null }
    const base = { template: row.template, reportType: r.report_type, reference: r.reference, itemName: r.item_name,
      createdAt: new Date(r.created_at).toISOString(), hotel }
    const sender = `${r.name} via ${from.name} <${from.email}>`
    const keep = renderEmail({ ...base, trackUrl: LINK_PLACEHOLDER })
    const record = async (status, extra = {}) => {
      await db.query(
        `update public.email_outbox set status = $2, locked_until = null, sender = $3, subject = $4, body_text = $5,
                provider = $6, provider_message_id = $7, last_error = $8, sent_at = $9,
                next_attempt_at = coalesce($10, next_attempt_at)
          where id = $1`,
        [row.id, status, sender, keep.subject, keep.text, extra.provider ?? null, extra.messageId ?? null,
         extra.error ?? null, extra.sentAt ?? null, extra.nextAt ?? null])
      summary[status] = (summary[status] ?? 0) + 1
    }

    if (mode === 'preview') { await record('previewed'); continue }
    if (allow && !allow(row.recipient)) { await record('skipped', { error: 'not on EMAIL_ALLOWLIST' }); continue }

    const token = randomBytes(32).toString('hex')
    await db.query(`insert into public.request_access_tokens (request_id, token_hash) values ($1, $2)`, [row.request_id, sha(token)])
    const trackUrl = `${baseUrl}/track?ref=${encodeURIComponent(r.reference)}#t=${token}`
    const mail = renderEmail({ ...base, trackUrl })
    const res = await send({ from: { email: from.email, name: `${r.name} via ${from.name}` }, to: row.recipient,
      subject: mail.subject, html: mail.html, text: mail.text, tag: row.template })

    if (res.ok) {
      await record('sent', { provider: 'brevo', messageId: res.messageId, sentAt: new Date().toISOString() })
      continue
    }
    // A wrong or disabled API key would fail every email: stop, keep them for later.
    const config = /^http_(401|403)/.test(res.code)
    if (!res.permanent || config) {
      if (row.attempts >= MAX_ATTEMPTS) await record('failed', { error: res.code })
      else await record('retry', { error: res.code, nextAt: new Date(Date.now() + backoffMinutes(row.attempts) * 60_000).toISOString() })
      if (config) { summary.stopped = true; log(`✗ Brevo refused the API key (${res.code}): stopping this run`); break }
    } else {
      await record('failed', { error: res.code })
    }
  }
  // Rows claimed but not reached after a stop go back to the queue.
  if (summary.stopped) {
    await db.query(`update public.email_outbox set status = 'retry', locked_until = null
                     where status = 'sending' and id = any(string_to_array($1, ',')::bigint[])`, [rows.map((r) => r.id).join(',')])
  }
  log(`emails: sent ${summary.sent}, previewed ${summary.previewed}, skipped ${summary.skipped}, retry ${summary.retry}, failed ${summary.failed}, expired ${summary.expired}`)
  return summary
}
