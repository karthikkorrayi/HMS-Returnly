/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// The app's data layer (src/lib/db/core.ts) against the Railway schema
// (bootstrap + db/migrations, applied as app_owner):
//   both databases: identities, RLS, rpc(), rollback on error, SQL guard;
//   real Postgres:  a pool logged in as app_user — refuses a superuser pool,
//                   nothing leaks between requests reusing one connection, and
//                   40 concurrent mixed requests each see only their own identity.
import { openTestDb } from './test-db.mjs'
import { createDb, assertAppUser, DbGuardError } from '../../src/lib/db/core.ts'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('data_layer')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const real = kind !== 'PGlite'
const expectReject = async (name, p, match) => {
  try { await p; fail(`${name} → succeeded`) } catch (e) {
    match.test(e.message) ? pass(`${name}`) : fail(`${name} → wrong error: ${e.message}`)
  }
}

// --- Schema: exactly what Railway will run ------------------------------------------
await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8')}\n;reset role;`)
}
await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/seed.sql`, 'utf8')}\n;reset role;`)
const U = {
  hk: '00000000-0000-0000-0000-0000000000b1',
  fo: '00000000-0000-0000-0000-0000000000b2',
  other: '00000000-0000-0000-0000-0000000000b3',
}
await db.exec(`
  set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into auth.users (id) values ('${U.hk}'), ('${U.fo}'), ('${U.other}');
  insert into public.staff (user_id, property_id, username, display_name, role, active)
  select u, (select id from public.properties where inn_code = p), n, n, r::public.staff_role, true
  from (values ('${U.hk}'::uuid, 'DEMO', 'hk01', 'housekeeping'),
               ('${U.fo}'::uuid, 'DEMO', 'fo01', 'front_office'),
               ('${U.other}'::uuid, 'OTHER', 'ot01', 'housekeeping')) t(u, p, n, r);
  reset role;
`)
const DEMO = (await db.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id
const OTHER = (await db.query(`select id from public.properties where inn_code = 'OTHER'`)).rows[0].id

// --- Pools ------------------------------------------------------------------------------
let appPool, superPool, pg, appUrl
if (real) {
  pg = (await import('pg')).default
  const name = (await db.query('select current_database() as d')).rows[0].d
  const url = (user) => { const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + name; u.username = user; u.password = ''; return u.toString() }
  appUrl = url('app_user')
  appPool = new pg.Pool({ connectionString: appUrl, max: 3 })
  superPool = new pg.Pool({ connectionString: url(new URL(process.env.TEST_DATABASE_URL).username || 'postgres'), max: 1 })
} else {
  // PGlite has one connection: emulate app_user for the session.
  await db.exec('set role app_user')
  const client = { query: (s, p) => db.query(s, p), release: () => {} }
  appPool = { connect: async () => client }
}
const app = createDb(appPool)
// Test-side reads as the superuser (PGlite shares one session, so step out of app_user).
const admin = async (sql, params) => {
  if (!real) await db.exec('reset role')
  try { return await db.query(sql, params) } finally { if (!real) await db.exec('set role app_user') }
}

console.log('Connection checks')
if (real) {
  try { await assertAppUser(appPool); pass('pool logged in as app_user passes the start-up check') } catch (e) { fail('app pool rejected: ' + e.message) }
  await expectReject('a superuser DATABASE_URL is refused (fails closed)', assertAppUser(superPool), /must log in as app_user/)
} else {
  console.log('  skip (needs real Postgres: set TEST_DATABASE_URL)')
}

console.log('\nIdentity and row-level security')
const who = (tx) => tx.query(`select current_user as u, auth.uid() as uid, public.current_staff_role()::text as role`).then((r) => r.rows[0])
const hk = await app.withStaff(U.hk, who)
hk.u === 'authenticated' && hk.uid === U.hk && hk.role === 'housekeeping' ? pass('withStaff runs as authenticated with the staff user id') : fail('withStaff identity: ' + JSON.stringify(hk))

const logged = await app.withStaff(U.hk, (tx) => tx.query(`insert into public.lost_items
  (property_id, found_area_type, area_label, found_at, found_by, category, description)
  values ($1, 'public_area', 'Lobby', now(), $2, 'clothing', 'Red umbrella') returning id`, [DEMO, U.hk]))
logged.rows.length === 1 ? pass('housekeeper logs an item through withStaff') : fail('could not log item')
const itemId = logged.rows[0].id
const edit = await app.withStaff(U.hk, (tx) => tx.query(`update public.lost_items set description = 'x' where id = $1`, [itemId]))
edit.rowCount === 0 ? pass('…but cannot edit it directly (0 rows)') : fail(`edited ${edit.rowCount}`)
const otherSees = await app.withStaff(U.other, (tx) => tx.query(`select count(*)::int n from public.lost_items where id = $1`, [itemId]))
otherSees.rows[0].n === 0 ? pass('staff at another hotel cannot see it') : fail('cross-hotel item visible')
await expectReject('cannot log an item into another hotel', app.withStaff(U.hk, (tx) => tx.query(`insert into public.lost_items
  (property_id, found_area_type, area_label, found_at, found_by, category, description)
  values ($1, 'public_area', 'Lobby', now(), $2, 'other', 'x')`, [OTHER, U.hk])), /row-level security/)

const role = await app.withStaff(U.fo, (tx) => tx.rpc('current_staff_role'))
role.rows[0]?.current_staff_role === 'front_office' ? pass('rpc() calls a function as the signed-in user') : fail('rpc: ' + JSON.stringify(role.rows))

console.log('\nPublic visitors')
const hotels = await app.withAnon((tx) => tx.rpc('public_properties'))
hotels.rows.length === 2 ? pass('withAnon: public_properties() lists hotels') : fail('public_properties rows: ' + hotels.rows.length)
const status = await app.withAnon((tx) => tx.rpc('customer_request_status', { p_reference: 'LF-00000-00000', p_booking_ref: 'NOPE1' }).catch((e) => ({ error: e.message })))
status.error === 'No enquiry matches that reference and booking ID'
  ? pass('withAnon: rpc() with named arguments reaches the function (its own "no match" message)') : fail('status rpc: ' + JSON.stringify(status))
await expectReject('withAnon cannot read items', app.withAnon((tx) => tx.query(`select count(*) from public.lost_items`)), /permission denied/)

console.log('\nErrors and the SQL guard')
const before = (await admin(`select count(*)::int n from public.lost_items`)).rows[0].n
await expectReject('an error inside the callback is passed on', app.withStaff(U.hk, async (tx) => {
  await tx.query(`insert into public.lost_items (property_id, found_area_type, area_label, found_at, found_by, category, description)
    values ($1, 'public_area', 'Gym', now(), $2, 'other', 'should vanish')`, [DEMO, U.hk])
  throw new Error('page crashed')
}), /page crashed/)
const after = (await admin(`select count(*)::int n from public.lost_items`)).rows[0].n
after === before ? pass('…and its earlier writes are rolled back') : fail('write survived a failed request')
await expectReject('guard refuses SET ROLE before it reaches the database', app.withStaff(U.hk, (tx) => tx.query('set role app_owner')), /Refused SQL/)
await expectReject('guard refuses changing the user id mid-request', app.withStaff(U.hk, (tx) => tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.fo])), /Refused SQL/)
await expectReject('guard refuses COMMIT inside a request', app.withStaff(U.hk, (tx) => tx.query('commit')), /Refused SQL/)

