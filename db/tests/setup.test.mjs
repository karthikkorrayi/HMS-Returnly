// Run with: npm run test:db
// Migration 012: first-time hotel setup, floors, areas, hotel details and
// staff edits. Run as the app runs them: through the data layer as app_user
// (anon before anyone can sign in, then signed-in staff). Both test databases.
//   Part 1: a brand-new installation (no seed): the setup screen's database side.
//   Part 2: an installation that already had a hotel before 012 (the upgrade path).
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const MIGRATIONS = readdirSync(`${ROOT}/db/migrations`).sort()
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))

async function open(suite, { upTo = MIGRATIONS.length, seed = false } = {}) {
  const t = await openTestDb(suite)
  await t.db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
  for (const f of MIGRATIONS.slice(0, upTo)) {
    await t.db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8')}\n;reset role;`)
  }
  if (seed) await t.db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/seed.sql`, 'utf8')}\n;reset role;`)
  return t
}

async function appDb(t) {
  if (t.kind !== 'PGlite') {
    const pg = (await import('pg')).default
    const name = (await t.db.query('select current_database() as d')).rows[0].d
    const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + name; u.username = 'app_user'; u.password = ''
    const pool = new pg.Pool({ connectionString: u.toString(), max: 4, types: returnlyTypes })
    return { app: createDb(pool), end: () => pool.end() }
  }
  // PGlite: one connection; the owner work below happens before switching to app_user.
  const client = { query: (q, p) => t.db.query(q, p), release: () => {} }
  return { app: createDb({ connect: async () => client }), end: async () => {}, single: true }
}

const codeOf = async (p) => { try { await p; return 'ok' } catch (e) { return e.code ?? e.message } }
const msgOf = async (p) => { try { await p; return 'ok' } catch (e) { return e.message } }

// ============================================================================
console.log('Part 1: a brand-new installation')
const t1 = await open('setup')
console.log('database: ' + t1.kind)
const real = t1.kind !== 'PGlite'

// Logins exist before setup runs (the app creates them with Better Auth first).
const ADMIN = randomUUID(), HK = randomUUID(), OTHER_MGR = randomUUID(), SPARE = randomUUID()
await t1.db.exec(`set role app_owner;
  insert into auth.users (id) values ('${ADMIN}'), ('${HK}'), ('${OTHER_MGR}'), ('${SPARE}');
  reset role;`)
if (!real) await t1.db.exec('set role app_user')
const { app, end } = await appDb(t1)
// Reads and writes as the database owner (PGlite has one connection: step out of app_user and back).
const own = async (q, p) => {
  if (!real) await t1.db.exec('reset role')
  try { return await t1.db.query(q, p ?? []) } finally { if (!real) await t1.db.exec('set role app_user') }
}
const ownExec = async (sql) => {
  if (!real) await t1.db.exec('reset role')
  try { await t1.db.exec(sql) } finally { if (!real) await t1.db.exec('set role app_user') }
}
const A = (fn) => app.withAnon(fn)
const S = (id, fn) => app.withStaff(id, fn)
const setup = (userId, config, username = 'gm.admin') => A((tx) =>
  tx.query(`select public.complete_initial_setup($1::uuid, $2, $3, $4::jsonb) as id`, [userId, username, 'Grace Manager', JSON.stringify(config)]))
const goodConfig = {
  hotel: { code: 'grand', name: 'The Grand Test Hotel', address: '1 Test Street, London', phone: '+44 20 7946 0000',
    email: 'Desk@Grand.Example', support_hours: 'Every day 08:00–20:00', support_note: 'Ask for the duty manager.' },
  floors: [
    { name: 'Ground', rooms: ['G01', 'G02'] },
    { name: '1', rooms: ['101', '102', '103'] },
  ],
  areas: ['Lobby', 'Restaurant', 'Spa'],
  storage: [{ label: 'Front desk safe', secure: true }, { label: 'Housekeeping shelf A' }],
}
const statusNow = async () => (await A((tx) => tx.query('select public.setup_status() as s'))).rows[0].s

console.log('\nBefore setup')
check((await statusNow()) === false, 'setup_status() is false on a fresh installation')
for (const table of ['installation', 'floors', 'areas', 'properties']) {
  check((await codeOf(A((tx) => tx.query(`select * from public.${table}`)))) === '42501', `anon cannot read ${table}`)
}

