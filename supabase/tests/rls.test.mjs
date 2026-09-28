/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// Runs the HMS Returnly migrations in PGlite with Supabase auth/storage stubbed,
// then exercises the role and workflow rules. Exit code 1 on any failed check.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const db = new PGlite()
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }

// --- Supabase platform stubs -------------------------------------------------
await db.exec(`
  create role anon nologin; create role authenticated nologin;
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
  console.log('applied ' + f)
}
await db.exec(readFileSync(`${REPO}/seed.sql`, 'utf8'))
console.log('applied seed.sql\n')

// --- Fixtures -----------------------------------------------------------------
const U = {
  mgr: '00000000-0000-0000-0000-000000000001',
  fo: '00000000-0000-0000-0000-000000000002',
  hk: '00000000-0000-0000-0000-000000000003',
  fo2: '00000000-0000-0000-0000-000000000004',
  other: '00000000-0000-0000-0000-000000000005',
  gone: '00000000-0000-0000-0000-000000000006',
}
await db.exec(`
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.rooms (property_id, room_number) select id, '101' from public.properties where inn_code = 'OTHER';
  insert into auth.users (id) values ${Object.values(U).map((u) => `('${u}')`).join(',')};
  insert into public.staff (user_id, property_id, username, display_name, role, active)
  select u, (select id from public.properties where inn_code = p), n, n, r::public.staff_role, a
  from (values
    ('${U.mgr}'::uuid, 'DEMO', 'mgr1', 'manager', true),
    ('${U.fo}'::uuid, 'DEMO', 'fo01', 'front_office', true),
    ('${U.hk}'::uuid, 'DEMO', 'hk01', 'housekeeping', true),
    ('${U.fo2}'::uuid, 'DEMO', 'fo02', 'front_office', true),
    ('${U.other}'::uuid, 'OTHER', 'other', 'housekeeping', true),
    ('${U.gone}'::uuid, 'DEMO', 'gone', 'front_office', false)
  ) as t(u, p, n, r, a);
`)
const DEMO = (await db.query(`select id from public.properties where inn_code='DEMO'`)).rows[0].id
const OTHER = (await db.query(`select id from public.properties where inn_code='OTHER'`)).rows[0].id
const loc = async (label) =>
  (await db.query(`select id from public.storage_locations where label like $1`, [label + '%'])).rows[0].id
const SHELF = await loc('Housekeeping office — shelf A')
const SAFE = await loc('Front desk safe')

async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user])
    return tx.query(sql, params)
  })
}
async function expectOk(name, user, sql, params) {
  try { const r = await as(user, sql, params); pass(name); return r } catch (e) { fail(`${name} → ${e.message}`) }
}
async function expectErr(name, user, sql, params, match) {
  try { await as(user, sql, params); fail(`${name} → succeeded but should have failed`) } catch (e) {
    if (match && !e.message.includes(match)) fail(`${name} → wrong error: ${e.message}`)
    else pass(`${name} (${e.message})`)
  }
}
const logItem = (user, extra = {}) => {
  const v = { area: 'room', room: '101', label: null, tier: 'standard', found_by: user, prop: DEMO, ...extra }
  return as(user, `insert into public.lost_items
    (property_id, found_area_type, room_number, area_label, found_at, found_by, category, description, value_tier)
    values ($1, $2, $3, $4, now(), $5, 'electronics', 'Black phone charger', $6) returning id, item_code, status, dispose_after`,
    [v.prop, v.area, v.room, v.label, v.found_by, v.tier])
}
const status = async (id) => (await db.query(`select status from public.lost_items where id=$1`, [id])).rows[0].status

// --- Logging -------------------------------------------------------------------
console.log('Logging')
const item = (await logItem(U.hk)).rows[0]
;/^DEMO-\d{6}-\d{4}$/.test(item.item_code) ? pass(`item code ${item.item_code}`) : fail(`bad item code ${item.item_code}`)
item.status === 'logged' ? pass('new item is logged') : fail('status ' + item.status)
const ev = await db.query(`select count(*)::int n from public.custody_events where item_id=$1 and to_status='logged'`, [item.id])
ev.rows[0].n === 1 ? pass('first custody event written') : fail('no custody event')
await expectErr('housekeeping cannot log as someone else', U.hk, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description)
  values ($1,'room','101',now(),$2,'other','abc')`, [DEMO, U.fo], 'row-level security')