if (real) {
  console.log('\nPooled connections (real Postgres, app_user)')
  // A pool of one connection forces every request onto the same connection.
  const single = new pg.Pool({ connectionString: appUrl, max: 1 })
  const one = createDb(single)
  const raw = async () => { const c = await single.connect(); try { return (await c.query(`select current_user as u, nullif(current_setting('request.jwt.claim.sub', true), '') as uid`)).rows[0] } finally { c.release() } }
  await one.withStaff(U.hk, (tx) => tx.query('select 1'))
  const a = await raw()
  a.u === 'app_user' && a.uid === null ? pass('after a request the connection is plain app_user again') : fail('leak after commit: ' + JSON.stringify(a))
  await one.withStaff(U.fo, async () => { throw new Error('x') }).catch(() => {})
  const b = await raw()
  b.u === 'app_user' && b.uid === null ? pass('after a failed request: no leak') : fail('leak after error: ' + JSON.stringify(b))
  await one.withStaff(U.fo, (tx) => tx.query('set role postgres')).catch(() => {})
  const c = await raw()
  c.u === 'app_user' && c.uid === null ? pass('after a refused statement: no leak') : fail('leak after guard: ' + JSON.stringify(c))
  const anonAfterStaff = await one.withAnon((tx) => tx.query(`select current_user as u, auth.uid() as uid`)).then((r) => r.rows[0])
  anonAfterStaff.u === 'anon' && anonAfterStaff.uid === null ? pass('a public request after a staff request has no user id') : fail('anon saw: ' + JSON.stringify(anonAfterStaff))
  await single.end()

  const ids = [U.hk, U.fo, U.other, null]
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => {
    const id = ids[i % ids.length]
    const work = async (tx) => {
      await tx.query('select pg_sleep(0.01)')
      return (await tx.query(`select current_user as u, auth.uid() as uid`)).rows[0]
    }
    return (id ? app.withStaff(id, work) : app.withAnon(work)).then((r) => ({ want: id, got: r }))
  }))
  const wrong = results.filter((r) => (r.want ? r.got.u !== 'authenticated' || r.got.uid !== r.want : r.got.u !== 'anon' || r.got.uid !== null))
  wrong.length === 0 ? pass('40 concurrent mixed requests on 3 connections: each saw only its own identity') : fail(`${wrong.length} requests saw the wrong identity`)
  await appPool.end()
  await superPool.end()
} else {
  await db.exec('reset role')
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
