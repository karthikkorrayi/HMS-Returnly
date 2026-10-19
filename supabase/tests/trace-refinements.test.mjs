/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// Refinements in migration 20261007000006: stay history, overdue room checks,
// guests who leave without checking out, hidden spots, manager settings.
import { openTestDb } from './test-db.mjs'
import { readFileSync, readdirSync } from 'node:fs'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('trace_refinements')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }

await db.exec(`
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create schema auth; grant usage on schema auth to authenticated, anon;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage; grant usage on schema storage to authenticated;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`)
for (const f of readdirSync(`${REPO}/migrations`).sort()) {
  await db.exec(readFileSync(`${REPO}/migrations/${f}`, 'utf8'))
}
await db.exec(readFileSync(`${REPO}/seed.sql`, 'utf8'))

const U = {
  mgr: '00000000-0000-0000-0000-000000000001',
  fo: '00000000-0000-0000-0000-000000000002',
  hk: '00000000-0000-0000-0000-000000000003',
}
await db.exec(`
  insert into auth.users (id) values ${Object.values(U).map((u) => `('${u}')`).join(',')};
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = 'DEMO'), n, n, r::public.staff_role
  from (values
    ('${U.mgr}'::uuid, 'mgr1', 'manager'),
    ('${U.fo}'::uuid, 'fo01', 'front_office'),
    ('${U.hk}'::uuid, 'hk01', 'housekeeping')
  ) as t(u, n, r);
`)
const DEMO = (await db.query(`select id from public.properties where inn_code='DEMO'`)).rows[0].id