console.log('\nBad setup attempts leave nothing behind')
const bad = [
  [{ ...goodConfig, hotel: { ...goodConfig.hotel, code: 'x' } }, /Hotel code/, 'a bad hotel code'],
  [{ ...goodConfig, hotel: { ...goodConfig.hotel, name: ' ' } }, /Hotel name/, 'a missing hotel name'],
  [{ ...goodConfig, floors: [] }, /at least one floor/, 'no floors'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: [] }] }, /add its room numbers/, 'a floor without rooms'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: ['101'] }, { name: '1', rooms: ['102'] }] }, /listed twice/, 'the same floor twice'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: ['101'] }, { name: '2', rooms: ['101'] }] }, /Room 101 is listed twice/, 'the same room on two floors'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: ['10 1'] }] }, /letters, digits or dashes/, 'a room number with a space'],
  [{ ...goodConfig, areas: ['Lobby', 'Lobby'] }, /Area "Lobby" is listed twice/, 'the same area twice'],
  [{ ...goodConfig, hotel: { ...goodConfig.hotel, email: 'not-an-email' } }, /contact_email|check constraint/, 'a malformed email'],
]
for (const [cfg, re, what] of bad) {
  const m = await msgOf(setup(ADMIN, cfg))
  check(re.test(m), `refused: ${what}`, m)
}
check(/administrator login was not found/.test(await msgOf(setup(randomUUID(), goodConfig))), 'refused: an admin login that does not exist')
const left = (await own(`select (select count(*) from public.properties)::int p, (select count(*) from public.floors)::int f,
  (select count(*) from public.rooms)::int r, (select count(*) from public.staff)::int s, (select count(*) from public.installation)::int i`)).rows[0]
check(left.p + left.f + left.r + left.s + left.i === 0, 'after every refusal: no hotel, floor, room, staff or setup row exists', JSON.stringify(left))
check((await statusNow()) === false, 'and setup is still offered')

console.log('\nSetup')
const created = await setup(ADMIN, goodConfig)
const propertyId = created.rows[0].id
check(/^[0-9a-f-]{36}$/.test(propertyId), 'complete_initial_setup() returns the new hotel id')
check((await statusNow()) === true, 'setup_status() is now true')
const prop = (await own(`select * from public.properties`)).rows
check(prop.length === 1 && prop[0].inn_code === 'GRAND' && prop[0].name === 'The Grand Test Hotel' && prop[0].contact_email === 'desk@grand.example'
  && prop[0].support_hours === 'Every day 08:00–20:00', 'hotel saved: code upper-cased, email lower-cased, contact and support details', JSON.stringify(prop[0]))
const floors = (await own(`select f.name, f.sort_order, array_agg(r.room_number order by r.room_number) rooms, bool_and(r.floor = f.name) synced
  from public.floors f join public.rooms r on r.floor_id = f.id group by f.id order by f.sort_order`)).rows
check(floors.length === 2 && floors[0].name === 'Ground' && floors[1].rooms.join() === '101,102,103' && floors.every((f) => f.synced),
  'floors saved in order, each room linked to its floor, rooms.floor shows the floor name', JSON.stringify(floors))
const areas = (await own(`select label from public.areas order by sort_order`)).rows.map((r) => r.label)
check(areas.join() === 'Lobby,Restaurant,Spa', 'areas saved in order', areas.join())
const storage = (await own(`select label, is_secure from public.storage_locations order by label`)).rows
check(storage.length === 2 && storage[0].is_secure === true && storage[1].is_secure === false, 'storage places saved (secure flag kept)')
const admin = (await own(`select username, role::text role, active from public.staff where user_id = $1`, [ADMIN])).rows[0]
check(admin?.username === 'gm.admin' && admin.role === 'manager' && admin.active, 'the first administrator is an active manager')
const inst = (await own(`select property_id, completed_by from public.installation`)).rows
check(inst.length === 1 && inst[0].property_id === propertyId && inst[0].completed_by === ADMIN, 'installation records the hotel and who set it up')

console.log('\nSetup happens once')
check((await codeOf(setup(SPARE, { ...goodConfig, hotel: { ...goodConfig.hotel, code: 'OTHER' } }, 'second.admin'))) === '42501', 'a second setup is refused, even with a different hotel')
check((await own(`select count(*)::int n from public.properties`)).rows[0].n === 1, 'still exactly one hotel')
check((await codeOf(S(ADMIN, (tx) => tx.query(`select public.complete_initial_setup($1::uuid, 'x.y', 'X', '{}'::jsonb)`, [SPARE])))) === '42501',
  'signed-in staff cannot call the setup function at all')

