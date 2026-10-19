/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// Platform bootstrap for plain Postgres (db/bootstrap/000_platform.sql):
// applies it, then all migrations as the non-superuser owner app_owner, and
// checks the roles the Railway app will use.
//   Part A (PGlite and real Postgres): ownership, role attributes, grants, RLS.
//   Part B (real Postgres only): logs in as app_user, like the web app, and
//   proves it can do nothing without SET LOCAL ROLE and that nothing leaks
//   between transactions on one connection.
import { openTestDb } from './test-db.mjs'
import { readFileSync, readdirSync } from 'node:fs'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, connectAs, close } = await openTestDb('platform')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

// --- Bootstrap (twice: it must be safe to re-run) ------------------------------
const bootstrap = readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8')
await db.exec(bootstrap)
try { await db.exec(bootstrap); pass('bootstrap can be run twice') } catch (e) { fail('bootstrap re-run → ' + e.message) }

// Test-only stand-in for Supabase Storage, owned by app_owner, so migrations 04
// and 08 still apply. Photos move to an S3 bucket in Phase 5.
await db.exec(`
  create schema storage authorization app_owner;
  grant usage on schema storage to authenticated;
  set role app_owner;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  reset role;
`)

// --- Migrations, applied as app_owner -------------------------------------------
for (const f of readdirSync(`${REPO}/migrations`).sort()) {
  try {
    await db.exec(`set role app_owner;\n${readFileSync(`${REPO}/migrations/${f}`, 'utf8')}\n;reset role;`)
  } catch (e) {
    await db.exec('reset role').catch(() => {})
    fail(`${f} as app_owner → ${e.message}`)
  }
}
pass('all migrations apply as app_owner (not a superuser)')
await db.exec(`set role app_owner;\n${readFileSync(`${REPO}/seed.sql`, 'utf8')}\n;reset role;`)

console.log('\nPart A: ownership, roles, grants')
const owners = await db.query(`
  select r.rolname, count(*)::int n from (
    select relowner o from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname in ('public', 'auth') and c.relkind in ('r', 'v', 'S', 'f', 'p')
    union all
    select proowner from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('public', 'auth')
  ) x join pg_roles r on r.oid = x.o group by 1`)
owners.rows.length === 1 && owners.rows[0].rolname === 'app_owner'
  ? pass(`every table, sequence and function is owned by app_owner (${owners.rows[0].n})`)
  : fail('owners: ' + JSON.stringify(owners.rows))

const roles = (await db.query(`select rolname, rolsuper, rolinherit, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb
  from pg_roles where rolname in ('anon','authenticated','app_user','app_owner')`)).rows
const R = Object.fromEntries(roles.map((r) => [r.rolname, r]))
roles.length === 4 ? pass('four platform roles exist') : fail('roles: ' + roles.map((r) => r.rolname))
roles.every((r) => !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole && !r.rolcreatedb)
  ? pass('none is superuser, BYPASSRLS, CREATEROLE or CREATEDB') : fail('role flags: ' + JSON.stringify(roles))
!R.app_user.rolinherit && !R.anon.rolinherit && !R.authenticated.rolinherit
  ? pass('app_user, anon and authenticated do not inherit privileges') : fail('inherit flags wrong')
R.app_user.rolcanlogin && R.app_owner.rolcanlogin && !R.anon.rolcanlogin && !R.authenticated.rolcanlogin
  ? pass('only app_user and app_owner can log in') : fail('login flags wrong')

const members = (await db.query(`
  select r.rolname as granted, m.inherit_option, m.set_option
  from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
  where u.rolname = 'app_user' order by 1`)).rows
members.length === 2 && members.map((m) => m.granted).join() === 'anon,authenticated' &&
  members.every((m) => !m.inherit_option && m.set_option)
  ? pass('app_user may only SET ROLE to anon or authenticated, and inherits nothing')
  : fail('app_user memberships: ' + JSON.stringify(members))

const noRls = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows
noRls.length === 0 ? pass('row-level security is on for every public table') : fail('no RLS: ' + noRls.map((r) => r.relname))

const appUserTables = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r'
  and (has_table_privilege('app_user', c.oid, 'select') or has_table_privilege('app_user', c.oid, 'insert')
    or has_table_privilege('app_user', c.oid, 'update') or has_table_privilege('app_user', c.oid, 'delete'))`)).rows
appUserTables.length === 0 ? pass('app_user has no privileges on any table by itself') : fail('app_user can touch: ' + appUserTables.map((r) => r.relname))

const anonTables = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select')`)).rows
anonTables.length === 0 ? pass('anon cannot read any table') : fail('anon can read: ' + anonTables.map((r) => r.relname))

