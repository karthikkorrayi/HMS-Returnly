/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// Stay log, room checks, room board and ownership tracing
// (migration 20261006000005). Applies every migration in PGlite with
// Supabase auth/storage stubbed, then exercises the rules per role.
import { openTestDb } from './test-db.mjs'
import { readFileSync, readdirSync } from 'node:fs'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('stays')
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
  other: '00000000-0000-0000-0000-000000000005',
}
await db.exec(`
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.rooms (property_id, room_number) select id, '101' from public.properties where inn_code = 'OTHER';
  insert into auth.users (id) values ${Object.values(U).map((u) => `('${u}')`).join(',')};
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = p), n, n, r::public.staff_role
  from (values
    ('${U.mgr}'::uuid, 'DEMO', 'mgr1', 'manager'),
    ('${U.fo}'::uuid, 'DEMO', 'fo01', 'front_office'),
    ('${U.hk}'::uuid, 'DEMO', 'hk01', 'housekeeping'),
    ('${U.other}'::uuid, 'OTHER', 'oth1', 'housekeeping')
  ) as t(u, p, n, r);
`)
const DEMO = (await db.query(`select id from public.properties where inn_code='DEMO'`)).rows[0].id

async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${user === 'anon' ? 'anon' : 'authenticated'}`)
    if (user !== 'anon') await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user])
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
// Dates as the hotel sees them (Europe/London, like the database's "today"):
// using the UTC date made this test fail every night between midnight in
// London and midnight UTC.
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() - n * 86400000))
const board = async (user) =>
  Object.fromEntries((await as(user, `select * from public.room_board()`)).rows.map((r) => [r.room_number, r]))

// --- Check-in / check-out ---------------------------------------------------
console.log('Check-in and check-out')
const tomorrow = daysAgo(-1)
const s109 = (await ok('front office checks a guest into 109', U.fo,
  `select public.check_in_guest('109', 'abc 123', 'Smith', $1) as id`, [tomorrow]))?.rows[0].id
const ref = (await db.query(`select reservation_ref, guest_surname from public.stays where id=$1`, [s109])).rows[0]
ref.reservation_ref === 'ABC123' ? pass('reservation ref normalised to ABC123') : fail('ref ' + ref.reservation_ref)
await err('housekeeping cannot check guests in', U.hk,
  `select public.check_in_guest('110', 'X1234', 'Jones', $1)`, [tomorrow], 'Only front office')
await err('surname is required', U.fo,
  `select public.check_in_guest('110', 'X1234', '  ', $1)`, [tomorrow], 'surname')
await err('cannot check into an occupied room', U.fo,
  `select public.check_in_guest('109', 'ZZZ999', 'Brown', $1)`, [tomorrow], 'still has a guest')
await err('unknown room rejected', U.fo,
  `select public.check_in_guest('999', 'ZZZ999', 'Brown', $1)`, [tomorrow], 'room list')

console.log('\nPrivacy')
await ok('front office reads stays without the surname', U.fo,
  `select id, reservation_ref, status from public.stays where id=$1`, [s109])
await err('nobody reads guest_surname through the API', U.mgr,
  `select guest_surname from public.stays`, [], 'permission denied')
const hkStays = await as(U.hk, `select count(*)::int n from public.stays`)
hkStays.rows[0].n === 0 ? pass('housekeeping sees no stays') : fail('housekeeping sees stays')
await err('anon cannot read stays', 'anon', `select id from public.stays`, [], 'permission denied')
await err('front office cannot write stays directly', U.fo,
  `update public.stays set status='departed'`, [], 'permission denied')
await err('nobody writes room checks directly', U.hk,
  `insert into public.room_checks (property_id, room_number, outcome, checked_by) values ($1,'109','clean',$2)`,
  [DEMO, U.hk], 'permission denied')

console.log('\nRoom board')
let b = await board(U.hk)
b['109'].status === 'occupied' ? pass('109 shows occupied') : fail('109 is ' + b['109'].status)
b['110'].status === 'ready' ? pass('110 shows ready') : fail('110 is ' + b['110'].status)
'reservation_ref' in b['109'] || 'guest_surname' in b['109'] ? fail('board leaks guest details') : pass('board has no guest details')
await ok('front office checks the guest out', U.fo, `select public.check_out_guest($1)`, [s109])
await err('cannot check out twice', U.fo, `select public.check_out_guest($1)`, [s109], 'already departed')
b = await board(U.hk)
b['109'].status === 'needs_check' ? pass('109 needs a check after departure') : fail('109 is ' + b['109'].status)
const otherBoard = await board(U.other)
Object.keys(otherBoard).join() === '101' ? pass('other hotel sees only its own rooms') : fail(Object.keys(otherBoard).join())

console.log('\nRoom checks')
const chk = (await ok('housekeeping records 109 clean', U.hk,
  `select public.record_room_check('109', 'clean') as id`))?.rows[0].id
const linked = (await db.query(`select stay_id from public.room_checks where id=$1`, [chk])).rows[0].stay_id
linked === s109 ? pass('check linked to the departed stay automatically') : fail('linked to ' + linked)
await err('second departure check for the same stay', U.hk,
  `select public.record_room_check('109', 'clean', 'departure', $1)`, [s109], 'already checked')
await ok('a recheck is allowed', U.hk, `select public.record_room_check('109', 'clean', 'recheck')`)
b = await board(U.hk)
b['109'].status === 'ready' && b['109'].last_check_outcome === 'clean'
  ? pass('109 ready after check') : fail(JSON.stringify(b['109']))
await err('departure check cannot target an in-house stay', U.hk,
  `select public.record_room_check('110', 'clean', 'departure', $1)`, [s109], 'not for room')

console.log('\nImport')
// Room 110 history: A left 20 days ago, B 10 days ago, C 1 day ago. One stay 100 days ago.
const rows = [
  { room_number: '110', reservation_ref: 'OLD100', guest_surname: 'Old', check_in_date: daysAgo(102), check_out_date: daysAgo(100), status: 'departed' },
  { room_number: '110', reservation_ref: 'STAYA', guest_surname: 'Avery', check_in_date: daysAgo(22), check_out_date: daysAgo(20), status: 'departed' },
  { room_number: '110', reservation_ref: 'STAYB', guest_surname: 'Bello', check_in_date: daysAgo(12), check_out_date: daysAgo(10), status: 'departed' },
  { room_number: '110', reservation_ref: 'STAYC', guest_surname: 'Chen', check_in_date: daysAgo(3), check_out_date: daysAgo(1), status: 'departed' },
  { room_number: '999', reservation_ref: 'BADROOM', guest_surname: 'X', check_in_date: daysAgo(3), check_out_date: daysAgo(1), status: 'departed' },
  { room_number: '110', reservation_ref: 'CLASH', guest_surname: 'Y', check_in_date: daysAgo(11), check_out_date: daysAgo(9), status: 'departed' },
]
const imp = (await ok('front office imports a departures export', U.fo,
  `select public.import_stays($1::jsonb) as r`, [JSON.stringify(rows)]))?.rows[0].r
imp?.saved === 4 && imp?.failed === 2 ? pass('4 saved, 2 reported (unknown room, overlap)') : fail(JSON.stringify(imp))
const again = (await as(U.fo, `select public.import_stays($1::jsonb) as r`, [JSON.stringify(rows.slice(0, 4))])).rows[0].r
const n110 = (await db.query(`select count(*)::int n from public.stays where room_number='110'`)).rows[0].n
again.saved === 4 && n110 === 4 ? pass('re-importing the same rows creates no duplicates') : fail(`saved ${again.saved}, rows ${n110}`)
await err('housekeeping cannot import', U.hk, `select public.import_stays('[]'::jsonb)`, [], 'Only front office')

// Clean departure checks after A and after B (inserted with past timestamps).
await db.query(`
  insert into public.room_checks (property_id, room_number, stay_id, check_type, outcome, checked_by, checked_at)
  select property_id, room_number, id, 'departure', 'clean', $1, checked_out_at + interval '2 hours'
  from public.stays where reservation_ref in ('STAYA', 'STAYB')`, [U.hk])

console.log('\nTracing')
const logItem = async (extra = {}) => {
  const v = { area: 'room', room: '110', label: null, check: null, ...extra }
  return (await as(U.hk, `insert into public.lost_items
    (property_id, found_area_type, room_number, area_label, found_at, found_by, category, description, room_check_id)
    values ($1, $2, $3, $4, now(), $5, 'jewellery_watches', 'Gold bracelet', $6) returning id`,
    [DEMO, v.area, v.room, v.label, U.hk, v.check])).rows[0].id
}
// Found today in 110, under the bed, after C left (no departure check for C recorded).
const bracelet = await logItem()
await err('housekeeping cannot trace owners', U.hk, `select * from public.trace_item_owners($1)`, [bracelet], 'Only front office')
const trace = (await ok('front office traces owners', U.fo, `select * from public.trace_item_owners($1)`, [bracelet]))?.rows ?? []
console.log('  ' + trace.map((t) => `${t.reservation_ref}=${t.score}`).join('  '))
trace.map((t) => t.reservation_ref).join() === 'STAYC,STAYB,STAYA'
  ? pass('ranked most recent guest first: C, B, A') : fail('order ' + trace.map((t) => t.reservation_ref).join())
!trace.some((t) => t.reservation_ref === 'OLD100') ? pass('stay outside the 45-day window excluded') : fail('old stay included')
trace[0]?.score === 90 && trace[0].reasons.includes('Last guest in the room before it was found')
  ? pass('C scored 90 as last guest') : fail(JSON.stringify(trace[0]))
const a = trace.find((t) => t.reservation_ref === 'STAYA')
a && a.score < trace[1].score && a.reasons.some((r) => r.startsWith('Room checked clean 2'))
  ? pass('A penalised for two clean checks since') : fail(JSON.stringify(a))

// Departure check after a new stay finds an item → that stay is top.
const sD = (await as(U.fo, `select public.check_in_guest('109', 'STAYD', 'Diaz', $1) as id`, [tomorrow])).rows[0].id
await as(U.fo, `select public.check_out_guest($1)`, [sD])
const found = (await as(U.hk, `select public.record_room_check('109', 'items_found') as id`)).rows[0].id
const watch = await (async () => {
  return (await as(U.hk, `insert into public.lost_items
    (property_id, found_area_type, room_number, found_at, found_by, category, description, room_check_id)
    values ($1,'room','109',now(),$2,'jewellery_watches','Silver watch',$3) returning id`, [DEMO, U.hk, found])).rows[0].id
})()
const t2 = (await as(U.fo, `select * from public.trace_item_owners($1)`, [watch])).rows
t2[0]?.reservation_ref === 'STAYD' && t2[0].score === 98
  ? pass('item found on departure check → that stay scores 98') : fail(JSON.stringify(t2[0]))
await err('cannot log an item against a clean check', U.hk, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description, room_check_id)
  values ($1,'room','109',now(),$2,'other','Scarf',$3)`, [DEMO, U.hk, chk], 'recorded as clean')