await expectErr('unknown room rejected', U.hk, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description)
  values ($1,'room','999',now(),$2,'other','abc')`, [DEMO, U.hk], 'room_exists')
await expectErr('cannot log into another hotel', U.hk, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description)
  values ($1,'room','101',now(),$2,'other','abc')`, [OTHER, U.hk], 'row-level security')
await expectOk('public-area item needs label, no room', U.hk, `insert into public.lost_items
  (property_id, found_area_type, area_label, found_at, found_by, category, description)
  values ($1,'public_area','Gym',now(),$2,'clothing','Grey hoodie')`, [DEMO, U.hk])
await expectErr('inactive staff cannot log', U.gone, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description)
  values ($1,'room','101',now(),$2,'other','abc')`, [DEMO, U.gone], 'row-level security')

console.log('\nVisibility')
const seen = await as(U.other, `select count(*)::int n from public.lost_items`)
seen.rows[0].n === 0 ? pass('other hotel sees no DEMO items') : fail('other hotel sees items')
const seenStaff = await as(U.other, `select count(*)::int n from public.staff`)
seenStaff.rows[0].n === 1 ? pass('other hotel sees only its own staff') : fail(`other hotel sees ${seenStaff.rows[0].n} staff`)

console.log('\nDirect writes')
const hkUpd = await as(U.hk, `update public.lost_items set description='x' where id=$1`, [item.id])
hkUpd.affectedRows === 0 ? pass('housekeeping cannot edit items directly') : fail('housekeeping edited item')
await expectErr('front office cannot set status directly', U.fo,
  `update public.lost_items set status='returned' where id=$1`, [item.id], 'item workflow')
await expectOk('front office can fix description', U.fo,
  `update public.lost_items set description='Black USB-C phone charger' where id=$1`, [item.id])
await expectErr('nobody writes the custody ledger directly', U.mgr,
  `insert into public.custody_events (item_id, to_status, actor) values ($1,'returned',$2)`, [item.id, U.mgr], 'row-level security')
const del = await as(U.mgr, `delete from public.custody_events where item_id=$1`, [item.id])
del.affectedRows === 0 ? pass('custody ledger cannot be deleted') : fail('ledger rows deleted')
const delItem = await as(U.mgr, `delete from public.lost_items where id=$1`, [item.id])
delItem.affectedRows === 0 ? pass('items cannot be deleted') : fail('item deleted')

console.log('\nStoring')
await expectErr('storing needs a location', U.hk, `select public.change_status($1,'stored',null,null)`, [item.id], 'storage location')
await expectOk('housekeeping stores standard item on shelf', U.hk, `select public.change_status($1,'stored',$2,null)`, [item.id, SHELF])
const phone = (await logItem(U.hk, { tier: 'valuable' })).rows[0]
await expectErr('valuable item cannot go on a shelf', U.hk, `select public.change_status($1,'stored',$2,null)`, [phone.id, SHELF], 'secure')
await expectOk('valuable item goes in the safe', U.hk, `select public.change_status($1,'stored',$2,null)`, [phone.id, SAFE])
await expectErr('housekeeping cannot skip ahead', U.hk, `select public.change_status($1,'guest_contacted',null,null)`, [item.id], 'Cannot move')
await expectErr('tier cannot rise while on a shelf', U.fo, `select public.set_value_tier($1,'valuable',null)`, [item.id], 'secure location')

console.log('\nMatching')
await expectErr('housekeeping cannot add candidates', U.hk,
  `insert into public.guest_candidates (item_id, reservation_ref, added_by) values ($1,'12345678',$2)`, [item.id, U.hk], 'row-level security')
const c1 = (await expectOk('front office adds candidate', U.fo,
  `insert into public.guest_candidates (item_id, reservation_ref, added_by) values ($1,'12345678',$2) returning id`, [item.id, U.fo]))?.rows[0]
const c2 = (await expectOk('front office adds second candidate', U.fo,
  `insert into public.guest_candidates (item_id, reservation_ref, added_by) values ($1,'87654321',$2) returning id`, [item.id, U.fo]))?.rows[0]
await expectErr('cannot insert pre-confirmed candidate', U.fo,
  `insert into public.guest_candidates (item_id, reservation_ref, added_by, confirmed) values ($1,'99999999',$2,true)`, [item.id, U.fo], 'row-level security')
await expectErr('housekeeping cannot confirm', U.hk, `select public.confirm_candidate($1)`, [c1.id], 'Only front office')
await expectOk('front office confirms candidate 1', U.fo, `select public.confirm_candidate($1)`, [c1.id])
await expectOk('switching to candidate 2', U.fo, `select public.confirm_candidate($1)`, [c2.id])
const conf = await db.query(`select reservation_ref from public.guest_candidates where item_id=$1 and confirmed`, [item.id])
conf.rows.length === 1 && conf.rows[0].reservation_ref === '87654321' ? pass('exactly one confirmed candidate') : fail(JSON.stringify(conf.rows))
;(await status(item.id)) === 'matched' ? pass('item is matched') : fail('status ' + (await status(item.id)))
const delConf = await as(U.fo, `delete from public.guest_candidates where id=$1`, [c2.id])
delConf.affectedRows === 0 ? pass('confirmed candidate cannot be deleted') : fail('confirmed candidate deleted')

console.log('\nReturn in person')
await expectErr('handover before contact', U.fo, `select public.record_handover($1,'in_person',true,null,null,null)`, [item.id], 'not awaiting')
await expectOk('guest contacted', U.fo, `select public.change_status($1,'guest_contacted',null,'Emailed via PMS')`, [item.id])
await expectOk('awaiting collection', U.fo, `select public.change_status($1,'awaiting_collection',null,null)`, [item.id])
await expectErr('handover without ID check', U.fo, `select public.record_handover($1,'in_person',false,null,null,null)`, [item.id], 'ID was checked')
await expectOk('handover with ID check', U.fo, `select public.record_handover($1,'in_person',true,null,null,null)`, [item.id])
;(await status(item.id)) === 'returned' ? pass('item is returned') : fail('status ' + (await status(item.id)))
await expectErr('closed item cannot be moved', U.fo, `select public.move_item($1,$2,null)`, [item.id, SAFE], 'cannot be moved')
await expectErr('no candidates on closed items', U.fo,
  `insert into public.guest_candidates (item_id, reservation_ref, added_by) values ($1,'11111111',$2)`, [item.id, U.fo], 'row-level security')

console.log('\nValuable courier return')
const pc = (await as(U.fo, `insert into public.guest_candidates (item_id, reservation_ref, added_by) values ($1,'55555555',$2) returning id`, [phone.id, U.fo])).rows[0]
await as(U.fo, `select public.confirm_candidate($1)`, [pc.id])
await as(U.fo, `select public.change_status($1,'guest_contacted',null,null)`, [phone.id])
await as(U.fo, `select public.change_status($1,'awaiting_shipping',null,null)`, [phone.id])
await expectErr('courier needs tracking', U.fo, `select public.record_handover($1,'courier',null,null,$2,null)`, [phone.id, U.fo2], 'tracking')
await expectErr('valuable needs a witness', U.fo, `select public.record_handover($1,'courier',null,'RM123GB',null,null)`, [phone.id], 'witness')
await expectErr('cannot witness yourself', U.fo, `select public.record_handover($1,'courier',null,'RM123GB',$2,null)`, [phone.id, U.fo], 'someone else')
await expectErr('inactive witness rejected', U.fo, `select public.record_handover($1,'courier',null,'RM123GB',$2,null)`, [phone.id, U.gone], 'not active')
await expectErr('other-hotel witness rejected', U.fo, `select public.record_handover($1,'courier',null,'RM123GB',$2,null)`, [phone.id, U.other], 'not active')
await expectOk('courier with witness', U.fo, `select public.record_handover($1,'courier',null,'RM123GB',$2,null)`, [phone.id, U.fo2])

console.log('\nRetention and disposal')
const old = (await logItem(U.hk)).rows[0]
await as(U.hk, `select public.change_status($1,'stored',$2,null)`, [old.id, SHELF])
await expectErr('disposal before retention', U.mgr, `select public.record_handover($1,'disposed',null,null,$2,null)`, [old.id, U.fo], 'Retention period')
await db.query(`update public.lost_items set dispose_after = current_date - 1 where id=$1`, [old.id])
await expectErr('front office cannot dispose', U.fo, `select public.record_handover($1,'disposed',null,null,$2,null)`, [old.id, U.mgr], 'Only a manager')
await expectErr('disposal needs a witness', U.mgr, `select public.record_handover($1,'disposed',null,null,null,null)`, [old.id], 'witness')
await expectOk('manager disposes with witness', U.mgr, `select public.record_handover($1,'disposed',null,null,$2,null)`, [old.id, U.fo])

console.log('\nPhotos')
const passport = (await logItem(U.hk, { tier: 'sensitive' })).rows[0]
await expectErr('no photo rows for sensitive items', U.hk,
  `insert into public.item_photos (item_id, storage_path, uploaded_by) values ($1,'x/y/z.jpg',$2)`, [passport.id, U.hk], 'row-level security')
const fresh = (await logItem(U.hk)).rows[0]
await expectOk('photo row for standard item', U.hk,
  `insert into public.item_photos (item_id, storage_path, uploaded_by) values ($1,$2,$3)`, [fresh.id, `${DEMO}/${fresh.id}/a.jpg`, U.hk])
await expectOk('upload object to own hotel folder', U.hk,
  `insert into storage.objects (bucket_id, name) values ('item-photos', $1)`, [`${DEMO}/${fresh.id}/a.jpg`])
await expectErr('upload for sensitive item blocked', U.hk,
  `insert into storage.objects (bucket_id, name) values ('item-photos', $1)`, [`${DEMO}/${passport.id}/a.jpg`], 'row-level security')
await expectErr('upload into other hotel folder blocked', U.hk,
  `insert into storage.objects (bucket_id, name) values ('item-photos', $1)`, [`${OTHER}/${fresh.id}/a.jpg`], 'row-level security')
const otherSees = await as(U.other, `select count(*)::int n from storage.objects`)
otherSees.rows[0].n === 0 ? pass('other hotel cannot see photo objects') : fail('other hotel sees photos')
const hkDel = await as(U.hk, `delete from storage.objects where name like $1`, [`${DEMO}/%`])
hkDel.affectedRows === 0 ? pass('housekeeping cannot delete photos') : fail('housekeeping deleted photo')
await expectErr('cannot make item sensitive while it has photos', U.fo, `select public.set_value_tier($1,'sensitive',null)`, [fresh.id], 'photos')

console.log('\nLedger')
const trail = await db.query(`select to_status, note from public.custody_events where item_id=$1 order by id`, [item.id])
console.log('  ' + trail.rows.map((r) => r.to_status).join(' → '))
trail.rows.length === 7 ? pass('full custody trail for returned item') : fail(`expected 7 events, got ${trail.rows.length}`)

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