const anonFns = (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map((r) => r.proname).join(',')
anonFns === 'customer_reply,customer_request_status,public_properties,submit_customer_request'
  ? pass('anon can call exactly the four public functions') : fail('anon functions: ' + anonFns)

const ownerOnly = (await db.query(`select has_function_privilege('authenticated', 'public.purge_closed_requests()', 'execute') a,
  has_function_privilege('authenticated', 'public.purge_expired_stays()', 'execute') b,
  has_function_privilege('app_owner', 'public.purge_closed_requests()', 'execute') c`)).rows[0]
!ownerOnly.a && !ownerOnly.b && ownerOnly.c
  ? pass('purges run only as app_owner (scheduled job), not as staff') : fail('purge grants: ' + JSON.stringify(ownerOnly))

// Fixtures: a housekeeper and a front-office user at DEMO.
const U = { hk: '00000000-0000-0000-0000-0000000000a1', fo: '00000000-0000-0000-0000-0000000000a2' }
await db.exec(`
  set role app_owner;
  insert into auth.users (id) values ('${U.hk}'), ('${U.fo}');
  insert into public.staff (user_id, property_id, username, display_name, role, active)
  select u, (select id from public.properties where inn_code = 'DEMO'), n, n, r::public.staff_role, true
  from (values ('${U.hk}'::uuid, 'hk01', 'housekeeping'), ('${U.fo}'::uuid, 'fo01', 'front_office')) t(u, n, r);
  reset role;
`)
const DEMO = (await one(`select id from public.properties where inn_code = 'DEMO'`)).id

// --- Part B: real login as app_user ------------------------------------------------
console.log('\nPart B: logged in as app_user (the web app)')
const app = await connectAs('app_user').catch((e) => {
  fail('could not log in as app_user → ' + e.message + ' (the test server must trust local logins)')
  return null
})
if (!app) {
  if (kind === 'PGlite') console.log('  skip (needs real Postgres: set TEST_DATABASE_URL)')
} else {
  const denied = async (name, sql, params, match = 'permission denied') => {
    try { await app.query(sql, params); fail(`${name} → succeeded`) } catch (e) {
      e.message.includes(match) ? pass(`${name} (${e.message})`) : fail(`${name} → ${e.message}`)
    }
    await app.query('rollback').catch(() => {})
  }
  // Reads the raw per-request setting: app_user itself may not even use auth.uid().
  const me = async () => (await app.query(`select current_user as u,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid as uid`)).rows[0]

  const start = await me()
  start.u === 'app_user' && start.uid === null ? pass('connects as app_user with no user id set') : fail('start: ' + JSON.stringify(start))

  await denied('cannot read items without switching role', `select count(*) from public.lost_items`)
  await denied('cannot read staff without switching role', `select count(*) from public.staff`)
  await denied('cannot switch to app_owner', `set role app_owner`)
  await denied('cannot switch to the superuser', `set role postgres`)
  await denied('cannot even call auth.uid() without switching role', `select auth.uid()`)
  await denied('cannot create tables', `create table public.sneaky (id int)`)
  await denied('cannot grant itself BYPASSRLS', `alter role app_user bypassrls`)

  // A staff request: transaction + SET LOCAL ROLE + user id, exactly as the app will do it.
  await app.query('begin')
  await app.query('set local role authenticated')
  await app.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.hk])
  const inside = await me()
  const uidInside = (await app.query(`select auth.uid() as id`)).rows[0].id
  const logged = await app.query(`insert into public.lost_items
    (property_id, found_area_type, area_label, found_at, found_by, category, description)
    values ($1, 'public_area', 'Lobby', now(), $2, 'clothing', 'Blue scarf') returning id`, [DEMO, U.hk])
  const edit = await app.query(`update public.lost_items set description = 'changed' where id = $1`, [logged.rows[0].id])
  const ledger = await app.query(`delete from public.custody_events`)
  await app.query('commit')
  inside.u === 'authenticated' && inside.uid === U.hk && uidInside === U.hk ? pass('inside the transaction: authenticated, as the housekeeper') : fail('inside: ' + JSON.stringify(inside))
  logged.rows.length === 1 ? pass('housekeeper can log an item through app_user') : fail('log item failed')
  edit.affectedRows === 0 ? pass('housekeeper still cannot edit items directly (trigger + RLS hold)') : fail(`edited ${edit.affectedRows} rows`)
  ledger.affectedRows === 0 ? pass('custody ledger cannot be deleted through app_user') : fail(`deleted ${ledger.affectedRows} ledger rows`)

  const after = await me()
  after.u === 'app_user' && after.uid === null
    ? pass('after COMMIT the connection is back to app_user with no user id (no leak)')
    : fail('leak after commit: ' + JSON.stringify(after))

  await app.query('begin')
  await app.query('set local role authenticated')
  await app.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.fo])
  await app.query('select 1/0').catch(() => {})
  await app.query('rollback')
  const afterErr = await me()
  afterErr.u === 'app_user' && afterErr.uid === null
    ? pass('after an error and ROLLBACK there is no leak either') : fail('leak after rollback: ' + JSON.stringify(afterErr))

  await app.query('begin')
  await app.query('set local role anon')
  const hotels = (await app.query(`select count(*)::int n from public.public_properties()`)).rows[0].n
  let anonItems = 'allowed'
  await app.query('savepoint s')
  try { await app.query(`select count(*) from public.lost_items`) } catch { anonItems = 'denied'; await app.query('rollback to savepoint s') }
  await app.query('commit')
  hotels >= 1 ? pass('as anon: public_properties() works') : fail('public_properties returned nothing')
  anonItems === 'denied' ? pass('as anon: items cannot be read') : fail('anon read items')

  await app.end()
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
