#!/usr/bin/env node
// Sends the customer emails that are due. Railway runs it as the cron service
// `email-dispatch` every 5 minutes; it can also be run by hand:
//
//   MIGRATION_DATABASE_URL=… EMAIL_MODE=preview node scripts/email-dispatch.mjs
//
// Variables (values are never printed):
//   MIGRATION_DATABASE_URL  logs in as app_owner (required)
//   EMAIL_MODE              off | preview | live          (default: off)
//   BREVO_API_KEY           Brevo API key (live only; an API key, not an SMTP key)
//   EMAIL_FROM              sender address, e.g. notifications@foundora.co.uk (live)
//   EMAIL_FROM_NAME         shown after the hotel name: "<Hotel> via Foundora"
//   PUBLIC_BASE_URL         https://… address of the app, for the tracking links
//   EMAIL_ALLOWLIST         comma list of addresses or @domains; on staging, live
//                           mode refuses to start without it
// Exit code: 0 done, 1 failed (database/Brevo), 2 set-up problem.
import { fileURLToPath } from 'node:url'
import { dispatch, allowlistFrom } from './email/dispatch.mjs'
import { sendViaBrevo } from './email/brevo.mjs'

const MODES = ['off', 'preview', 'live']
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

/** Checks the variables; returns the settings or a list of problems (names only, no values). */
export function readConfig(env = process.env) {
  const problems = []
  const mode = (env.EMAIL_MODE || 'off').trim().toLowerCase()
  if (!MODES.includes(mode)) problems.push(`EMAIL_MODE must be one of ${MODES.join(', ')}`)
  const baseUrl = (env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  const fromEmail = (env.EMAIL_FROM || '').trim().toLowerCase()
  const fromName = (env.EMAIL_FROM_NAME || 'Foundora').trim().slice(0, 40)
  const allow = allowlistFrom(env.EMAIL_ALLOWLIST)
  const staging = /staging/i.test(env.RAILWAY_ENVIRONMENT_NAME || '')
  if (mode === 'live') {
    if (!env.BREVO_API_KEY) problems.push('BREVO_API_KEY is not set')
    else if (/^xsmtpsib-/.test(env.BREVO_API_KEY)) problems.push('BREVO_API_KEY is an SMTP key; create an API key in Brevo (SMTP & API → API keys)')
    if (!EMAIL.test(fromEmail)) problems.push('EMAIL_FROM is not a valid address')
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(baseUrl)) problems.push('PUBLIC_BASE_URL must be https://<domain> (no path)')
    if (staging && !allow) problems.push('EMAIL_ALLOWLIST is required for live mode on staging')
  }
  if (mode === 'preview' && baseUrl && !/^https?:\/\//.test(baseUrl)) problems.push('PUBLIC_BASE_URL must start with https://')
  return { problems, mode, baseUrl: baseUrl || 'https://example.invalid', from: { email: fromEmail, name: fromName }, allow, apiKey: env.BREVO_API_KEY }
}

export async function runDispatch(db, cfg, { send = sendViaBrevo, log = console.log } = {}) {
  const who = (await db.query(`select current_user as name, r.rolsuper as superuser from pg_roles r where r.rolname = current_user`)).rows[0]
  if (who.name !== 'app_owner' || who.superuser) {
    throw new Error(`connected as ${who.name}; the email job must log in as app_owner (MIGRATION_DATABASE_URL)`)
  }
  const ready = (await db.query(`select to_regclass('public.email_outbox') is not null as ok`)).rows[0]
  if (!ready.ok) throw new Error('email_outbox does not exist yet: deploy the app first (its pre-deploy step applies migration 017)')
  return dispatch(db, {
    mode: cfg.mode, baseUrl: cfg.baseUrl, from: cfg.from, allow: cfg.allow, log,
    send: (m) => send({ ...m, apiKey: cfg.apiKey }),
  })
}

async function main() {
  const cfg = readConfig()
  if (cfg.problems.length) {
    for (const p of cfg.problems) console.error(`✗ ${p}`)
    return 2
  }
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) { console.error('✗ MIGRATION_DATABASE_URL is not set (it must log in as app_owner).'); return 2 }
  let u
  try { u = new URL(url) } catch {
    console.error(/@:\d|@\//.test(url)
      ? '✗ MIGRATION_DATABASE_URL has an EMPTY host name (value not shown). Check the ${{Service.RAILWAY_PRIVATE_DOMAIN}} reference.'
      : '✗ MIGRATION_DATABASE_URL is not a valid postgresql:// URL (value not shown).')
    return 2
  }
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.hostname) { console.error('✗ MIGRATION_DATABASE_URL has no host name (value not shown).'); return 2 }
  console.log(`email dispatch ${new Date().toISOString()} mode=${cfg.mode}${cfg.allow ? ' (allowlist on)' : ''}`)

  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: url, application_name: 'foundora-email-dispatch', connectionTimeoutMillis: 15000, statement_timeout: 60000 })
  try { await client.connect() } catch (e) { console.error(`✗ could not connect to the database (${e.code || 'error'})`); return 1 }
  try {
    const s = await runDispatch(client, cfg)
    if (s.stopped) return 1
    console.log('✓ done')
    return 0
  } catch (e) {
    console.error(`✗ ${e.code ? `database error ${e.code}` : e.message}`)
    return 1
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main()
}
