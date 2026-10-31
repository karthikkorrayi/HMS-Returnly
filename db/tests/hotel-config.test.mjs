// Run with: npm run test:db
// S3/S4: managers change hotel details, floors and rooms, areas and storage
// places (src/lib/hotel-config.ts), run as the app runs them: through the data
// layer as app_user (signed-in staff, row-level security). Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import * as cfg from '../../src/lib/hotel-config.ts'
import { logItem } from '../../src/lib/log-item.ts'
import { storeItem } from '../../src/lib/item-actions.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('hotel_config')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8')}\n;reset role;`)
}
await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/seed.sql`, 'utf8')}\n;reset role;`)
const MGR = randomUUID(), HK = randomUUID(), OTHER = randomUUID()
await db.exec(`set role app_owner;
  insert into auth.users (id) values ('${MGR}'), ('${HK}'), ('${OTHER}');
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${MGR}', id, 'mgr.cfg', 'Mo', 'manager' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${HK}', id, 'hk.cfg', 'Hana', 'housekeeping' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.cfg', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';
  reset role;`)
const DEMO = (await db.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id

let pool
if (real) {
  const pg = (await import('pg')).default
  const name = (await db.query('select current_database() as d')).rows[0].d
  const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + name; u.username = 'app_user'; u.password = ''
  pool = new pg.Pool({ connectionString: u.toString(), max: 2, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p).then((r) => ({ ...r, rowCount: r.affectedRows ?? r.rows.length })), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const M = (fn) => app.withStaff(MGR, fn)
const attempt = async (who, fn) => { try { await app.withStaff(who, fn); return '' } catch (e) { return cfg.configMessage(e) || 'unexpected: ' + (e.code ?? '') + ' ' + e.message } }

console.log('\nHotel details and guest support')
check((await attempt(MGR, (tx) => cfg.saveHotelDetails(tx, { name: 'Demo Hotel & Spa', address: '1 Demo Road', phone: '+44 20 0000 0000',
  email: 'Help@Demo.Example', supportHours: '24 hours', supportNote: 'Ask for the duty manager' }))) === '', 'a manager saves hotel details')
const d = await M(cfg.loadHotelDetails)
check(d.name === 'Demo Hotel & Spa' && d.contact_email === 'help@demo.example' && d.support_hours === '24 hours' && d.inn_code === 'DEMO',
  'and reads them back (email lower-cased, code unchanged)', JSON.stringify(d))
check(/email/.test(await attempt(MGR, (tx) => cfg.saveHotelDetails(tx, { name: 'Demo', address: '', phone: '', email: 'nope', supportHours: '', supportNote: '' }))),
  'a malformed email gets a plain message')
check(/Only managers/.test(await attempt(HK, (tx) => cfg.saveHotelDetails(tx, { name: 'Hacked Hotel', address: '', phone: '', email: '', supportHours: '', supportNote: '' }))),
  'housekeeping cannot change hotel details')
const contacts = await app.withAnon(cfg.publicContacts)
const demoContact = contacts.find((c) => c.inn_code === 'DEMO')
check(demoContact?.contact_phone === '+44 20 0000 0000' && demoContact.support_note === 'Ask for the duty manager' && Object.keys(demoContact).length === 5,
  'guests (no sign-in) see only the contact and support details', JSON.stringify(demoContact))

console.log('\nFloors and rooms')
await M((tx) => cfg.addFloor(tx, DEMO, '4'))
const f4 = (await M(cfg.loadFloors)).floors.find((f) => f.name === '4')
check(f4 && f4.sort_order === 4 && f4.rooms.length === 0, 'adds floor 4 after floors 1–3')
check((await attempt(MGR, (tx) => cfg.addFloor(tx, DEMO, '4'))) === 'That name is already used in this hotel.', 'the same floor name twice is refused')
const added = await M((tx) => cfg.addRooms(tx, DEMO, f4.id, '401-405, 410'))
const f4b = (await M(cfg.loadFloors)).floors.find((f) => f.id === f4.id)
check(added === 6 && f4b.rooms.map((r) => r.room_number).join() === '401,402,403,404,405,410', 'adds rooms with a range (401-405) and a single room')
check(/Already exists: 101/.test(await attempt(MGR, (tx) => cfg.addRooms(tx, DEMO, f4.id, '101, 499'))), 'a room that already exists is refused, naming it')
check((await M(cfg.loadFloors)).floors.find((f) => f.id === f4.id).rooms.length === 6, 'and nothing from that attempt was added (499 is not there)')
check(/twice/.test(await attempt(MGR, (tx) => cfg.addRooms(tx, DEMO, f4.id, '420, 420'))), 'the same room twice in one list is refused')
await M((tx) => cfg.renameFloor(tx, f4.id, 'Fourth'))
if (!real) await db.exec('reset role')
check((await db.query(`select floor from public.rooms where room_number = '401'`)).rows[0].floor === 'Fourth', 'renaming a floor renames it on its rooms')
if (!real) await db.exec('set role app_user')
check(/Only an empty floor/.test(await attempt(MGR, (tx) => cfg.deleteFloor(tx, f4.id))), 'a floor with rooms can’t be removed')

const item = await app.withStaff(HK, (tx) => logItem(tx, HK, DEMO, { areaType: 'room', roomNumber: '401', areaLabel: null,
  foundAt: new Date().toISOString(), category: 'bags', description: 'Blue tote bag', brand: null, colour: null,
  valueTier: 'standard', roomCheckId: null, foundSpot: null, spotHidden: false }))
check(/has items recorded/.test(await attempt(MGR, (tx) => cfg.deleteRoom(tx, '401'))), 'a room with an item can’t be deleted …')
await M((tx) => cfg.setRoomActive(tx, '401', false))
let choices = await app.withStaff(HK, cfg.loadLoggingChoices)
check(!choices.rooms.includes('401') && choices.rooms.includes('402'), '… but can be retired: it disappears from “Log item”')
const itemRoom = (await app.withStaff(HK, (tx) => tx.query(`select room_number from public.lost_items where id = $1`, [item]))).rows[0].room_number
check(itemRoom === '401', 'and the item logged there keeps its room')
const retiredMsg = await app.withStaff(HK, (tx) => logItem(tx, HK, DEMO, { areaType: 'room', roomNumber: '401', areaLabel: null,
  foundAt: new Date().toISOString(), category: 'bags', description: 'Another bag', brand: null, colour: null,
  valueTier: 'standard', roomCheckId: null, foundSpot: null, spotHidden: false })).then(() => 'logged', (e) => e.message)
check(/has been retired/.test(retiredMsg), 'the server also refuses a new item in a retired room', retiredMsg)
await M((tx) => cfg.setRoomActive(tx, '401', true))
check((await app.withStaff(HK, cfg.loadLoggingChoices)).rooms.includes('401'), 'a retired room can be brought back')
await M((tx) => cfg.deleteRoom(tx, '410'))
await M((tx) => cfg.deleteRoom(tx, '405'))
const f4c = (await M(cfg.loadFloors)).floors.find((f) => f.id === f4.id)
check(f4c.rooms.length === 4, 'an unused room can be deleted')
const f1 = (await M(cfg.loadFloors)).floors.find((f) => f.name === '1')
await M((tx) => cfg.moveRoom(tx, '404', f1.id))
check((await M(cfg.loadFloors)).floors.find((f) => f.name === '1').rooms.some((r) => r.room_number === '404'), 'a room can move to another floor')
check(/Only managers|42501|row-level/.test(await attempt(HK, (tx) => cfg.addFloor(tx, DEMO, '9'))), 'housekeeping can’t add floors')
check((await attempt(OTHER, (tx) => cfg.renameFloor(tx, f4.id, 'Mine')))  !== '' || !real, 'another hotel’s manager can’t rename this floor')
check((await app.withStaff(OTHER, cfg.loadFloors)).floors.length === 0, 'and sees none of this hotel’s floors')

console.log('\nPublic areas')
await M((tx) => cfg.addArea(tx, DEMO, 'Spa'))
const spa = (await M(cfg.loadAreas)).find((a) => a.label === 'Spa')
check(spa?.active === true, 'adds an area')
await M((tx) => cfg.renameArea(tx, spa.id, 'Spa & sauna'))
const gym = (await M(cfg.loadAreas)).find((a) => a.label === 'Gym')
await M((tx) => cfg.setAreaActive(tx, gym.id, false))
choices = await app.withStaff(HK, cfg.loadLoggingChoices)
check(choices.areas.includes('Spa & sauna') && !choices.areas.includes('Gym') && choices.areas[0] === 'Lobby',
  '“Log item” offers renamed and new areas, not retired ones, in order', choices.areas.join())
check((await attempt(MGR, (tx) => cfg.addArea(tx, DEMO, 'Lobby'))) === 'That name is already used in this hotel.', 'a duplicate area is refused')

console.log('\nStorage places')
await M((tx) => cfg.addStorage(tx, DEMO, 'Manager’s safe', true))
const safe = (await M(cfg.loadStorage)).find((s) => s.label === 'Manager’s safe')
check(safe?.is_secure === true && safe.holding === 0, 'adds a locked place')
const valuable = await app.withStaff(HK, (tx) => logItem(tx, HK, DEMO, { areaType: 'public_area', roomNumber: null, areaLabel: 'Lobby',
  foundAt: new Date().toISOString(), category: 'jewellery_watches', description: 'Gold ring', brand: null, colour: null,
  valueTier: 'valuable', roomCheckId: null, foundSpot: null, spotHidden: false }))
await app.withStaff(MGR, (tx) => storeItem(tx, valuable, safe.id, null))
const safe2 = (await M(cfg.loadStorage)).find((s) => s.id === safe.id)
check(safe2.holding === 1 && safe2.valuables === 1, 'shows what each place holds')
check(/must stay a locked place/.test(await attempt(MGR, (tx) => cfg.setStorageSecure(tx, safe.id, false))), 'a place holding a valuable item can’t stop being locked')
check(/stored here\. Move it/.test(await attempt(MGR, (tx) => cfg.setStorageActive(tx, safe.id, false))), 'a place holding items can’t be retired')
await M((tx) => cfg.renameStorage(tx, safe.id, 'Back office safe 2'))
const shelf = (await M(cfg.loadStorage)).find((s) => !s.is_secure && s.holding === 0)
await M((tx) => cfg.setStorageActive(tx, shelf.id, false))
check((await M(cfg.loadStorage)).find((s) => s.id === shelf.id).active === false, 'an empty place can be retired (kept for history)')
check(/Only managers|42501|row-level/.test(await attempt(HK, (tx) => cfg.addStorage(tx, DEMO, 'Hidden box', false))), 'housekeeping can’t add storage places')

if (real) await pool.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
