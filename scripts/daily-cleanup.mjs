#!/usr/bin/env node
// The daily clean-up (replaces Supabase's pg_cron jobs). Railway runs it once a
// day as a cron service; it can also be run by hand:
//
//   MIGRATION_DATABASE_URL=… node scripts/daily-cleanup.mjs
//
// It calls run_daily_cleanup() in the database (migration 014), which removes
// expired stays, old closed enquiries and expired sign-in records, and records
// the run in ops.job_runs. Lost items and photos are never touched.
//
// Logs in as app_owner (only the owner may run the clean-up). The URL contains
// the password, so it is never printed. Exit code: 0 done, 1 failed, 2 set-up
// problem (variable missing or wrong).
import { fileURLToPath } from 'node:url'

const KINDS = ['stays', 'closed_enquiries', 'sessions', 'verifications', 'rate_limits', 'sign_in_failures']

/** Runs one clean-up on an open connection. Returns the summary; throws on failure. */
export async function runCleanup(db, log = console.log) {
  const who = (await db.query(
    `select current_user as name, r.rolsuper as superuser
       from pg_roles r where r.rolname = current_user`)).rows[0]
  if (who.name !== 'app_owner' || who.superuser) {
    throw new Error(`connected as ${who.name}; the clean-up must log in as app_owner (MIGRATION_DATABASE_URL)`)
  }
  const fn = (await db.query(`select to_regprocedure('public.run_daily_cleanup()') is not null as ok`)).rows[0]
  if (!fn.ok) throw new Error('run_daily_cleanup() does not exist yet: deploy the app first (its pre-deploy step applies migration 014)')
  const summary = (await db.query('select public.run_daily_cleanup() as s')).rows[0].s
  if (!summary.ok) throw new Error(`the clean-up failed in the database (error ${summary.error}); nothing was removed and the failure is recorded`)
  const counts = Object.fromEntries(KINDS.map((k) => [k, summary[k]]))
  log('removed: ' + KINDS.map((k) => `${k.replaceAll('_', ' ')} ${counts[k]}`).join(', '))
  return counts
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is not set (it must log in as app_owner).')
    return 2
  }
  let u
  try {
    u = new URL(url)
  } catch {
    console.error(/@:\d|@\//.test(url)
      ? 'MIGRATION_DATABASE_URL has an EMPTY host name (value not shown). On Railway: check the ${{Service.RAILWAY_PRIVATE_DOMAIN}} reference (service name is case-sensitive).'
      : 'MIGRATION_DATABASE_URL is not a valid postgresql:// URL (value not shown).')
    return 2
  }
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.hostname) {
    console.error('MIGRATION_DATABASE_URL has no host name or is not postgresql:// (value not shown).')
    return 2
  }
  console.log(`daily clean-up ${new Date().toISOString()} on ${u.hostname}${u.pathname} as ${decodeURIComponent(u.username) || '(default user)'}`)
  const { default: pg } = await import('pg')
  const client = new pg.Client({
    connectionString: url,
    application_name: 'returnly-daily-cleanup',
    connectionTimeoutMillis: 15000,
    statement_timeout: 300000,
  })
  try {
    await client.connect()
  } catch (e) {
    console.error(`✗ could not connect to the database (${e.code || 'error'})`)
    return 1
  }
  try {
    await runCleanup(client)
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
