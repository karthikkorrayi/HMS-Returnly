// Run with: npm run test:db
// PR D: in-app notifications for hotel staff (migration 018,
// src/lib/notifications.ts), run as the app runs them: staff through the data
// layer with row-level security. Checks who is told about what, per-person
// read/unread, that hotels never see each other's notifications, that nothing
// personal is in the text, and that notifications go with their report.
// Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { submitReport, reportReply } from '../../src/lib/requests/public-queries.ts'
import { loadNotifications, unreadCount, markRead, notificationTarget } from '../../src/lib/notifications.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, close } = await openTestDb('notifications')
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
const M1 = randomUUID(), M2 = randomUUID(), SUP = randomUUID(), HK = randomUUID(), OTHER = randomUUID(), GONE = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${M1}'), ('${M2}'), ('${SUP}'), ('${HK}'), ('${OTHER}'), ('${GONE}');
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role, active)
    select u.id::uuid, p.id, u.un, u.dn, u.role::public.staff_role, u.active from public.properties p,
      (values ('${M1}', 'm1.note', 'Mo', 'manager', true), ('${M2}', 'm2.note', 'Mia', 'manager', true),
              ('${SUP}', 'sup.note', 'Sam', 'support', true), ('${HK}', 'hk.note', 'Hana', 'housekeeping', true),
              ('${GONE}', 'gone.note', 'Gil', 'manager', false)) u(id, un, dn, role, active)
     where p.inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.note', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';`)

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
const report = (o = {}) => ({ innCode: 'DEMO', reportType: 'lost', email: 'ann@example.com', emailConfirmed: true, itemName: 'Blue scarf',
  description: 'Blue wool scarf', category: null, colour: null, brand: null, location: null, date: null,
  customerName: 'Ann Guest', bookingRef: 'BK-1', whereabouts: null, ...o })
const idOf = async (ref) => (await S(M1, (tx) => tx.query(`select id from public.customer_requests where reference = $1`, [ref]))).rows[0].id

console.log('\nNew reports')
const L = await A((tx) => submitReport(tx, report()))
const F = await A((tx) => submitReport(tx, report({ reportType: 'found', email: 'f@example.com', itemName: 'Umbrella', customerName: null, bookingRef: null, whereabouts: 'handed_in' })))
const m1 = await S(M1, (tx) => loadNotifications(tx))
check(m1.length === 2 && m1.every((n) => n.kind === 'new_report' && !n.read), 'every manager is told about each new report', JSON.stringify(m1.map((n) => n.message)))
check(m1.some((n) => n.message === `New lost item report ${L.reference} · Blue scarf`) && m1.some((n) => n.message.startsWith('New found item report')),
  'the text says lost or found, the reference and the item')
check(!JSON.stringify(m1).match(/Ann Guest|BK-1|ann@example\.com/), 'never the guest’s name, booking ID or email')
check((await S(M2, unreadCount)) === 2, 'the second manager has their own 2 unread')
check((await S(SUP, unreadCount)) === 0 && (await S(HK, unreadCount)) === 0, 'support (nothing assigned) and housekeeping are not told')
check((await S(OTHER, unreadCount)) === 0, 'another hotel’s manager is not told')

console.log('\nRead and unread (per person)')
const first = m1.find((n) => n.message.includes(L.reference))
check((await S(M1, (tx) => notificationTarget(tx, first.id))) === await idOf(L.reference), 'a notification opens its report')
await S(M1, (tx) => markRead(tx, first.id))
check((await S(M1, unreadCount)) === 1 && (await S(M2, unreadCount)) === 2, 'marking it read changes only my count')
check((await S(OTHER, (tx) => notificationTarget(tx, first.id))) === null, 'another hotel can’t open it by number')
check((await S(OTHER, (tx) => markRead(tx, first.id))) === 0, '…or mark it read')
await S(M1, (tx) => markRead(tx, first.id))
check((await S(M1, unreadCount)) === 1, 'marking read twice is harmless')
check((await S(M2, (tx) => markRead(tx, null))) === 2 && (await S(M2, unreadCount)) === 0, '"mark all as read" clears mine')
check(/Unknown notification|22023/.test(await errOf(() => S(M1, (tx) => tx.rpc('mark_notifications_read', { p_ids: '1;drop table x' })))), 'only numbers are accepted')

console.log('\nAssignment and replies')
const lid = await idOf(L.reference)
await S(M1, (tx) => tx.rpc('assign_request', { p_request_id: lid, p_staff_id: SUP }))
const sup = await S(SUP, (tx) => loadNotifications(tx))
check(sup.length === 1 && sup[0].kind === 'assigned' && sup[0].message === `Assigned to you: ${L.reference} · Blue scarf`, 'support is told when a report is assigned to them')
check((await S(M2, unreadCount)) === 0, 'managers are not told about an assignment a manager made')
await A((tx) => reportReply(tx, L.reference, L.token, 'It has a red tassel'))
check((await S(SUP, (tx) => loadNotifications(tx))).some((n) => n.kind === 'customer_replied' && n.message.startsWith('The guest replied on')),
  'the assigned support member is told the guest replied')
check((await S(M2, (tx) => loadNotifications(tx))).filter((n) => !n.read).map((n) => n.kind).join() === 'customer_replied', '…and so are the managers')
check(!(await S(SUP, (tx) => loadNotifications(tx))).some((n) => n.kind === 'new_report'), 'support still sees only what is addressed to them')
const fid = await idOf(F.reference)
await S(M1, (tx) => tx.rpc('assign_request', { p_request_id: fid, p_staff_id: M1 }))
check(!(await S(M1, (tx) => loadNotifications(tx))).some((n) => n.kind === 'assigned'), 'assigning a report to yourself doesn’t notify you')

console.log('\nWho can do what')
check((await S(GONE, unreadCount).catch(() => 0)) === 0, 'a deactivated manager sees nothing')
check(await errOf(() => A((tx) => tx.query('select * from public.staff_notifications'))) === '42501', 'guests (anon) cannot read notifications')
check(await errOf(() => S(M1, (tx) => tx.query(`insert into public.staff_notifications (property_id, request_id, kind, message)
  select property_id, id, 'new_report', 'fake' from public.customer_requests limit 1`))) === '42501', 'staff cannot write notifications themselves')
check(await errOf(() => S(M1, (tx) => tx.query(`delete from public.staff_notification_reads`))) === '42501', '…or change read records')
check((await S(M1, (tx) => tx.query(`select count(*)::int n from public.staff_notification_reads`))).rows[0].n === 1, 'I only see my own read records')

console.log('\nRetention')
const owner = async (sql) => { if (!real) await db.exec('reset role'); try { await db.exec(`set role app_owner; ${sql}; reset role;`) } finally { if (!real) await db.exec('set role app_user') } }
await owner(`delete from public.customer_requests where reference = '${L.reference}'`)
check(!(await S(M1, (tx) => loadNotifications(tx))).some((n) => n.message.includes(L.reference)), 'notifications go with their report (daily clean-up)')

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall notification checks passed')
process.exit(failures ? 1 : 0)
