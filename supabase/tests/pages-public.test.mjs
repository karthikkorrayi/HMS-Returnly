// Run with: npm run test:db
// Page port, group 5: the public customer pages (src/lib/requests/public-queries.ts),
// run as the app runs them: through the data layer's withAnon(), i.e. as the
// anon role, which may call only the four public functions. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { hotels, submitRequest, requestStatus, reply, friendly } from '../../src/lib/requests/public-queries.ts'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('pages_public')
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
const MGR = '00000000-0000-0000-0000-0000000000a9'
await db.exec(`
  set role app_owner;
  insert into auth.users (id) values ('${MGR}');
  insert into public.staff (user_id, property_id, username, display_name, role)
  select '${MGR}', id, 'mgr.pub', 'Mo Manager', 'manager' from public.properties where inn_code = 'DEMO';
  reset role;
`)

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
const A = (fn) => app.withAnon(fn)
const attempt = async (fn) => { try { await A(fn); return '' } catch (e) { return friendly(e) } }
const enquiry = (over = {}) => ({
  innCode: 'DEMO', customerName: 'Jane Guest', bookingRef: 'BK5005', itemName: 'Silver ring',
  description: 'Thin silver ring with a small stone', category: 'jewellery_watches', colour: 'silver', brand: null,
  lostLocation: 'Bathroom', lostDate: null, ...over,
})

console.log('Public home page')
const list = await A(hotels)
check(list.length === 1 && list[0].inn_code === 'DEMO' && list[0].name === 'Demo Hotel' && Object.keys(list[0]).length === 2, 'lists hotels by code and name only', JSON.stringify(list))

console.log('\nSubmitting an enquiry')
const ref = await A((tx) => submitRequest(tx, enquiry()))
check(/^LF-[0-9A-F]{5}-[0-9A-F]{5}$/.test(ref), `a reference is returned (${ref})`)
check((await attempt((tx) => submitRequest(tx, enquiry({ innCode: 'NOPE' })))) === 'Choose the hotel you stayed at', 'an unknown hotel gets a plain message')
check((await attempt((tx) => submitRequest(tx, enquiry({ bookingRef: 'x' })))).startsWith('Enter the booking ID'), 'a bad booking ID gets a plain message')
check((await attempt((tx) => submitRequest(tx, enquiry({ lostDate: '2000-01-01' })))) === 'The date must be within the last year', 'an old date gets a plain message')

console.log('\nFollowing it')
const view = await A((tx) => requestStatus(tx, ref, 'BK5005'))
check(view?.reference === ref && view.status === 'pending_review' && Array.isArray(view.messages), 'reference + booking ID shows the status and messages')
check(!JSON.stringify(view).includes(MGR) && !('assigned_to' in view) && !('customer_name' in view), 'nothing about staff or other details is returned', Object.keys(view).join(','))
check((await attempt((tx) => requestStatus(tx, ref, 'BK9999'))) === 'No enquiry matches that reference and booking ID', 'the reference alone (wrong booking ID) shows nothing')
check((await attempt((tx) => reply(tx, ref, 'BK5005', 'It has a tiny engraving'))) === '', 'the customer can reply')
const after = await A((tx) => requestStatus(tx, ref, 'BK5005'))
check(after.messages.some((m) => m.sender === 'customer' && m.body.includes('engraving')), 'and sees their reply')

console.log('\nWhat anon cannot do')
const denied = async (sql) => { try { await A((tx) => tx.query(sql)); return 'allowed' } catch (e) { return e.code } }
check((await denied('select * from public.customer_requests')) === '42501', 'cannot read enquiries directly')
check((await denied('select * from public.lost_items')) === '42501', 'cannot read items')
check((await denied('select * from public.staff')) === '42501', 'cannot read staff')
check((await denied(`select public.add_request_note('00000000-0000-0000-0000-000000000000', 'x')`)) === '42501', 'cannot call staff functions')
check(friendly(new Error('connect ECONNREFUSED')) === 'Something went wrong on our side. Please try again in a few minutes.', 'technical errors are never shown to customers')

if (real) await pool.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
