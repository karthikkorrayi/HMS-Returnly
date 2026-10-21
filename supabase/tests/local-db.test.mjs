// Run with: npm run test:db  (needs real Postgres: TEST_DATABASE_URL; skipped otherwise)
// scripts/local-db-setup.mjs — the local development database (step A3):
// creates and sets up a database like Railway, is safe to run twice, and
// refuses names, servers and databases it did not make.
import pg from 'pg'
import { setupLocalDb } from '../../scripts/local-db-setup.mjs'

let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const refuses = async (p, re, msg) => {
  try { await p; fail(msg + ' (was accepted)') } catch (e) { check(re.test(e.message), msg, e.message) }
}

const url = process.env.TEST_DATABASE_URL
console.log('Local database setup')
if (!url) {
  console.log('  skip (needs a real local Postgres: set TEST_DATABASE_URL; CI runs this)')
  console.log('\nall checks passed')
  process.exit(0)
}
const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('TEST_DATABASE_URL must be local')

const name = `returnly_test_localdb_${process.pid}`
const foreignName = `returnly_test_foreign_${process.pid}`
const quiet = () => {}
const admin = new pg.Client({ connectionString: url })
await admin.connect()
const one = async (u, sql) => {
  const c = new pg.Client({ connectionString: u })
  await c.connect()
  try { return (await c.query(sql)).rows[0] } finally { await c.end() }
}

try {
  const first = await setupLocalDb({ adminUrl: url, database: name, log: quiet })
  check(first.created, 'first run creates the database')
  const second = await setupLocalDb({ adminUrl: url, database: name, log: quiet })
  check(!second.created, 'second run reuses it without dropping anything')

  const counts = await one(first.urls.MIGRATION_DATABASE_URL, `select
    (select count(*)::int from ops.schema_migrations) as migrations,
    (select count(*)::int from public.properties where inn_code = 'DEMO') as hotels,
    (select count(*)::int from public.rooms) as rooms,
    current_user as who`)
  check(counts.migrations >= 9, 'every migration is recorded, including the sign-in tables', String(counts.migrations))
  check(counts.hotels === 1 && counts.rooms === 36, 'seed ran once: one DEMO hotel, 36 rooms (no duplicates)', JSON.stringify(counts))
  check(counts.who === 'app_owner', 'MIGRATION_DATABASE_URL logs in as app_owner')
  check((await one(first.urls.DATABASE_URL, 'select current_user as u')).u === 'app_user', 'DATABASE_URL logs in as app_user')
  check((await one(first.urls.AUTH_DATABASE_URL, 'select current_user as u')).u === 'auth_service', 'AUTH_DATABASE_URL logs in as auth_service')
  check(Object.values(first.urls).every((u) => new URL(u).password === ''), 'printed URLs contain no password')

  await admin.query(`create database "${foreignName}"`)
  const c = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/' + foreignName }).toString() })
  await c.connect()
  await c.query('create table public.someone_elses (id int)')
  await c.end()
  await refuses(setupLocalDb({ adminUrl: url, database: foreignName, log: quiet }), /not made by this script/, 'refuses a database it did not make')
  await refuses(setupLocalDb({ adminUrl: url, database: 'postgres', log: quiet }), /must look like returnly_dev/, 'refuses other database names')
  await refuses(setupLocalDb({ adminUrl: 'postgresql://user@db.example.com:5432/postgres', database: name, log: quiet }), /on this computer/, 'refuses a server that is not local')
} catch (e) {
  fail('unexpected error: ' + e.message)
} finally {
  for (const db of [name, foreignName]) await admin.query(`drop database if exists "${db}" with (force)`)
  await admin.end()
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
