// Run with: npm run test:db
// Page port, group 4: customer requests (staff side), Support, and hotel
// settings, run as the app runs them: through the data layer as a staff member
// under row-level security, with the database functions deciding who may do
// what. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { loadRequestList, loadRequestDetail, loadRequestMatches, loadStaffNames, cleanRequestSearch } from '../../src/lib/queries/requests.ts'
import * as act from '../../src/lib/request-actions.ts'
import { saveHotelSettings } from '../../src/lib/hotel-settings.ts'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('pages_requests')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const real = kind !== 'PGlite'

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8')}\n;reset role;`)
}
await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/supabase/seed.sql`, 'utf8')}\n;reset role;`)
const U = {
  mgr: '00000000-0000-0000-0000-0000000000f1',
  sup: '00000000-0000-0000-0000-0000000000f2',
  sup2: '00000000-0000-0000-0000-0000000000f3',
  hk: '00000000-0000-0000-0000-0000000000f4',
  other: '00000000-0000-0000-0000-0000000000f5',
}
await db.exec(`
  set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into auth.users (id) select unnest(array['${U.mgr}','${U.sup}','${U.sup2}','${U.hk}','${U.other}']::uuid[]);
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = p), n, d, r::public.staff_role
  from (values ('${U.mgr}'::uuid, 'DEMO', 'mgr.r', 'Mia Manager', 'manager'), ('${U.sup}'::uuid, 'DEMO', 'sup.r', 'Sam Support', 'support'),
               ('${U.sup2}'::uuid, 'DEMO', 'sup2.r', 'Sky Support', 'support'), ('${U.hk}'::uuid, 'DEMO', 'hk.r', 'Hana HK', 'housekeeping'),
               ('${U.other}'::uuid, 'OTHER', 'mgr.o', 'Otto Other', 'manager')) t(u, p, n, d, r);
  reset role;
`)
const DEMO = (await db.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id

let pool
if (real) {
  const pg = (await import('pg')).default
  const name = (await db.query('select current_database() as d')).rows[0].d
  const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + name; u.username = 'app_user'; u.password = ''
  pool = new pg.Pool({ connectionString: u.toString(), max: 2, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const W = (who, fn) => app.withStaff(who, fn)
const run = async (who, fn) => {
  try { await W(who, fn); return '' } catch (e) { return act.messageFor(e) || 'UNEXPECTED: ' + e.message }
}
const list = (who, opts = {}) => W(who, (tx) => loadRequestList(tx, { status: 'open', search: '', assigned: 'any', page: 1, pageSize: 20, meId: who, ...opts }))

// Customers submit enquiries on the public site (as anon).
const submit = (name, booking, item, desc, extra = {}) => app.withAnon(async (tx) =>
  (await tx.rpc('submit_customer_request', { p_inn_code: 'DEMO', p_customer_name: name, p_booking_ref: booking, p_item_name: item, p_description: desc, ...extra })).rows[0])
const refOf = (r) => Object.values(r)[0]
const R1 = refOf(await submit('Jane Guest', 'BK1001', 'Phone charger', 'White USB-C charger left by the bed', { p_category: 'chargers_cables', p_colour: 'white' }))
const R2 = refOf(await submit('Raj Visitor', 'BK2002', 'Blue scarf', 'Wool scarf, navy blue'))
const R3 = refOf(await submit('Lee Traveller', 'BK3003', 'Sunglasses', 'Black sunglasses in a case'))
const idOf = async (ref) => (await W(U.mgr, (tx) => tx.query(`select id from public.customer_requests where reference = $1`, [ref]))).rows[0].id
const [ID1, ID2, ID3] = [await idOf(R1), await idOf(R2), await idOf(R3)]

// An item the hotel holds that matches R1.
const ITEM = (await W(U.hk, (tx) => tx.query(`insert into public.lost_items (property_id, found_area_type, room_number, found_at, found_by, category, description, colour)
  values ($1, 'room', '101', now() - interval '1 day', $2, 'chargers_cables', 'White USB-C phone charger', 'white') returning id, item_code`, [DEMO, U.hk]))).rows[0]

console.log('\nAdmin list')
const l0 = await list(U.mgr)
check(l0.matching === 3 && l0.total === 3 && l0.counts.pending_review === 3, 'admin sees all 3 new enquiries, counted as pending review', JSON.stringify(l0.counts))
const times = l0.rows.map((x) => new Date(x.created_at).getTime())
check(times.every((t, i) => i === 0 || times[i - 1] >= t) && (!real || typeof l0.rows[0].created_at === 'string'), 'newest first, with plain values')
check(['strong', 'partial', 'weak', null].includes(l0.best[ID1]) && l0.best[ID1] !== null, `best match shown for the charger enquiry (${l0.best[ID1]})`)
check((await list(U.mgr, { search: 'scarf' })).rows.map((r) => r.id).join() === ID2, 'search by item name')
check((await list(U.mgr, { search: 'BK3003' })).rows.map((r) => r.id).join() === ID3, 'search by booking ID')
check((await list(U.mgr, { search: R1.slice(-4) })).rows.some((r) => r.id === ID1), 'search by part of the reference')
check(cleanRequestSearch("x' or 1=1; --") === 'x or 11 --', 'search text is reduced to letters, digits, spaces and dashes')
check((await list(U.mgr, { pageSize: 2, page: 2 })).rows.length === 1, 'paging')
check((await list(U.other)).total === 0, 'another hotel’s admin sees none of them')
check((await list(U.hk)).total === 0, 'housekeeping sees no customer requests')
const names = await W(U.mgr, loadStaffNames)
check(names[U.sup] === 'Sam Support' && !(U.other in names), 'staff names are this hotel’s only')

console.log('\nAssigning and Support')
check((await list(U.sup)).total === 0, 'Support sees nothing until something is assigned to them')
check((await run(U.sup, (tx) => act.assign(tx, ID1, U.sup))) === 'Only an admin can assign requests', 'Support cannot assign')
check((await run(U.mgr, (tx) => act.assign(tx, ID1, U.hk))) === 'Assign to an active Support or Admin member of this hotel', 'cannot assign to housekeeping')
check((await run(U.mgr, (tx) => act.assign(tx, ID1, U.other))) === 'Assign to an active Support or Admin member of this hotel', 'cannot assign to another hotel’s staff')
check((await run(U.mgr, (tx) => act.assign(tx, ID1, 'nope'))) === 'Unknown staff member.', 'a malformed staff id is refused')
check((await run(U.mgr, (tx) => act.assign(tx, ID1, U.sup))) === '', 'admin assigns the charger enquiry to Sam (Support)')
const ls = await list(U.sup)
check(ls.total === 1 && ls.rows[0].id === ID1, 'Sam now sees exactly that one')
const mine = await list(U.sup, { assigned: 'me' }), unassigned = await list(U.mgr, { assigned: 'unassigned' })
check(mine.matching === 1 && unassigned.matching === 2, 'assigned-to-me and unassigned filters', `${mine.matching}/${unassigned.matching}`)
check((await list(U.sup2)).total === 0, 'the other Support member still sees nothing')
check((await W(U.sup2, (tx) => loadRequestDetail(tx, ID1))) === null, 'and gets "not found" for its page')

console.log('\nWorking a request')
check((await run(U.sup, (tx) => act.changeStatus(tx, ID1, 'under_investigation', null))) === '', 'Support starts investigating')
check((await run(U.sup, (tx) => act.addNote(tx, ID1, 'Checked shelf A; one charger matches'))) === '', 'Support adds an internal note')
check((await run(U.sup, (tx) => act.addNote(tx, ID1, '   '))) === 'Write a note first.', 'an empty note is refused')
check((await run(U.sup, (tx) => act.messageCustomer(tx, ID1, 'Is the cable braided?', true))) === '', 'Support asks the customer a question')
const status1 = async () => (await W(U.mgr, (tx) => loadRequestDetail(tx, ID1))).req.status
check((await status1()) === 'awaiting_customer', 'asking moves it to awaiting customer')
await app.withAnon((tx) => tx.rpc('customer_reply', { p_reference: R1, p_booking_ref: 'BK1001', p_body: 'Yes, braided and white' }))
check((await status1()) === 'under_investigation', 'the customer’s reply brings it back to investigation')
check((await run(U.sup, (tx) => act.changeStatus(tx, ID1, 'approved', null))) === 'Approve by choosing the matching item', 'Support cannot approve')
check((await run(U.sup, (tx) => act.changeStatus(tx, ID1, 'nonsense', null))) === 'Unknown status.', 'unknown statuses are refused')
check((await run(U.sup, (tx) => act.changeStatus(tx, ID1, 'awaiting_admin', 'Looks like a match'))) === '', 'Support hands it to the admin')

const d1 = await W(U.mgr, (tx) => loadRequestDetail(tx, ID1))
check(d1.messages.length >= 3 && d1.messages.some((m) => m.sender === 'customer') && typeof d1.messages[0].id === 'number', `messages: customer and staff, numeric ids (${d1.messages.length})`)
check(d1.notes.length === 1 && d1.notes[0].author_id === U.sup, 'the internal note, by Sam')
check(d1.events[0].to_status === 'awaiting_admin' && d1.events.length >= 6, `history newest first (${d1.events.length} entries)`)
check(d1.staff.some((s) => s.user_id === U.sup && s.role === 'support'), 'assignable staff listed with roles')
const matches = await W(U.mgr, (tx) => loadRequestMatches(tx, ID1))
check(matches[0]?.item_id === ITEM.id && Array.isArray(matches[0].reasons) && typeof matches[0].score === 'number', `the held charger is the top match (score ${matches[0]?.score}, ${matches[0]?.band})`)

console.log('\nApproving and closing')
check((await run(U.mgr, (tx) => act.approve(tx, ID1, { itemId: null, itemCode: 'not-a-code', note: null }))).startsWith('Enter the item code'), 'a malformed item code is refused')
check((await run(U.mgr, (tx) => act.approve(tx, ID1, { itemId: null, itemCode: 'DEMO-000101-9999', note: null }))) === 'No item with code DEMO-000101-9999.', 'an unknown item code is refused')
check((await run(U.sup, (tx) => act.approve(tx, ID1, { itemId: ITEM.id, itemCode: null, note: null }))) === 'Only an admin can approve requests', 'Support cannot approve')
check((await run(U.mgr, (tx) => act.approve(tx, ID1, { itemId: null, itemCode: ITEM.item_code.toLowerCase(), note: 'ID to be checked at desk' }))) === '', 'admin approves by the code on the tag')
const d2 = await W(U.mgr, (tx) => loadRequestDetail(tx, ID1))
check(d2.req.status === 'approved' && d2.approvedItem?.id === ITEM.id && d2.approvedItem.item_code === ITEM.item_code, 'approved, linked to the item')
check((await run(U.mgr, (tx) => act.changeStatus(tx, ID2, 'rejected', null))) === 'Give a reason for rejecting', 'rejecting needs a reason')
check((await run(U.mgr, (tx) => act.changeStatus(tx, ID2, 'rejected', 'Nothing like it was found'))) === '', 'admin rejects with a reason')
check((await run(U.mgr, (tx) => act.changeStatus(tx, ID2, 'resolved', null))) === '', 'and closes it')
check((await run(U.mgr, (tx) => act.messageCustomer(tx, ID2, 'Hello again', false))) === 'This request is closed', 'a closed request takes no more messages')
const l1 = await list(U.mgr, { status: 'all' })
check(l1.counts.approved === 1 && l1.counts.resolved === 1 && l1.counts.pending_review === 1 && l1.total === 3, 'counts follow every change', JSON.stringify(l1.counts))
check((await list(U.mgr)).total === 3 && (await list(U.mgr)).matching === 1, 'the Open view lists only the one still open')

console.log('\nHotel settings')
const prop = async () => (await W(U.mgr, (tx) => tx.query(`select retention_days, request_retention_days, trace_window_days from public.properties where id = $1`, [DEMO]))).rows[0]
const before = await prop()
const curReal = (await W(U.mgr, (tx) => tx.query(`select trace_window_days, stay_retention_days, check_due_hours from public.properties where id = $1`, [DEMO]))).rows[0]
check((await run(U.mgr, (tx) => saveHotelSettings(tx, curReal, 120, 400))) === '' && JSON.stringify(await prop()) === JSON.stringify({ ...before, retention_days: 120, request_retention_days: 400 }), 'a manager changes both retention periods')
check((await run(U.mgr, (tx) => saveHotelSettings(tx, curReal, 5, 400))) === 'Keep unclaimed items for 7 to 730 days.', 'out-of-range values are refused before saving')
check((await run(U.sup, (tx) => saveHotelSettings(tx, curReal, 90, 365))) !== '' && (await prop()).retention_days === 120, 'Support cannot change settings')
const halfway = await run(U.mgr, (tx) => saveHotelSettings(tx, { ...curReal, stay_retention_days: 1 }, 200, 400))
check(halfway !== '' && (await prop()).retention_days === 120, 'a change the database refuses saves nothing (one transaction)', halfway)

if (real) await pool.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
