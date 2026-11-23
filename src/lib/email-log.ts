// Settings → Emails: the hotel's customer-email log, for managers. Read through
// row-level security (email_outbox_select, migration 017): only this hotel's
// rows, managers only. The stored copy never contains the private link.
// No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'

export type EmailLogRow = {
  id: number
  created_at: string
  sent_at: string | null
  template: string
  status: string
  recipient: string
  subject: string | null
  body_text: string | null
  attempts: number
  last_error: string | null
  reference: string
}

export const EMAIL_TEMPLATE_LABEL: Record<string, string> = {
  received: 'Report received',
  under_review: 'Under review',
  contact_required: 'Contact required',
  staff_message: 'New message',
  matched: 'Matched',
  closed: 'Closed',
  resolved: 'Resolved',
}

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  queued: 'Waiting to send',
  sending: 'Sending',
  retry: 'Will retry',
  sent: 'Sent',
  previewed: 'Preview only (not sent)',
  skipped: 'Not sent (not on the staging allowlist)',
  suppressed: 'Not sent (address bounced before)',
  failed: 'Failed',
  expired: 'Not sent (too old)',
}

/** a.guest@example.com → a••••t@example.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return '••••'
  return user.length <= 2 ? `${user[0] ?? ''}•@${domain}` : `${user[0]}••••${user.at(-1)}@${domain}`
}

export async function loadEmailLog(tx: Tx, limit = 50): Promise<EmailLogRow[]> {
  const { rows } = await tx.query<EmailLogRow>(
    `select o.id::float8 as id, o.created_at, o.sent_at, o.template, o.status, o.recipient, o.subject, o.body_text,
            o.attempts, o.last_error, r.reference
       from public.email_outbox o join public.customer_requests r on r.id = o.request_id
      order by o.id desc limit $1`,
    [Math.min(Math.max(limit, 1), 200)]
  )
  return rows
}

// The email sender's heartbeat (migration 025): when scripts/email-dispatch.mjs
// last ran against THIS database, and how many emails are waiting. If the
// sender reads another database (or stopped), emails wait here silently; this
// makes that visible on Settings → Customer emails.

/** The sender runs every 5 minutes; after 15 without a run it is "late". */
export const SENDER_LATE_MINUTES = 15

export type SenderHeartbeat = { finishedAt: Date | null; ok: boolean; mode: string | null; waiting: number; oldestWaiting: Date | null }
export type SenderStatus = { state: 'ok' | 'late' | 'never' | 'off'; text: string }

export function senderStatus(h: SenderHeartbeat, now: Date = new Date()): SenderStatus {
  const waiting = h.waiting === 1 ? '1 email is waiting' : `${h.waiting} emails are waiting`
  if (!h.finishedAt) {
    return { state: 'never', text: h.waiting
      ? `${waiting}, but the email sender has never run against this hotel’s database. On Railway, check that “email-dispatch” uses the same Postgres service as the website (MIGRATION_DATABASE_URL).`
      : 'The email sender has not run against this hotel’s database yet. On Railway, check that “email-dispatch” uses the same Postgres service as the website (MIGRATION_DATABASE_URL).' }
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - h.finishedAt.getTime()) / 60_000))
  const ago = minutes < 1 ? 'less than a minute ago' : minutes === 1 ? '1 minute ago' : minutes < 120 ? `${minutes} minutes ago` : `${Math.floor(minutes / 60)} hours ago`
  if (minutes > SENDER_LATE_MINUTES) {
    return { state: 'late', text: `The email sender last ran ${ago}${h.waiting ? ` and ${waiting}` : ''}. It should run every 5 minutes: check the “email-dispatch” service on Railway.` }
  }
  if (h.mode && h.mode !== 'live') {
    return { state: 'off', text: `The email sender ran ${ago} in “${h.mode}” mode: customers are not being emailed. Set EMAIL_MODE=live on “email-dispatch”.` }
  }
  if (!h.ok) return { state: 'late', text: `The email sender ran ${ago} but stopped early (Brevo refused the API key). ${h.waiting ? waiting + '.' : ''}` }
  return { state: 'ok', text: `Email sender checked ${ago}.${h.waiting ? ` ${waiting} (next attempt soon).` : ''}` }
}

export async function loadSenderHeartbeat(tx: Tx): Promise<SenderHeartbeat> {
  const { rows } = await tx.query<{ finished_at: Date | string | null; ok: boolean | null; summary: { mode?: string } | null; waiting: number; oldest_waiting: Date | string | null }>(
    'select finished_at, ok, summary, waiting, oldest_waiting from public.last_email_dispatch()')
  const r = rows[0]
  return {
    finishedAt: r?.finished_at ? new Date(r.finished_at) : null,
    ok: r?.ok ?? false,
    mode: r?.summary?.mode ?? null,
    waiting: r?.waiting ?? 0,
    oldestWaiting: r?.oldest_waiting ? new Date(r.oldest_waiting) : null,
  }
}