console.log('\nThe administrator manages the hotel')
const mine = await S(ADMIN, async (tx) => ({
  floors: (await tx.query(`select name from public.floors order by sort_order`)).rows.length,
  areas: (await tx.query(`select label from public.areas`)).rows.length,
  rooms: (await tx.query(`select room_number from public.rooms`)).rows.length,
}))
check(mine.floors === 2 && mine.areas === 3 && mine.rooms === 5, 'sees the hotel’s floors, areas and rooms', JSON.stringify(mine))
await S(ADMIN, (tx) => tx.query(`insert into public.floors (property_id, name, sort_order) values ($1, '2', 3)`, [propertyId]))
await S(ADMIN, (tx) => tx.query(`insert into public.rooms (property_id, room_number, floor_id)
  select $1, '201', id from public.floors where name = '2'`, [propertyId]))
await S(ADMIN, (tx) => tx.query(`update public.floors set name = 'First' where name = '1'`))
const renamed = (await own(`select floor from public.rooms where room_number in ('101','201') order by room_number`)).rows.map((r) => r.floor)
check(renamed.join() === 'First,2', 'adds a floor and a room; renaming a floor updates its rooms', renamed.join())
await S(ADMIN, (tx) => tx.query(`update public.rooms set active = false where room_number = 'G02'`))
await S(ADMIN, (tx) => tx.query(`insert into public.areas (property_id, label, sort_order) values ($1, 'Car park', 4)`, [propertyId]))
await S(ADMIN, (tx) => tx.query(`update public.areas set active = false where label = 'Spa'`))
const after = (await own(`select (select active from public.rooms where room_number = 'G02') g02,
  (select count(*)::int from public.areas where active) areas`)).rows[0]
check(after.g02 === false && after.areas === 3, 'retires a room and an area (kept for history) and adds an area')
check((await codeOf(S(ADMIN, (tx) => tx.query(`insert into public.floors (property_id, name) values ($1, 'Roof')`, [randomUUID()])))) !== 'ok',
  'cannot add a floor to another hotel')

await S(ADMIN, (tx) => tx.query(`select public.update_hotel_details('The Grand', '2 New Road', '+44 20 0000 0000', 'help@grand.example', '24 hours', null)`))
const hotel = (await own(`select name, address, support_hours, support_note, inn_code from public.properties`)).rows[0]
check(hotel.name === 'The Grand' && hotel.address === '2 New Road' && hotel.support_hours === '24 hours' && hotel.support_note === null && hotel.inn_code === 'GRAND',
  'updates hotel details; the hotel code stays the same', JSON.stringify(hotel))
check((await codeOf(S(ADMIN, (tx) => tx.query(`select public.update_hotel_details('The Grand', null, null, 'nope', null, null)`)))) === '23514',
  'a malformed contact email is refused')

console.log('\nStaff: names and roles')
await S(ADMIN, (tx) => tx.query(`select public.add_staff_member($1, 'hk.anna', 'Anna', 'housekeeping')`, [HK]))
check((await codeOf(S(HK, (tx) => tx.query(`insert into public.floors (property_id, name) values ($1, '9')`, [propertyId])))) === '42501',
  'housekeeping can read but not change floors')
check((await S(HK, (tx) => tx.query(`select name from public.floors`))).rows.length === 3, 'housekeeping sees the floors (for logging items)')
check((await codeOf(S(HK, (tx) => tx.query(`select public.update_hotel_details('X Hotel', null, null, null, null, null)`)))) === '42501',
  'housekeeping cannot change hotel details')
check((await codeOf(S(HK, (tx) => tx.query(`select public.update_staff_member($1, 'Anna B', 'manager')`, [HK])))) === '42501',
  'housekeeping cannot change staff (or promote themselves)')
