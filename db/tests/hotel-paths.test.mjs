// Run with: npm run test:db
// PR L: hotel addresses are now /<slug> (migration 025). Checks that the
// database refuses every word the app uses itself as a hotel address, and
// that a hotel whose address became reserved stays reachable ("-hotel").
// Both test databases.
import { openTestDb } from './test-db.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { RESERVED_SLUGS } from '../../src/lib/branding-paths.ts'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const MIGRATION = '20261115000025_hotel_paths_email_heartbeat.sql'
const { db, kind, close } = await openTestDb('hotel_paths')
console.log('database: ' + kind)
let failures = 0
const check = (cond, msg, detail = '') => { if (cond) console.log('  ok   ' + msg); else { failures++; console.log('  FAIL ' + msg + (detail ? ' → ' + detail : '')) } }
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)
const q = async (sql, p) => (await db.query(sql, p)).rows

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
const files = readdirSync(`${ROOT}/db/migrations`).sort()
check(files.includes(MIGRATION), 'migration 025 is present')
for (const f of files.filter((f) => f < MIGRATION)) await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))

console.log('\nBefore 025: a hotel whose address is now reserved')
// ITEMS was a valid code and slug before; slug 'items' would now be read as the staff page.
await asOwner(`insert into public.properties (inn_code, name) values ('ITEMS', 'Items Hotel'), ('GRAND', 'Grand Hotel')`)
check((await q(`select slug from public.properties where inn_code = 'ITEMS'`))[0].slug === 'items', 'it had the address “items”')

await asOwner(readFileSync(`${ROOT}/db/migrations/${MIGRATION}`, 'utf8'))
console.log('\nAfter 025')
check((await q(`select slug from public.properties where inn_code = 'ITEMS'`))[0].slug === 'items-hotel', 'it is moved to “items-hotel”')
check((await q(`select slug from public.properties where inn_code = 'GRAND'`))[0].slug === 'grand', 'other hotels keep their address')
for (const w of RESERVED_SLUGS) check((await q(`select public._valid_slug($1) as ok`, [w]))[0].ok === false, `“${w}” is refused`)
check((await q(`select public._valid_slug('grand-london') as ok`))[0].ok === true, 'ordinary addresses are still allowed')
await asOwner(`insert into public.properties (inn_code, name) values ('STAFF', 'Staff Inn')`)
check((await q(`select slug from public.properties where inn_code = 'STAFF'`))[0].slug === 'staff-hotel', 'a new hotel with a reserved code gets “-hotel”')
check(/properties_slug_valid/.test(await db.exec(`set role app_owner; update public.properties set slug = 'settings' where inn_code = 'GRAND'`).then(() => '', (e) => e.message)),
  'the database itself refuses a reserved address')
await db.exec('reset role')

await close()
console.log(failures ? `\n${failures} FAILED` : '\nall hotel address checks passed')
process.exit(failures ? 1 : 0)
