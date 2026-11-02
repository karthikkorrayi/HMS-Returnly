// Run with: npm run test:db
// PR A: per-visitor rate limits on the public pages (migration 015,
// src/lib/rate-limit.ts), run as the app runs them: through the data layer as
// anon. Checks the limits, that a failed lookup still counts, that windows
// reset, that no IP address reaches the database, that only anon may count,
// that parallel requests can't slip past the limit (real Postgres), and that
// the daily clean-up removes old windows. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { allow, rateKey } from '../../src/lib/rate-limit.ts'
import { requestStatus } from '../../src/lib/requests/public-queries.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, close } = await openTestDb('rate_limit')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)
const errCode = async (fn) => { try { await fn(); return 'none' } catch (e) { return e.code ?? e.message } }

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
}
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))

let pool
if (real) {
  const pg = (await import('pg')).default
  pool = new pg.Pool({ connectionString: urlFor('app_user'), max: 6, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p).then((r) => ({ ...r, rowCount: r.affectedRows ?? r.rows.length })), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const SECRET = randomBytes(24).toString('hex')
const key = (bucket, ip) => rateKey(bucket, ip, SECRET)
const hit = (bucket, ip) => app.withAnon((tx) => allow(tx, bucket, key(bucket, ip)))
const hits = async (bucket, ip, n) => { const out = []; for (let i = 0; i < n; i++) out.push(await hit(bucket, ip)); return out }
const ownerExec = async (sql) => {
  if (!real) await db.exec('reset role')
  try { await db.exec(sql) } finally { if (!real) await db.exec('set role app_user') }
}
const ownerQuery = async (sql) => {
  if (!real) await db.exec('reset role')
  try { return (await db.query(sql)).rows } finally { if (!real) await db.exec('set role app_user') }
}

console.log('\nLimits per visitor')
const s = await hits('submit', '203.0.113.10', 11)
check(s.slice(0, 10).every(Boolean) && s[10] === false, '10 enquiries an hour are allowed, the 11th is refused', JSON.stringify(s))
check(await hit('submit', '203.0.113.11'), 'another visitor is not affected')
check(await hit('lookup', '203.0.113.10'), 'the same visitor can still check a status (separate limit)')
const l = await hits('lookup', '198.51.100.7', 61)
check(l.slice(0, 60).every(Boolean) && l[60] === false, '60 status checks an hour, the 61st refused')
const r = await hits('reply', '198.51.100.8', 31)
check(r.slice(0, 30).every(Boolean) && r[30] === false, '30 replies an hour, the 31st refused')

console.log('\nA failed lookup still counts')
const ip = '192.0.2.44'
const before = (await ownerQuery(`select coalesce(sum(hits), 0)::int n from ops.rate_hits where key_hash = '${key('lookup', ip)}'`))[0].n
await hit('lookup', ip)
const failed = await errCode(() => app.withAnon((tx) => requestStatus(tx, 'LF-00000-00000', 'NOPE-1')))
const after = (await ownerQuery(`select coalesce(sum(hits), 0)::int n from ops.rate_hits where key_hash = '${key('lookup', ip)}'`))[0].n
check(failed === 'P0001' && after === before + 1, 'a wrong reference fails, and the check before it is still counted', `${failed} ${before}→${after}`)

console.log('\nWindows')
const oldKey = key('submit', '203.0.113.99')
await ownerExec(`set role app_owner; insert into ops.rate_hits (bucket, key_hash, window_start, hits)
  values ('submit', '${oldKey}', date_trunc('hour', now()) - interval '1 hour', 999),
         ('submit', '${'a'.repeat(64)}', now() - interval '2 days', 5); reset role;`)
check(await hit('submit', '203.0.113.99'), 'last hour’s full window does not block this hour')

console.log('\nWhat is stored')
const rows = await ownerQuery(`select bucket, key_hash from ops.rate_hits`)
check(rows.length > 0 && rows.every((x) => /^[0-9a-f]{64}$/.test(x.key_hash)), 'only 64-character hashes are stored')
check(!JSON.stringify(rows).includes('203.0.113'), 'no IP address appears in the table')
check(key('submit', '203.0.113.10') !== rateKey('submit', '203.0.113.10', randomBytes(24).toString('hex')),
  'the hash depends on the server secret (can’t be rebuilt without it)')

console.log('\nWho may count, and what is refused')
check(await errCode(() => app.withAnon((tx) => tx.rpc('hit_rate_limit', { p_bucket: 'admin', p_key_hash: 'a'.repeat(64) }))) === '22023',
  'an unknown limit is refused')
check(await errCode(() => app.withAnon((tx) => tx.rpc('hit_rate_limit', { p_bucket: 'submit', p_key_hash: '203.0.113.10' }))) === '22023',
  'a raw IP address instead of a hash is refused')
check(await errCode(() => app.withAnon((tx) => tx.query('select * from ops.rate_hits'))) === '42501', 'anon cannot read the counters')
const staffId = (await ownerQuery(`select user_id from public.staff limit 1`))[0]?.user_id
if (staffId) {
  check(await errCode(() => app.withStaff(staffId, (tx) => allow(tx, 'submit', 'b'.repeat(64)))) === '42501',
    'signed-in staff do not use it (only the public pages, as anon)')
}

if (real) {
  console.log('\nParallel requests (real Postgres)')
  const burst = await Promise.all(Array.from({ length: 20 }, () => hit('submit', '203.0.113.200')))
  check(burst.filter(Boolean).length === 10, '20 at once: exactly 10 allowed', String(burst.filter(Boolean).length))
}

console.log('\nThe daily clean-up removes old windows')
await ownerExec(`set role app_owner; select public.run_daily_cleanup(); reset role;`)
const s2 = (await ownerQuery(`select summary from ops.job_runs order by id desc limit 1`))[0].summary
check(s2.public_rate_hits === 1, 'windows older than a day are removed (1)', JSON.stringify(s2))
check((await ownerQuery(`select count(*)::int n from ops.rate_hits where window_start >= date_trunc('hour', now())`))[0].n > 0,
  'this hour’s counters are kept')

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall rate-limit checks passed')
process.exit(failures ? 1 : 0)