await S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Anna Brown', 'manager')`, [HK]))
const anna = (await own(`select display_name, role::text role from public.staff where user_id = $1`, [HK])).rows[0]
check(anna.display_name === 'Anna Brown' && anna.role === 'manager', 'a manager renames a staff member and makes them a manager (a second admin)')
check(/own role/.test(await msgOf(S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Grace', 'support')`, [ADMIN])))),
  'a manager cannot change their own role')
await S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Grace M', 'manager')`, [ADMIN]))
check((await own(`select display_name from public.staff where user_id = $1`, [ADMIN])).rows[0].display_name === 'Grace M', 'but can change their own name')
await S(HK, (tx) => tx.query(`select public.update_staff_member($1, 'Anna Brown', 'housekeeping')`, [HK]).catch((e) => { throw e }))
  .then(() => fail('a manager changed their own role'), () => pass('the second manager cannot demote themselves either'))
await S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Anna Brown', 'housekeeping')`, [HK]))
check((await own(`select role::text r from public.staff where user_id = $1`, [HK])).rows[0].r === 'housekeeping', 'and can be set back to housekeeping by another manager')

console.log('\nAnother hotel in the same database stays separate')
await ownExec(`set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role)
  select '${OTHER_MGR}', id, 'other.mgr', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';
  reset role;`)
const otherSees = await S(OTHER_MGR, async (tx) => (await tx.query(`select count(*)::int n from public.floors`)).rows[0].n
  + (await tx.query(`select count(*)::int n from public.areas`)).rows[0].n)
check(otherSees === 0, 'the other hotel’s manager sees none of these floors or areas')
check((await codeOf(S(OTHER_MGR, (tx) => tx.query(`select public.update_staff_member($1, 'Hacked', 'support')`, [ADMIN])))) === 'P0002',
  'and cannot change this hotel’s staff')

await end()
await t1.close()

if (real) {
  console.log('\nTwo setup screens submitted at the same moment (real Postgres)')
  const tr = await open('setup_race')
  const U1 = randomUUID(), U2 = randomUUID()
  await tr.db.exec(`set role app_owner; insert into auth.users (id) values ('${U1}'), ('${U2}'); reset role;`)
  const r = await appDb(tr)
  const go = (u, code, name) => codeOf(r.app.withAnon((tx) => tx.query(`select public.complete_initial_setup($1::uuid, $2, 'Admin', $3::jsonb)`,
    [u, name, JSON.stringify({ ...goodConfig, hotel: { ...goodConfig.hotel, code } })])))
  const results = (await Promise.all([go(U1, 'RACEA', 'race.a'), go(U2, 'RACEB', 'race.b')])).sort()
  const counts = (await tr.db.query(`select (select count(*)::int from public.properties) p, (select count(*)::int from public.installation) i`)).rows[0]
  check(results.join() === '42501,ok' && counts.p === 1 && counts.i === 1, 'exactly one wins; the other is refused; one hotel exists', `${results} ${JSON.stringify(counts)}`)
  await r.end()
  await tr.close()
}

// ============================================================================
console.log('\nPart 2: upgrading an installation that already had a hotel')
const t2 = await open('setup_upgrade', { upTo: MIGRATIONS.indexOf('20261030000012_hotel_setup.sql'), seed: true })
await t2.db.exec(`set role app_owner;
  insert into public.rooms (property_id, room_number, floor) select id, '1001', '10' from public.properties where inn_code = 'DEMO';
  insert into public.rooms (property_id, room_number, floor) select id, 'PH1', 'Penthouse' from public.properties where inn_code = 'DEMO';
  reset role;`)
await t2.db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/20261030000012_hotel_setup.sql`, 'utf8')}\n;reset role;`)
const up = (await t2.db.query(`select
  (select string_agg(name, ',' order by sort_order) from public.floors) floors,
  (select count(*)::int from public.rooms where floor_id is null) unlinked,
  (select count(*)::int from public.areas) areas,
  (select p.inn_code from public.installation i join public.properties p on p.id = i.property_id) installed`)).rows[0]
check(up.floors === '1,2,3,10,Penthouse', 'floors created from the rooms’ floor text, numbers in number order', up.floors)
check(up.unlinked === 0, 'every room is linked to its floor')
check(up.areas === 9, 'the nine areas the app used to hard-code are added')
check(up.installed === 'DEMO', 'the existing hotel counts as set up (no setup screen after the upgrade)')
await t2.close()

// Fresh local development database (migrations, then seed): set up, with floors and areas.
const t3 = await open('setup_seed', { seed: true })
const seeded = (await t3.db.query(`select (select count(*)::int from public.floors) f, (select count(*)::int from public.rooms where floor_id is null) u,
  (select count(*)::int from public.areas) a, (select count(*)::int from public.installation) i`)).rows[0]
check(seeded.f === 3 && seeded.u === 0 && seeded.a === 9 && seeded.i === 1, 'a fresh local database from the seed is set up, with floors and areas', JSON.stringify(seeded))
await t3.close()

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