async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user])
    return tx.query(sql, params)
  })
}
async function ok(name, user, sql, params) {
  try { const r = await as(user, sql, params); pass(name); return r } catch (e) { fail(`${name} → ${e.message}`) }
}
async function err(name, user, sql, params, match) {
  try { await as(user, sql, params); fail(`${name} → succeeded but should have failed`) } catch (e) {
    if (match && !e.message.includes(match)) fail(`${name} → wrong error: ${e.message}`)
    else pass(`${name} (${e.message})`)
  }
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString()
const board = async () =>
  Object.fromEntries((await as(U.hk, `select * from public.room_board()`)).rows.map((r) => [r.room_number, r]))
const logItem = async (room, hidden) =>
  (await as(U.hk, `insert into public.lost_items
    (property_id, found_area_type, room_number, found_at, found_by, category, description, found_spot, spot_hidden)
    values ($1, 'room', $2, now(), $3, 'jewellery_watches', 'Gold bracelet', 'Behind bedside table', $4) returning id`,
    [DEMO, room, U.hk, hidden])).rows[0].id
const trace = async (itemId) => (await as(U.fo, `select * from public.trace_item_owners($1)`, [itemId])).rows

// --- Stay history -------------------------------------------------------------
console.log('Stay history')
const s201 = (await as(U.fo, `select public.check_in_guest('201', 'HIST01', 'Patel', $1) as id`, [day(2)])).rows[0].id
await as(U.fo, `select public.check_out_guest($1)`, [s201])
const changes = (await as(U.fo, `select change, changed_by, new_values from public.stay_changes where stay_id=$1 order by id`, [s201])).rows
changes.map((c) => c.change).join() === 'created,checked_out'
  ? pass('check-in and check-out both logged') : fail(changes.map((c) => c.change).join())
changes.every((c) => c.changed_by === U.fo) ? pass('logged as the front office user') : fail('wrong actor')
JSON.stringify(changes).toLowerCase().includes('patel') ? fail('surname leaked into history') : pass('history never contains the surname')
const hkHist = await as(U.hk, `select count(*)::int n from public.stay_changes`)
hkHist.rows[0].n === 0 ? pass('housekeeping cannot read stay history') : fail('housekeeping reads history')
await err('nobody writes stay history directly', U.mgr,
  `insert into public.stay_changes (stay_id, property_id, change, new_values) values ($1,$2,'updated','{}')`,
  [s201, DEMO], 'permission denied')
await as(U.fo, `select public.import_stays($1::jsonb)`, [JSON.stringify([
  { room_number: '201', reservation_ref: 'HIST01', guest_surname: 'Patel', check_in_date: day(0), check_out_date: day(1), status: 'departed' },
])])
const afterImport = (await as(U.fo, `select change, old_values->>'check_out_date' old_out, new_values->>'check_out_date' new_out
  from public.stay_changes where stay_id=$1 order by id`, [s201])).rows
afterImport.at(-1).change === 'updated' && afterImport.at(-1).old_out !== afterImport.at(-1).new_out
  ? pass('a correction from import is logged with old and new values') : fail(JSON.stringify(afterImport))

// --- Overdue room checks ------------------------------------------------------
console.log('\nRoom check deadline')
await as(U.fo, `select public.import_stays($1::jsonb)`, [JSON.stringify([
  { room_number: '202', reservation_ref: 'LATE01', guest_surname: 'Ng', check_in_date: day(-2), check_out_date: day(0), status: 'departed', checked_out_at: hoursAgo(6) },
  { room_number: '203', reservation_ref: 'SOON01', guest_surname: 'Ng', check_in_date: day(-2), check_out_date: day(0), status: 'departed', checked_out_at: hoursAgo(1) },
])])
let b = await board()
b['202'].status === 'check_overdue' ? pass('departed 6h ago, unchecked → check_overdue') : fail('202 is ' + b['202'].status)
b['203'].status === 'needs_check' ? pass('departed 1h ago, unchecked → needs_check') : fail('203 is ' + b['203'].status)
await as(U.hk, `select public.record_room_check('202', 'clean')`)
b = await board()
b['202'].status === 'ready' ? pass('checking the room clears the overdue flag') : fail('202 is ' + b['202'].status)

// --- Guest left without checking out ------------------------------------------
console.log('\nGuest left without checking out')
await as(U.fo, `select public.import_stays($1::jsonb)`, [JSON.stringify([
  { room_number: '204', reservation_ref: 'GONE01', guest_surname: 'Ruiz', check_in_date: day(-6), check_out_date: day(-3), status: 'in_house' },
])])
let t = await trace(await logItem('204', false))
t.length === 1 && t[0].score < 95 ? pass(`overdue in-house stay not treated as "in the room" (score ${t[0]?.score})`) : fail(JSON.stringify(t))
t[0]?.reasons.some((r) => r.includes('without checking out')) ? pass('reason explains it may have left without checking out') : fail(JSON.stringify(t[0]?.reasons))

await as(U.fo, `select public.check_in_guest('205', 'HERE01', 'Okafor', $1)`, [day(2)])
t = await trace(await logItem('205', false))
t[0]?.score === 95 && t[0].reasons.some((r) => r.includes('may not be lost'))
  ? pass('guest currently in the room → 95, flagged as possibly not lost') : fail(JSON.stringify(t))

// --- Hidden spots ---------------------------------------------------------------
console.log('\nHidden spots')
await as(U.fo, `select public.import_stays($1::jsonb)`, [JSON.stringify([
  { room_number: '206', reservation_ref: 'SPOT01', guest_surname: 'Lee', check_in_date: day(-6), check_out_date: day(-5), status: 'departed' },
])])
await db.query(`insert into public.room_checks (property_id, room_number, check_type, outcome, checked_by, checked_at)
  values ($1, '206', 'recheck', 'clean', $2, now() - interval '4 days')`, [DEMO, U.hk])
const visible = (await trace(await logItem('206', false)))[0]
const hidden = (await trace(await logItem('206', true)))[0]
visible?.score === 65 ? pass('visible spot: one clean check since → 90 − 25 = 65') : fail('visible ' + visible?.score)
hidden?.score === 80 ? pass('hidden spot: one clean check since → 90 − 10 = 80') : fail('hidden ' + hidden?.score)
hidden?.reasons.some((r) => r.includes('hidden spot')) ? pass('reason mentions the hidden spot') : fail(JSON.stringify(hidden?.reasons))

// --- Settings -------------------------------------------------------------------
console.log('\nSettings')
await ok('manager changes settings', U.mgr, `select public.update_property_settings(30, 120, 6, 60)`)
const p = (await db.query(`select trace_window_days, stay_retention_days, check_due_hours, retention_days from public.properties where id=$1`, [DEMO])).rows[0]
p.trace_window_days === 30 && p.check_due_hours === 6 ? pass('settings saved') : fail(JSON.stringify(p))
await err('front office cannot change settings', U.fo, `select public.update_property_settings(30, 120, 6, 60)`, [], 'Only managers')
await err('retention must cover the trace window', U.mgr, `select public.update_property_settings(90, 60, 6, 60)`, [], 'stay_retention_covers_trace')
await err('out-of-range values rejected', U.mgr, `select public.update_property_settings(30, 120, 99, 60)`, [], 'check_due_hours')

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
