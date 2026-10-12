/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// Customer enquiries and the Support role (migrations 0007–0008): public
// submit/status/reply, privacy, matching, and what each role may do.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const db = new PGlite()
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }

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
}
await db.exec(readFileSync(`${REPO}/seed.sql`, 'utf8'))

const U = {
  mgr: '00000000-0000-0000-0000-000000000001',
  fo: '00000000-0000-0000-0000-000000000002',
  hk: '00000000-0000-0000-0000-000000000003',
  sup: '00000000-0000-0000-0000-000000000004',
  sup2: '00000000-0000-0000-0000-000000000005',
}
await db.exec(`
  insert into auth.users (id) values ${Object.values(U).map((u) => `('${u}')`).join(',')};
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = 'DEMO'), n, n, r::public.staff_role
  from (values
    ('${U.mgr}'::uuid, 'mgr1', 'manager'),
    ('${U.fo}'::uuid, 'fo01', 'front_office'),
    ('${U.hk}'::uuid, 'hk01', 'housekeeping'),
    ('${U.sup}'::uuid, 'sup1', 'support'),
    ('${U.sup2}'::uuid, 'sup2', 'support')
  ) as t(u, n, r);
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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const submit = (booking, extra = {}) => {
  const v = { name: 'Ben Carter', item: 'Bracelet', desc: 'Gold Pandora bracelet with a small heart charm', cat: 'jewellery_watches', colour: 'Gold', brand: 'Pandora', where: 'Bedroom', date: day(-1), ...extra }
  return as('anon', `select public.submit_customer_request('demo', $1, $2, $3, $4, $5, $6, $7, $8, $9::date) as ref`,
    [v.name, booking, v.item, v.desc, v.cat, v.colour, v.brand, v.where, v.date])
}
const status = (ref, booking) => as('anon', `select public.customer_request_status($1, $2) as s`, [ref, booking])

// Fixtures: a stay for booking ABC123 in room 109, an item found there, an unrelated item.
await as(U.fo, `select public.import_stays($1::jsonb)`, [JSON.stringify([
  { room_number: '109', reservation_ref: 'ABC123', guest_surname: 'Carter', check_in_date: day(-3), check_out_date: day(-1), status: 'departed' },
])])
const bracelet = (await as(U.hk, `insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description, brand, colour, found_spot)
  values ($1, 'room', '109', now() - interval '20 hours', $2, 'jewellery_watches', 'Gold bracelet with heart charm', 'Pandora', 'Gold', 'Behind bedside table')
  returning id, item_code`, [DEMO, U.hk])).rows[0]
const charger = (await as(U.hk, `insert into public.lost_items
  (property_id, found_area_type, area_label, found_at, found_by, category, description, colour)
  values ($1, 'public_area', 'Lobby', now() - interval '2 days', $2, 'chargers_cables', 'Black USB-C phone charger', 'Black')
  returning id`, [DEMO, U.hk])).rows[0]

// --- Public: submit -------------------------------------------------------------
console.log('Customer submits an enquiry (not signed in)')
const props = (await as('anon', `select * from public.public_properties()`)).rows
props.some((p) => p.inn_code === 'DEMO') ? pass('hotel list available without sign-in') : fail(JSON.stringify(props))
await err('booking ID is validated', 'anon', `select public.submit_customer_request('DEMO','Ben','!!','Ring','Gold ring')`, [], 'booking ID')
await err('unknown hotel rejected', 'anon', `select public.submit_customer_request('NOPE','Ben','ABC123','Ring','Gold ring')`, [], 'hotel')
await err('future date rejected', 'anon',
  `select public.submit_customer_request('DEMO','Ben','ABC123','Ring','Gold ring',null,null,null,null,$1::date)`, [day(2)], 'last year')
const ref = (await submit('abc 123'))?.rows[0].ref
;/^LF-[0-9A-F]{5}-[0-9A-F]{5}$/.test(ref) ? pass(`reference ${ref}`) : fail('bad reference ' + ref)
const row = (await db.query(`select booking_ref, status from public.customer_requests where reference=$1`, [ref])).rows[0]
row.booking_ref === 'ABC123' && row.status === 'pending_review' ? pass('booking ID normalised; status Pending review') : fail(JSON.stringify(row))
const refOther = (await submit('ZZZ999', { item: 'Umbrella', desc: 'Large red umbrella', cat: 'other', colour: 'Red', brand: '' }))?.rows[0].ref

console.log('\nPublic access is limited to the customer’s own enquiry')
await err('anon cannot read requests table', 'anon', `select * from public.customer_requests`, [], 'permission denied')
await err('anon cannot read notes', 'anon', `select * from public.request_notes`, [], 'permission denied')
await err('anon cannot read items', 'anon', `select * from public.lost_items`, [], 'permission denied')
await err('wrong booking ID gives no status', 'anon', `select public.customer_request_status($1, 'WRONG1')`, [ref], 'No enquiry matches')
let s = (await status(ref, 'ABC123')).rows[0].s
s.status === 'pending_review' && s.messages.length === 2 ? pass('status + customer/system messages returned') : fail(JSON.stringify(s))
;['item_code', 'approved_item_id', 'assigned_to', 'customer_name', 'notes'].some((k) => k in s)
  ? fail('status leaks internal fields') : pass('status has no item, staff or internal fields')

for (let i = 0; i < 5; i++) await submit('LIMIT1')
await err('6th enquiry for one booking in a day is refused', 'anon',
  `select public.submit_customer_request('DEMO','Ben','LIMIT1','Ring','Gold ring')`, [], 'several enquiries')

// --- Staff visibility ---------------------------------------------------------------
console.log('\nWho sees enquiries')
const count = async (u) => (await as(u, `select count(*)::int n from public.customer_requests`)).rows[0].n
;(await count(U.mgr)) >= 7 ? pass('admin sees every enquiry') : fail('admin sees ' + (await count(U.mgr)))
;(await count(U.hk)) === 0 ? pass('housekeeping sees none') : fail('housekeeping sees some')
;(await count(U.fo)) === 0 ? pass('front office sees none') : fail('front office sees some')
;(await count(U.sup)) === 0 ? pass('support sees none until assigned') : fail('support sees unassigned')
const reqId = (await db.query(`select id from public.customer_requests where reference=$1`, [ref])).rows[0].id
await err('unassigned support cannot open matches', U.sup, `select * from public.match_request_items($1)`, [reqId], 'not found')

// --- Matching -------------------------------------------------------------------------
console.log('\nMatching (staff only)')
const m = (await ok('admin runs matching', U.mgr, `select * from public.match_request_items($1)`, [reqId]))?.rows ?? []
m[0]?.item_id === bracelet.id && m[0]?.band === 'strong' ? pass(`bracelet is a strong match (score ${m[0]?.score})`) : fail(JSON.stringify(m[0]))
m[0]?.reasons.some((r) => r.includes('room 109')) ? pass('reason: found in the booking’s room') : fail(JSON.stringify(m[0]?.reasons))
m.some((x) => x.item_id === charger.id) ? fail('unrelated charger matched') : pass('unrelated charger not suggested')
const otherId = (await db.query(`select id from public.customer_requests where reference=$1`, [refOther])).rows[0].id
const m2 = (await as(U.mgr, `select * from public.match_request_items($1)`, [otherId])).rows
m2.every((x) => x.band !== 'strong') ? pass('umbrella enquiry has no strong match') : fail(JSON.stringify(m2))

// --- Assignment and support work --------------------------------------------------------
console.log('\nAssignment and support workflow')
await err('support cannot assign', U.sup, `select public.assign_request($1, $2)`, [reqId, U.sup], 'Only an admin')
await err('cannot assign to housekeeping', U.mgr, `select public.assign_request($1, $2)`, [reqId, U.hk], 'Support or Admin')
await ok('admin assigns to support', U.mgr, `select public.assign_request($1, $2)`, [reqId, U.sup])
;(await count(U.sup)) === 1 ? pass('assigned support now sees it') : fail('support sees ' + (await count(U.sup)))
;(await count(U.sup2)) === 0 ? pass('other support member still sees none') : fail('sup2 sees it')
await ok('support runs matching on assigned request', U.sup, `select * from public.match_request_items($1)`, [reqId])
await ok('support moves to Under investigation', U.sup, `select public.set_request_status($1, 'under_investigation')`, [reqId])
await ok('support adds an internal note', U.sup, `select public.add_request_note($1, 'Checked shelf B: bracelet matches photo. Heart charm present.')`, [reqId])
await err('support cannot reject', U.sup, `select public.set_request_status($1, 'rejected', 'no')`, [reqId], "can't move")
await err('support cannot resolve', U.sup, `select public.set_request_status($1, 'resolved')`, [reqId], "can't move")
await err('support cannot approve', U.sup, `select public.approve_request($1, $2)`, [reqId, bracelet.id], 'Only an admin')
await ok('support asks the customer a question', U.sup,
  `select public.message_customer($1, 'What is engraved on the clasp?', true)`, [reqId])
s = (await status(ref, 'ABC123')).rows[0].s
s.status === 'awaiting_customer' && s.messages.some((x) => x.sender === 'staff' && x.body.includes('engraved'))
  ? pass('customer sees the question and Awaiting your reply') : fail(JSON.stringify(s))
JSON.stringify(s).includes('shelf B') ? fail('internal note leaked to customer') : pass('internal note never shown to customer')
await ok('customer replies with reference + booking ID', 'anon', `select public.customer_reply($1, 'ABC123', 'It says "B & L 2019"')`, [ref])
const afterReply = (await db.query(`select status from public.customer_requests where id=$1`, [reqId])).rows[0].status
afterReply === 'under_investigation' ? pass('reply moves it back to Under investigation') : fail(afterReply)
await ok('support marks ready for admin', U.sup, `select public.set_request_status($1, 'awaiting_admin')`, [reqId])

console.log('\nSupport can read items but not change them')
const supItems = (await as(U.sup, `select count(*)::int n from public.lost_items`)).rows[0].n
supItems >= 2 ? pass('support can read items to investigate') : fail('support reads ' + supItems)
await err('support cannot log items', U.sup, `insert into public.lost_items
  (property_id, found_area_type, area_label, found_at, found_by, category, description)
  values ($1,'public_area','Lobby',now(),$2,'other','Test')`, [DEMO, U.sup], 'Support staff')
await err('support cannot change item status', U.sup, `select public.change_status($1,'stored',(select id from public.storage_locations limit 1),null)`,
  [bracelet.id], 'Support staff')
await err('support cannot add possible owners', U.sup,
  `insert into public.guest_candidates (item_id, reservation_ref, added_by) values ($1,'XYZ123',$2)`, [bracelet.id, U.sup], '')

// --- Admin decision ---------------------------------------------------------------------
console.log('\nAdmin decision')
await err('approval needs an item', U.mgr, `select public.set_request_status($1, 'approved')`, [reqId], 'matching item')
await ok('admin approves with the matched item', U.mgr, `select public.approve_request($1, $2, 'Engraving matches')`, [reqId, bracelet.id])
const cand = (await db.query(`select reservation_ref, note from public.guest_candidates where item_id=$1`, [bracelet.id])).rows
cand.some((c) => c.reservation_ref === 'ABC123' && c.note.includes(ref)) ? pass('booking added as possible owner on the item') : fail(JSON.stringify(cand))
const itemStatus = (await db.query(`select status from public.lost_items where id=$1`, [bracelet.id])).rows[0].status
itemStatus === 'logged' ? pass('approval does not release or move the item by itself') : fail(itemStatus)
s = (await status(ref, 'ABC123')).rows[0].s
s.status === 'approved' && !JSON.stringify(s).includes(bracelet.item_code) ? pass('customer sees Approved, no item code') : fail(JSON.stringify(s))
await err('reject needs a reason', U.mgr, `select public.set_request_status($1, 'rejected')`, [otherId], 'reason')
await ok('admin rejects the umbrella enquiry with a reason', U.mgr, `select public.set_request_status($1, 'rejected', 'Nothing matching held')`, [otherId])
await ok('admin resolves after return', U.mgr, `select public.set_request_status($1, 'resolved', 'Collected with ID')`, [reqId])
await err('customer cannot reply to a closed enquiry', 'anon', `select public.customer_reply($1, 'ABC123', 'thanks')`, [ref], 'closed')
s = (await status(ref, 'ABC123')).rows[0].s
s.can_reply === false ? pass('status page knows replies are closed') : fail(JSON.stringify(s))

console.log('\nAudit trail')
const ev = (await as(U.mgr, `select action from public.request_events where request_id=$1 order by id`, [reqId])).rows.map((r) => r.action)
const expected = ['submitted', 'assigned', 'status_changed', 'note_added', 'asked_customer', 'customer_replied', 'status_changed', 'approved', 'status_changed']
JSON.stringify(ev) === JSON.stringify(expected) ? pass('every step recorded: ' + ev.join(' → ')) : fail(ev.join(','))
await err('nobody writes the audit trail directly', U.mgr,
  `insert into public.request_events (request_id, action) values ($1,'fake')`, [reqId], 'permission denied')
const hkNotes = (await as(U.hk, `select count(*)::int n from public.request_notes`)).rows[0].n
hkNotes === 0 ? pass('housekeeping cannot read internal notes') : fail('hk reads notes')

console.log('\nRetention')
await db.query(`update public.customer_requests set updated_at = now() - interval '400 days' where id = $1`, [otherId])
const purged = (await db.query(`select public.purge_closed_requests() n`)).rows[0].n
purged === 1 ? pass('closed enquiries past retention are deleted') : fail('purged ' + purged)
await err('staff cannot run the purge', U.mgr, `select public.purge_closed_requests()`, [], 'permission denied')

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