await err('room check must match the item room', U.hk, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description, room_check_id)
  values ($1,'room','110',now(),$2,'other','Scarf',$3)`, [DEMO, U.hk, found], 'does not match')
await err('room check link cannot be changed later', U.fo,
  `update public.lost_items set room_check_id=null where id=$1`, [watch], 'item workflow')
const gym = await logItem({ area: 'public_area', room: null, label: 'Gym' })
const t3 = (await as(U.fo, `select * from public.trace_item_owners($1)`, [gym])).rows
t3.length === 0 ? pass('public-area items return no trace') : fail('public area traced')

console.log('\nCandidates')
const stayC = trace[0].stay_id
const cand = (await ok('front office adds traced stay as possible owner', U.fo,
  `select public.add_candidate_from_stay($1, $2) as id`, [bracelet, stayC]))?.rows[0].id
const c = (await db.query(`select reservation_ref, stay_id from public.guest_candidates where id=$1`, [cand])).rows[0]
c.reservation_ref === 'STAYC' && c.stay_id === stayC ? pass('candidate carries ref and stay link') : fail(JSON.stringify(c))
const shelf = (await db.query(`select id from public.storage_locations where label like 'Front desk safe%'`)).rows[0].id
await as(U.hk, `select public.change_status($1,'stored',$2,null)`, [bracelet, shelf])
await ok('existing confirm flow works on a traced candidate', U.fo, `select public.confirm_candidate($1)`, [cand])

console.log('\nRetention')
await db.query(`update public.stays set check_out_date = current_date - 400, check_in_date = current_date - 402 where reservation_ref='STAYC'`)
const purged = (await db.query(`select public.purge_expired_stays() as n`)).rows[0].n
const after = (await db.query(`select reservation_ref, stay_id from public.guest_candidates where id=$1`, [cand])).rows[0]
purged >= 1 && after.stay_id === null && after.reservation_ref === 'STAYC'
  ? pass('expired stays purged; candidate keeps its reservation ref') : fail(`purged ${purged}, ${JSON.stringify(after)}`)
await err('staff cannot run the purge', U.mgr, `select public.purge_expired_stays()`, [], 'permission denied')

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
