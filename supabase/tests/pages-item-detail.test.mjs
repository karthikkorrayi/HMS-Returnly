// Run with: npm run test:db
// Page port, group 2: the item page (src/lib/queries/item-detail.ts) and its
// actions (src/lib/item-actions.ts), run exactly as the app runs them:
// through the data layer as a staff member, under row-level security, with the
// database's workflow functions deciding what is allowed. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { loadItemDetail } from '../../src/lib/queries/item-detail.ts'
import * as act from '../../src/lib/item-actions.ts'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('pages_item_detail')
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
  hk: '00000000-0000-0000-0000-0000000000d1',
  fo: '00000000-0000-0000-0000-0000000000d2',
  mgr: '00000000-0000-0000-0000-0000000000d3',
  mgr2: '00000000-0000-0000-0000-0000000000d4',
  other: '00000000-0000-0000-0000-0000000000d5',
}
await db.exec(`
  set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into auth.users (id) select unnest(array['${U.hk}','${U.fo}','${U.mgr}','${U.mgr2}','${U.other}']::uuid[]);
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = p), n, n, r::public.staff_role
  from (values ('${U.hk}'::uuid, 'DEMO', 'hk.d', 'housekeeping'), ('${U.fo}'::uuid, 'DEMO', 'fo.d', 'front_office'),
               ('${U.mgr}'::uuid, 'DEMO', 'mgr.d', 'manager'), ('${U.mgr2}'::uuid, 'DEMO', 'mgr2.d', 'manager'),
               ('${U.other}'::uuid, 'OTHER', 'fo.o', 'front_office')) t(u, p, n, r);
  reset role;
`)
const DEMO = (await db.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id
const loc = async (secure) => (await db.query(`select id from public.storage_locations where property_id = $1 and is_secure = $2 order by label limit 1`, [DEMO, secure])).rows[0].id
const SHELF = await loc(false)
const SAFE = await loc(true)

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
const as = (who, fn) => app.withStaff(who, fn)
const detail = (who, id, withCandidates = true) => as(who, (tx) => loadItemDetail(tx, id, { withCandidates }))
// Runs an action the way the server action does and returns the message staff would see ('' = success).
const run = async (who, fn) => {
  try { await as(who, fn); return '' } catch (e) { return act.messageFor(e) || 'UNEXPECTED: ' + e.message }
}

// An item logged by housekeeping (as the app's "Log item" will do).
const item = (await as(U.hk, (tx) => tx.query(`insert into public.lost_items
  (property_id, found_area_type, room_number, found_at, found_by, category, description)
  values ($1, 'room', '101', now(), $2, 'electronics', 'Black phone charger') returning id, item_code`, [DEMO, U.hk]))).rows[0]
const ID = item.id
const status = async () => (await detail(U.mgr, ID)).item.status

console.log('Reading the item page')
const d0 = await detail(U.hk, ID, false)
check(d0?.item.item_code === item.item_code && d0.item.status === 'logged', 'housekeeping sees the item they logged')
check(d0.candidates.length === 0, 'housekeeping is not given the reservation candidates')
check(d0.events.length >= 1 && typeof d0.events[0].id === 'number', 'history is listed, newest first, with numeric ids', JSON.stringify(d0.events[0]))
check(d0.locations.length === 4 && d0.staff.length === 4, 'storage locations and colleagues of this hotel only (4 and 4)', `${d0.locations.length}/${d0.staff.length}`)
check(d0.handover === null && d0.photos.length === 0, 'no handover and no photos yet')
check((await detail(U.other, ID)) === null, 'staff of another hotel get "not found"')
check((await detail(U.hk, 'not-a-uuid')) === null, 'a malformed id gets "not found"')
if (real) {
  check(/^\d{4}-\d\d-\d\dT.*Z$/.test(d0.item.found_at) && /^\d{4}-\d\d-\d\d$/.test(d0.item.dispose_after),
    'times are ISO strings and dates YYYY-MM-DD (as from Supabase)', `${d0.item.found_at} ${d0.item.dispose_after}`)
}

console.log('\nStoring and moving')
check((await run(U.hk, (tx) => act.storeItem(tx, ID, null, null))) === 'Choose a storage location', 'storing needs a location (database message shown)')
check((await run(U.hk, (tx) => act.storeItem(tx, ID, 'nope', null))) === 'Unknown storage location.', 'a malformed location id is refused before the database')
check((await run(U.hk, (tx) => act.storeItem(tx, ID, SHELF, 'shelf A'))) === '' && (await status()) === 'stored', 'housekeeping stores it on a shelf')
check((await run(U.hk, (tx) => act.setTier(tx, ID, 'valuable', null))).startsWith('Only front office or managers'), 'housekeeping cannot change the value tier')
check((await run(U.fo, (tx) => act.setTier(tx, ID, 'priceless', null))) === 'Unknown value tier.', 'unknown tiers are refused')
const tierOnShelf = await run(U.fo, (tx) => act.setTier(tx, ID, 'valuable', null))
check(tierOnShelf !== '' && !tierOnShelf.startsWith('UNEXPECTED'), 'a valuable item cannot stay on an open shelf', tierOnShelf)
check((await run(U.fo, (tx) => act.moveItem(tx, ID, SAFE, 'to safe'))) === '', 'front office moves it to the safe')
check((await run(U.fo, (tx) => act.moveItem(tx, ID, SAFE, null))) === 'Item is already in that location', 'moving to the same place is refused')
check((await run(U.fo, (tx) => act.setTier(tx, ID, 'valuable', null))) === '' && (await detail(U.fo, ID)).item.value_tier === 'valuable', 'then it can be marked valuable')

console.log('\nReservation candidates')
check((await run(U.hk, (tx) => act.addCandidate(tx, U.hk, ID, { reservationRef: 'ABC123', departureDate: null, note: null }))) === 'You can’t do that for this item.',
  'housekeeping cannot add a reservation (row-level security, friendly message)')
check((await run(U.fo, (tx) => act.addCandidate(tx, U.fo, ID, { reservationRef: 'ab c-123', departureDate: '2026-10-20', note: 'checked out Tue' }))) === '', 'front office adds a reservation')
check((await run(U.fo, (tx) => act.addCandidate(tx, U.fo, ID, { reservationRef: 'ABC-123', departureDate: null, note: null }))) === 'That reservation is already listed.', 'the same reservation twice is refused')
check((await run(U.fo, (tx) => act.addCandidate(tx, U.fo, ID, { reservationRef: 'x!', departureDate: null, note: null }))).startsWith('Enter the reservation'), 'a malformed reference is refused')
check((await run(U.fo, (tx) => act.addCandidate(tx, U.mgr, ID, { reservationRef: 'SPOOF1', departureDate: null, note: null }))) === 'You can’t do that for this item.', 'cannot add a reservation in someone else’s name')
await run(U.fo, (tx) => act.addCandidate(tx, U.fo, ID, { reservationRef: 'ZZZ999', departureDate: null, note: null }))
let cands = (await detail(U.fo, ID)).candidates
const keep = cands.find((c) => c.reservation_ref === 'ABC-123'), drop = cands.find((c) => c.reservation_ref === 'ZZZ999')
check(cands.length === 2 && keep.departure_date === (real ? '2026-10-20' : keep.departure_date), 'front office sees both reservations (reference cleaned to ABC-123)', JSON.stringify(cands.map((c) => c.reservation_ref)))
const OTHER_ITEM = (await as(U.hk, (tx) => tx.query(`insert into public.lost_items (property_id, found_area_type, room_number, found_at, found_by, category, description)
  values ($1, 'room', '102', now(), $2, 'clothing', 'Grey hoodie') returning id`, [DEMO, U.hk]))).rows[0].id
check((await run(U.fo, (tx) => act.removeCandidate(tx, OTHER_ITEM, drop.id))).startsWith('That reservation could not be removed'), 'a reservation cannot be removed through a different item')
check((await run(U.fo, (tx) => act.removeCandidate(tx, ID, drop.id))) === '', 'front office removes the wrong reservation')
check((await run(U.fo, (tx) => act.confirmCandidate(tx, keep.id))) === '' && (await status()) === 'matched', 'confirming the right one marks the item matched')
check((await run(U.fo, (tx) => act.removeCandidate(tx, ID, keep.id))).startsWith('That reservation could not be removed'), 'a confirmed reservation cannot be removed')

console.log('\nContacting the guest and handing over')
check((await run(U.fo, (tx) => act.advanceStatus(tx, ID, 'returned', null))) === 'Unknown step.', 'skipping straight to "returned" is refused')
check((await run(U.hk, (tx) => act.advanceStatus(tx, ID, 'guest_contacted', null))).startsWith('Cannot move item'), 'housekeeping cannot contact the guest', await run(U.hk, (tx) => act.advanceStatus(tx, ID, 'guest_contacted', null)))
check((await run(U.fo, (tx) => act.advanceStatus(tx, ID, 'guest_contacted', 'emailed'))) === '', 'front office records the guest was contacted')
check((await run(U.fo, (tx) => act.advanceStatus(tx, ID, 'awaiting_collection', null))) === '' && (await status()) === 'awaiting_collection', 'and that they will collect it')
check((await run(U.fo, (tx) => act.recordHandover(tx, ID, { method: 'in_person', idChecked: false, courierTracking: null, witness: null, note: null }))) === 'Confirm the guest\'s ID was checked', 'handing over needs the ID check')
check((await run(U.fo, (tx) => act.recordHandover(tx, ID, { method: 'teleport', idChecked: true, courierTracking: null, witness: null, note: null }))) === 'Unknown handover.', 'unknown handover methods are refused')
check((await run(U.fo, (tx) => act.recordHandover(tx, ID, { method: 'in_person', idChecked: true, courierTracking: null, witness: null, note: null }))) === 'A second staff member must witness this handover',
  'a valuable item needs a witness at handover')
check((await run(U.fo, (tx) => act.recordHandover(tx, ID, { method: 'in_person', idChecked: true, courierTracking: null, witness: U.fo, note: null }))) === 'The witness must be someone else', 'the witness must be someone else')
const handed = await run(U.fo, (tx) => act.recordHandover(tx, ID, { method: 'in_person', idChecked: true, courierTracking: null, witness: U.mgr, note: 'collected' }))
check(handed === '' && (await status()) === 'returned', 'with the ID checked and a witness the item is returned', handed)
const d1 = await detail(U.mgr, ID)
check(d1.handover?.method === 'in_person' && d1.handover.id_checked === true && d1.handover.handed_over_by === U.fo && d1.handover.witness === U.mgr, 'the handover is recorded: by front office, witnessed by the manager')
check(d1.events.length > d0.events.length + 5 && d1.events[0].to_status === 'returned', `the history shows every step, newest first (${d1.events.length} entries)`)

console.log('\nDisposal needs a manager and a witness')
await db.exec(real ? 'select 1' : 'reset role')
await db.exec(`set role app_owner; update public.lost_items set status = 'stored', storage_location_id = '${SHELF}', dispose_after = '2020-01-01' where id = '${OTHER_ITEM}'; reset role;`)
if (!real) await db.exec('set role app_user')
check((await run(U.fo, (tx) => act.recordHandover(tx, OTHER_ITEM, { method: 'disposed', idChecked: false, courierTracking: null, witness: U.mgr, note: null }))) === 'Only a manager can approve disposal or donation', 'front office cannot dispose')
check((await run(U.mgr, (tx) => act.recordHandover(tx, OTHER_ITEM, { method: 'disposed', idChecked: false, courierTracking: null, witness: null, note: null }))) === 'A second staff member must witness this handover', 'a manager needs a witness')
check((await run(U.mgr, (tx) => act.recordHandover(tx, OTHER_ITEM, { method: 'disposed', idChecked: false, courierTracking: null, witness: 'bad', note: null }))) === 'Unknown witness.', 'a malformed witness id is refused')
check((await run(U.mgr, (tx) => act.recordHandover(tx, OTHER_ITEM, { method: 'disposed', idChecked: false, courierTracking: null, witness: U.mgr2, note: 'past retention' }))) === '', 'with a second manager as witness it is disposed')

console.log('\nError messages')
check(act.messageFor(new Error('connect ECONNREFUSED')) === '', 'unexpected errors are not shown to staff (logged instead)')
check(act.messageFor(Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505' })) === '', 'raw constraint errors are not shown either')

if (real) await pool.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
