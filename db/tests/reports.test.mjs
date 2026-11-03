// Run with: npm run test:db
// PR B: lost and found reports, the customer's confirmed email, and private
// tracking links (migration 016, src/lib/requests/public-queries.ts), run as
// the app runs them: guests through the data layer as anon, staff as
// authenticated with row-level security. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { submitReport, reportStatus, reportReply, requestStatus, friendly } from '../../src/lib/requests/public-queries.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, close } = await openTestDb('reports')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
}
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))
const MGR = randomUUID(), SUP = randomUUID(), OTHER = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${MGR}'), ('${SUP}'), ('${OTHER}');
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${MGR}', id, 'mgr.rep', 'Mo', 'manager' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${SUP}', id, 'sup.rep', 'Sam', 'support' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.rep', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';`)

let pool
if (real) {
  const pg = (await import('pg')).default
  pool = new pg.Pool({ connectionString: urlFor('app_user'), max: 3, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p).then((r) => ({ ...r, rowCount: r.affectedRows ?? r.rows.length })), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const A = (fn) => app.withAnon(fn)
const attempt = async (fn) => { try { await A(fn); return '' } catch (e) { return friendly(e) } }
const owner = async (sql) => {
  if (!real) await db.exec('reset role')
  try { await db.exec(`set role app_owner; ${sql}; reset role;`); return (await db.query(`select 1`)).rows } finally { if (!real) await db.exec('set role app_user') }
}
const ownerRows = async (sql) => {
  if (!real) await db.exec('reset role')
  try { return (await db.query(sql)).rows } finally { if (!real) await db.exec('set role app_user') }
}

const lost = (o = {}) => ({
  innCode: 'DEMO', reportType: 'lost', email: '  Guest.One@Example.COM ', emailConfirmed: true,
  itemName: 'Blue scarf', description: 'Blue wool scarf with a tassel', category: 'clothing', colour: 'blue', brand: null,
  location: 'Restaurant', date: null, customerName: 'Ann Guest', bookingRef: 'BK-1001', whereabouts: null, ...o,
})
const found = (o = {}) => ({
  innCode: 'DEMO', reportType: 'found', email: 'finder@example.org', emailConfirmed: true,
  itemName: 'Black umbrella', description: '', category: null, colour: null, brand: null,
  location: 'Lobby', date: null, customerName: null, bookingRef: null, whereabouts: 'with_finder', ...o,
})

console.log('\nLost report')
const L = await A((tx) => submitReport(tx, lost()))
check(/^LF-[0-9A-F]{5}-[0-9A-F]{5}$/.test(L.reference) && /^[0-9a-f]{64}$/.test(L.token), 'returns a reference and a separate 64-character token')
const row = (await ownerRows(`select * from public.customer_requests where reference = '${L.reference}'`))[0]
check(row.customer_email === 'guest.one@example.com' && row.email_confirmed_at && row.report_type === 'lost', 'email stored lower-case with the confirmation time')
check(row.tracking_token_hash && row.tracking_token_hash !== L.token && !JSON.stringify(row).includes(L.token), 'only the token’s hash is stored, never the token')
check((await attempt((tx) => submitReport(tx, lost({ emailConfirmed: false })))) === 'Please confirm your email address', 'refused until the email is confirmed on screen')
check((await attempt((tx) => submitReport(tx, lost({ email: 'not-an-email' })))) === 'Enter a valid email address', 'a malformed email is refused')
check((await attempt((tx) => submitReport(tx, lost({ bookingRef: null })))).startsWith('Enter the booking ID'), 'a lost report still needs the booking ID')
check((await attempt((tx) => submitReport(tx, lost({ customerName: '' })))).startsWith('Enter your name'), '…and the name')

console.log('\nFound report')
const F = await A((tx) => submitReport(tx, found()))
const frow = (await ownerRows(`select * from public.customer_requests where reference = '${F.reference}'`))[0]
check(frow.report_type === 'found' && frow.customer_name === null && frow.booking_ref === null && frow.found_whereabouts === 'with_finder',
  'no name or booking ID needed; where it is now is recorded')
check(frow.description === 'Black umbrella', 'with no details, the item name is the description')
check((await attempt((tx) => submitReport(tx, found({ whereabouts: null })))) === 'Say where the item is now', 'where it is now is required')
check((await attempt((tx) => submitReport(tx, found({ reportType: 'stolen' })))) === 'Choose whether you lost or found an item', 'only lost or found')
const fmsg = (await ownerRows(`select body from public.request_messages m join public.customer_requests r on r.id = m.request_id
  where r.reference = '${F.reference}' and m.sender = 'system'`))[0].body
check(/reception/.test(fmsg), 'the finder is asked to hand it in at reception')

console.log('\nTracking link')
const v = await A((tx) => reportStatus(tx, L.reference, L.token))
check(v.reference === L.reference && v.hotel_name && v.report_type === 'lost' && v.status === 'pending_review', 'the link shows the report, hotel and status')
const shown = JSON.stringify(v)
check(!shown.includes('guest.one@example.com') && !shown.includes('BK-1001') && !shown.includes('Ann Guest'), 'never the email, booking ID or name')
const bad = 'This tracking link is not valid or has expired'
check((await attempt((tx) => reportStatus(tx, L.reference, F.token))) === bad, 'another report’s token does not open it')
check((await attempt((tx) => reportStatus(tx, L.reference, 'f'.repeat(64)))) === bad, 'a made-up token gets the same message')
check((await attempt((tx) => reportStatus(tx, L.reference, L.token.toUpperCase()))) === bad, 'tokens are exact (no case games)')
check((await A((tx) => requestStatus(tx, L.reference, 'BK-1001'))).hotel_name, 'reference + booking ID still works for lost reports')
check((await attempt((tx) => requestStatus(tx, F.reference, ''))).startsWith('No enquiry matches'), 'a found report can’t be opened without its link')
await A((tx) => reportReply(tx, F.reference, F.token, 'I will drop it at reception at 6pm'))
check((await A((tx) => reportStatus(tx, F.reference, F.token))).messages.some((m) => m.sender === 'customer' && /6pm/.test(m.body)), 'a reply through the link is added')

console.log('\nExpiry (enforced by the database)')
await owner(`update public.customer_requests set status = 'resolved', closed_at = now() - interval '29 days' where reference = '${L.reference}'`)
check((await A((tx) => reportStatus(tx, L.reference, L.token))).status === 'resolved', 'closed 29 days ago: the link still works')
check((await attempt((tx) => reportReply(tx, L.reference, L.token, 'hello'))).startsWith('This report is closed'), '…but no new messages')
await owner(`update public.customer_requests set closed_at = now() - interval '31 days' where reference = '${L.reference}'`)
check((await attempt((tx) => reportStatus(tx, L.reference, L.token))) === bad, 'closed 31 days ago: the link has expired')
const R2 = await A((tx) => submitReport(tx, lost({ email: 'two@example.com', bookingRef: 'BK-2002' })))
await owner(`update public.customer_requests set status = 'rejected', updated_at = now() - interval '40 days' where reference = '${R2.reference}'`)
check((await attempt((tx) => reportStatus(tx, R2.reference, R2.token))) === bad, 'rejected 40 days ago: expired too')

console.log('\nAbuse limits')
for (let i = 0; i < 3; i++) await A((tx) => submitReport(tx, found({ email: 'busy@example.com' })))
await A((tx) => submitReport(tx, lost({ email: 'busy@example.com', bookingRef: 'BK-3003' })))
await A((tx) => submitReport(tx, lost({ email: 'busy@example.com', bookingRef: 'BK-3004' })))
check((await attempt((tx) => submitReport(tx, found({ email: 'BUSY@example.com' })))).startsWith('This email address already has several reports today'),
  'at most 5 reports per email address per day (case-insensitive)')

console.log('\nStaff')
const fid = frow.id
const staffErr = async (who, fn) => { try { await app.withStaff(who, fn); return '' } catch (e) { return e.message } }
check(/can't be approved|can’t be approved|can't be approved/.test(await staffErr(MGR, (tx) => tx.rpc('approve_request', { p_request_id: fid, p_item_id: randomUUID(), p_note: null }))),
  'a found report can’t be approved against an item')
check((await staffErr(MGR, (tx) => tx.rpc('set_request_status', { p_request_id: fid, p_to: 'resolved', p_note: 'Handed in' }))) === '',
  'a manager resolves a found report straight from open')
const lostOpen = await A((tx) => submitReport(tx, lost({ email: 'three@example.com', bookingRef: 'BK-4004' })))
const lid = (await ownerRows(`select id from public.customer_requests where reference = '${lostOpen.reference}'`))[0].id
check(/can't move|can’t move/.test(await staffErr(MGR, (tx) => tx.rpc('set_request_status', { p_request_id: lid, p_to: 'resolved', p_note: null }))),
  'a lost report still can’t jump from open to resolved')
const seen = await app.withStaff(MGR, (tx) => tx.query(`select customer_email from public.customer_requests where id = $1`, [lid]))
check(seen.rows[0]?.customer_email === 'three@example.com', 'the hotel’s manager sees the customer’s email')
const other = await app.withStaff(OTHER, (tx) => tx.query(`select count(*)::int n from public.customer_requests where report_type in ('lost', 'found')`))
check(other.rows[0].n === 0, 'another hotel’s manager sees none of these reports')
const sup = await app.withStaff(SUP, (tx) => tx.query(`select count(*)::int n from public.customer_requests where id = $1`, [lid]))
check(sup.rows[0].n === 0, 'support staff see only reports assigned to them')

console.log('\nThe table itself')
const err = async (sql) => { try { await owner(sql); return '' } catch (e) { return e.code ?? e.message } }
check(await err(`insert into public.customer_requests (property_id, reference, item_name, description)
  select id, 'LF-AAAAA-BBBBB', 'x thing', 'x thing' from public.properties where inn_code = 'DEMO'`) === '23514',
  'a lost report without name and booking ID is refused by the table')
check(await err(`insert into public.customer_requests (property_id, reference, report_type, item_name, description)
  select id, 'LF-AAAAA-CCCCC', 'found', 'x thing', 'x thing' from public.properties where inn_code = 'DEMO'`) === '23514',
  'a found report without where it is now is refused by the table')

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall report checks passed')
process.exit(failures ? 1 : 0)
