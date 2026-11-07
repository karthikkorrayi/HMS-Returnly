// Run with: npm run test:db
// PR H: the guest contact record (migration 024, src/lib/guest-contacts.ts),
// run as the app runs it: guests submit through the public functions, staff
// read through the data layer with row-level security. Checks: existing
// reports are copied in once; one row per email per hotel (never duplicated);
// managers of that hotel only; nobody can change it from the app; the daily
// clean-up removes a contact once no report from it is left; opening the list
// is logged. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { submitReport } from '../../src/lib/requests/public-queries.ts'
import { countGuestContacts, loadContactViews, loadGuestContacts, logContactsView } from '../../src/lib/guest-contacts.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const MIGRATION = '20261107000024_guest_contacts.sql'
const { db, kind, urlFor, close } = await openTestDb('guest_contacts')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)

// Every migration before 024 first, so the copy of existing reports can be checked.
await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
const files = readdirSync(`${ROOT}/db/migrations`).sort()
check(files.at(-1) === MIGRATION || files.includes(MIGRATION), 'migration 024 is present')
for (const f of files.filter((f) => f < MIGRATION)) await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))
const MGR = randomUUID(), MGR2 = randomUUID(), SUP = randomUUID(), HK = randomUUID(), OTHER = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${MGR}'), ('${MGR2}'), ('${SUP}'), ('${HK}'), ('${OTHER}');
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role)
    select u.id::uuid, p.id, u.un, u.dn, u.role::public.staff_role from public.properties p,
      (values ('${MGR}', 'mgr.gc', 'Mo', 'manager'), ('${MGR2}', 'mgr2.gc', 'Mia', 'manager'),
              ('${SUP}', 'sup.gc', 'Sam', 'support'), ('${HK}', 'hk.gc', 'Hana', 'housekeeping')) u(id, un, dn, role)
     where p.inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.gc', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';`)

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
const S = (who, fn) => app.withStaff(who, fn)
const errOf = async (fn) => { try { await fn(); return '' } catch (e) { return e.code ?? e.message } }
// Owner statements while app_user is the session role on PGlite.
const owner = async (sql) => { if (!real) await db.exec('reset role'); try { return await db.exec(`set role app_owner; ${sql}; reset role;`) } finally { if (!real) await db.exec('set role app_user') } }
const ownerQuery = async (sql) => {
  if (!real) await db.exec('reset role')
  try { await db.exec('set role app_owner'); return (await db.query(sql)).rows } finally { await db.exec('reset role'); if (!real) await db.exec('set role app_user') }
}
let booking = 0
const report = (o = {}) => ({ innCode: 'DEMO', reportType: 'lost', email: 'ann@example.com', emailConfirmed: true, itemName: 'Blue scarf',
  description: 'Blue wool scarf', category: null, colour: null, brand: null, location: null, date: null,
  customerName: 'Ann Guest', bookingRef: `BK-${++booking}`, whereabouts: null, ...o })
const found = (email, o = {}) => report({ reportType: 'found', email, itemName: 'Umbrella', customerName: null, bookingRef: null, whereabouts: 'handed_in', ...o })
const contacts = (who) => S(who, (tx) => loadGuestContacts(tx))

console.log('\nReports already on file are copied in once')
await A((tx) => submitReport(tx, report({ email: 'early@example.com' })))
await A((tx) => submitReport(tx, found('early@example.com')))
await A((tx) => submitReport(tx, report({ email: 'solo@example.com' })))
// Apply 024 now, as the deploy's pre-deploy step would.
if (!real) await db.exec('reset role')
await asOwner(readFileSync(`${ROOT}/db/migrations/${MIGRATION}`, 'utf8'))
if (!real) await db.exec('set role app_user')
let list = await contacts(MGR)
const early = list.find((c) => c.email === 'early@example.com')
check(list.length === 2 && early?.reports_submitted === 2 && early.reports_on_file === 2, 'two reports from one address = one contact (2 reports)', JSON.stringify(list))
check(list.find((c) => c.email === 'solo@example.com')?.reports_submitted === 1, 'one report = one contact')

console.log('\nNew reports: one row per email per hotel, never duplicated')
await A((tx) => submitReport(tx, report({ email: 'Early@Example.com' })))
list = await contacts(MGR)
check(list.filter((c) => c.email === 'early@example.com').length === 1 && list.find((c) => c.email === 'early@example.com').reports_submitted === 3,
  'the same address in other letters is still one contact (3 reports)', JSON.stringify(list))
const before = list.find((c) => c.email === 'early@example.com')
check(new Date(before.last_seen_at) >= new Date(before.first_seen_at), 'first and last seen are kept')
await A((tx) => submitReport(tx, found('new@example.com')))
check((await contacts(MGR)).some((c) => c.email === 'new@example.com'), 'a found report adds a contact too')
await A((tx) => submitReport(tx, report({ innCode: 'OTHER', email: 'early@example.com' })))
check((await contacts(MGR)).length === 3 && (await S(MGR, countGuestContacts)) === 3, 'another hotel’s report doesn’t add to this hotel')
const other = await contacts(OTHER)
check(other.length === 1 && other[0].email === 'early@example.com' && other[0].reports_submitted === 1,
  'the same address at another hotel is that hotel’s own contact', JSON.stringify(other))

console.log('\nWho can see it')
check((await contacts(MGR2)).length === 3, 'every manager of the hotel sees it')
check((await contacts(SUP)).length === 0 && (await contacts(HK)).length === 0, 'support and housekeeping see nothing')
check(await errOf(() => A((tx) => tx.query('select * from public.guest_contacts'))) === '42501', 'guests (anon) cannot read it')
check(await errOf(() => S(MGR, (tx) => tx.query(`insert into public.guest_contacts (property_id, email, first_seen_at, last_seen_at)
  select property_id, 'x@example.com', now(), now() from public.guest_contacts limit 1`))) === '42501', 'staff cannot add contacts')
check(await errOf(() => S(MGR, (tx) => tx.query(`update public.guest_contacts set reports_submitted = 99`))) === '42501', '…or change them')
check(await errOf(() => S(MGR, (tx) => tx.query(`delete from public.guest_contacts`))) === '42501', '…or delete them')

console.log('\nOpening the list is logged')
await S(MGR, logContactsView)
await S(MGR, logContactsView)
let views = await S(MGR, (tx) => loadContactViews(tx))
check(views.length === 1 && views[0].staff_name === 'Mo', 'one entry, not one per refresh (10 minutes)', JSON.stringify(views))
await S(MGR2, logContactsView)
check((await S(MGR, (tx) => loadContactViews(tx))).length === 2, 'each manager is logged')
check(await errOf(() => S(SUP, logContactsView)) === '42501', 'support can’t open the list')
check((await S(OTHER, (tx) => loadContactViews(tx))).length === 0, 'another hotel doesn’t see this hotel’s log')
check((await S(SUP, (tx) => loadContactViews(tx))).length === 0, 'support doesn’t see the log')
check(await errOf(() => S(MGR, (tx) => tx.query(`delete from public.guest_contact_views`))) === '42501', 'the log can’t be deleted from the app')

console.log('\nThe daily clean-up')
// A report the hotel no longer holds (as the retention purge would).
await owner(`delete from public.customer_requests r using public.properties p
              where p.id = r.property_id and p.inn_code = 'DEMO' and r.customer_email = 'solo@example.com'`)
check((await contacts(MGR)).some((c) => c.email === 'solo@example.com' && c.reports_on_file === 0), 'until the clean-up, the contact shows 0 on file')
const [{ s }] = await ownerQuery('select public.run_daily_cleanup() as s')
check(s.ok === true && s.guest_contacts === 1, 'the clean-up removes it and reports how many', JSON.stringify(s))
list = await contacts(MGR)
check(!list.some((c) => c.email === 'solo@example.com'), 'gone the night after its last report')
check(list.some((c) => c.email === 'early@example.com'), 'a contact with reports still on file stays')
check((await contacts(OTHER)).length === 1, 'the other hotel’s contact is untouched')
await owner(`delete from public.customer_requests r using public.properties p
              where p.id = r.property_id and p.inn_code = 'DEMO' and r.customer_email = 'early@example.com' and r.report_type = 'lost'`)
const [{ s: s2 }] = await ownerQuery('select public.run_daily_cleanup() as s')
check(s2.guest_contacts === 0 && (await contacts(MGR)).some((c) => c.email === 'early@example.com' && c.reports_on_file === 1),
  'while one report from the address is left, the contact stays', JSON.stringify(s2))
const runs = await ownerQuery(`select ok, summary from ops.job_runs where job = 'daily_cleanup' order by id desc limit 1`)
check(runs[0]?.ok === true && 'guest_contacts' in runs[0].summary, 'the run is recorded with the contacts count')

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall guest contact checks passed')
process.exit(failures ? 1 : 0)
