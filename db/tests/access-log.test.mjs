// Run with: npm run test:db
// Audit log of staff opening customer reports (migration 020,
// src/lib/access-log.ts), through the data layer with row-level security.
// Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { submitReport } from '../../src/lib/requests/public-queries.ts'
import { logReportView, loadAccessLog } from '../../src/lib/access-log.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, close } = await openTestDb('access_log')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))
const MGR = randomUUID(), SUP = randomUUID(), HK = randomUUID(), OTHER = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${MGR}'), ('${SUP}'), ('${HK}'), ('${OTHER}');
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role)
    select u.id::uuid, p.id, u.un, u.dn, u.role::public.staff_role from public.properties p,
      (values ('${MGR}', 'mgr.log', 'Mo', 'manager'), ('${SUP}', 'sup.log', 'Sam', 'support'), ('${HK}', 'hk.log', 'Hana', 'housekeeping')) u(id, un, dn, role)
     where p.inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.log', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';`)

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
const S = (who, fn) => app.withStaff(who, fn)
const errOf = async (fn) => { try { await fn(); return '' } catch (e) { return e.code ?? e.message } }
const R = await app.withAnon((tx) => submitReport(tx, { innCode: 'DEMO', reportType: 'lost', email: 'ann@example.com', emailConfirmed: true,
  itemName: 'Scarf', description: 'Blue scarf', category: null, colour: null, brand: null, location: null, date: null,
  customerName: 'Ann Guest', bookingRef: 'BK-1', whereabouts: null }))
const rid = (await S(MGR, (tx) => tx.query(`select id from public.customer_requests where reference = $1`, [R.reference]))).rows[0].id

console.log('\nOpening a report is recorded')
await S(MGR, (tx) => logReportView(tx, rid))
let log = await S(MGR, (tx) => loadAccessLog(tx))
check(log.length === 1 && log[0].staff_name === 'Mo' && log[0].reference === R.reference && log[0].action === 'viewed_report', 'who, which report, when')
await S(MGR, (tx) => logReportView(tx, rid))
check((await S(MGR, (tx) => loadAccessLog(tx))).length === 1, 'opening it again within 10 minutes is not recorded twice')
check(await errOf(() => S(SUP, (tx) => logReportView(tx, rid))) === 'P0002', 'support can’t open (or be logged for) a report not assigned to them')
await S(MGR, (tx) => tx.rpc('assign_request', { p_request_id: rid, p_staff_id: SUP }))
await S(SUP, (tx) => logReportView(tx, rid))
log = await S(MGR, (tx) => loadAccessLog(tx))
check(log.length === 2 && log[0].staff_name === 'Sam', 'once assigned, support’s view is recorded too')
check(await errOf(() => S(OTHER, (tx) => logReportView(tx, rid))) === 'P0002', 'another hotel’s manager can’t open it')

console.log('\nWho can read or change the log')
check((await S(OTHER, (tx) => loadAccessLog(tx))).length === 0, 'another hotel’s manager sees none of it')
check((await S(SUP, (tx) => loadAccessLog(tx))).length === 0 && (await S(HK, (tx) => loadAccessLog(tx))).length === 0, 'support and housekeeping can’t read it')
check(await errOf(() => S(MGR, (tx) => tx.query(`delete from public.customer_data_access`))) === '42501', 'a manager can’t delete entries')
check(await errOf(() => S(MGR, (tx) => tx.query(`update public.customer_data_access set staff_id = staff_id`))) === '42501', '…or change them')
check(await errOf(() => app.withAnon((tx) => tx.query(`select * from public.customer_data_access`))) === '42501', 'guests can’t read it')

console.log('\nAfter the report is deleted')
const owner = async (sql) => { if (!real) await db.exec('reset role'); try { await db.exec(`set role app_owner; ${sql}; reset role;`) } finally { if (!real) await db.exec('set role app_user') } }
await owner(`delete from public.customer_requests where id = '${rid}'`)
log = await S(MGR, (tx) => loadAccessLog(tx))
check(log.length === 2 && log.every((r) => r.request_id === null && r.reference === R.reference), 'the entries stay, with the reference (the daily clean-up deletes the report, not the record of who saw it)')

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall access-log checks passed')
process.exit(failures ? 1 : 0)
