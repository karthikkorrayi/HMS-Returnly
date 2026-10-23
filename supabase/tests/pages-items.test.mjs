// Run with: npm run test:db
// Page port, group 1: the items dashboard query (src/lib/queries/item-dashboard.ts)
// as the app runs it: through the data layer as a staff member, under RLS.
//   both databases: views, counts, retention, search, paging, other hotels hidden,
//                   sensitive items never get a photo, search input is cleaned;
//   real Postgres:  the app's pool settings return dates as 'YYYY-MM-DD' and
//                   timestamps as ISO strings (src/lib/db/pg-types.ts).
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { loadDashboard, cleanSearch } from '../../src/lib/queries/item-dashboard.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('pages_items')
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
const HK = '00000000-0000-0000-0000-0000000000c1'
const OT = '00000000-0000-0000-0000-0000000000c2'
await db.exec(`
  set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.rooms (property_id, room_number) select id, '101' from public.properties where inn_code = 'OTHER';
  insert into auth.users (id) values ('${HK}'), ('${OT}');
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = p), n, n, 'front_office'
  from (values ('${HK}'::uuid, 'DEMO', 'fo.dash'), ('${OT}'::uuid, 'OTHER', 'fo.other')) t(u, p, n);
  reset role;
`)
const DEMO = (await db.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id
const OTHER = (await db.query(`select id from public.properties where inn_code = 'OTHER'`)).rows[0].id

// Items: created as app_owner, then given the status / retention date each case needs.
const make = async (prop, by, { room = '101', status = 'logged', tier = 'standard', dispose = '2099-01-01', desc = 'Test item', hoursAgo = 1 } = {}) => {
  await db.exec('set role app_owner')
  try {
    const r = await db.query(`insert into public.lost_items (property_id, found_area_type, room_number, found_at, found_by, category, description, value_tier)
      values ($1, 'room', $2, now() - make_interval(hours => $3), $4, 'electronics', $5, $6::public.value_tier) returning id, item_code`,
    [prop, room, hoursAgo, by, desc, tier])
    const { id, item_code } = r.rows[0]
    await db.query(`update public.lost_items set status = $2::public.item_status, dispose_after = $3::date where id = $1`, [id, status, dispose])
    return { id, code: item_code }
  } finally {
    await db.exec('reset role')
  }
}
const photo = async (itemId, path, by, secondsAgo) => {
  await db.exec('set role app_owner')
  try {
    await db.query(`insert into public.item_photos (item_id, storage_path, uploaded_by, uploaded_at) values ($1, $2, $3, now() - make_interval(secs => $4))`, [itemId, path, by, secondsAgo])
  } finally { await db.exec('reset role') }
}

const a = await make(DEMO, HK, { room: '101', hoursAgo: 5, desc: 'Phone charger' })
const b = await make(DEMO, HK, { room: '102', status: 'stored', hoursAgo: 4, desc: 'Blue scarf' })
const c = await make(DEMO, HK, { room: '103', status: 'stored', dispose: '2020-01-01', hoursAgo: 3, desc: 'Old umbrella' })
const d = await make(DEMO, HK, { room: '104', status: 'awaiting_collection', hoursAgo: 2, desc: 'Watch', tier: 'valuable' })
const e = await make(DEMO, HK, { room: '105', status: 'returned', hoursAgo: 1, desc: 'Book' })
const s = await make(DEMO, HK, { room: '106', tier: 'sensitive', hoursAgo: 0, desc: 'Passport' })
await make(OTHER, OT, { room: '101', desc: 'Other hotel item' })
await photo(a.id, `${DEMO}/${a.id}/second.jpg`, HK, 10)
await photo(a.id, `${DEMO}/${a.id}/first.jpg`, HK, 60)
await photo(s.id, `${DEMO}/${s.id}/passport.jpg`, HK, 10)

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
const TODAY = '2026-10-24'
const load = (opts, who = HK, prop = DEMO) =>
  app.withStaff(who, (tx) => loadDashboard(tx, { propertyId: prop, view: 'open', search: '', page: 1, pageSize: 12, today: TODAY, ...opts }))
const ids = (r) => r.rows.map((x) => x.id)

console.log('Views and counts')
const open = await load({})
check(JSON.stringify(ids(open)) === JSON.stringify([s.id, d.id, c.id, b.id, a.id]), 'open view: the 5 open items, newest first', JSON.stringify(open.rows.map((r) => r.description)))
check(open.total === 5, 'open total is 5', String(open.total))
check(JSON.stringify(open.counts) === JSON.stringify({ open: 5, storage: 2, return: 1, retention: 1, closed: 1 }),
  'summary counts: open 5, needs storage 2, ready to return 1, retention 1, closed 1', JSON.stringify(open.counts))
const ret = await load({ view: 'retention' })
check(JSON.stringify(ids(ret)) === JSON.stringify([c.id]), 'retention view: only the stored item past its date')
check(JSON.stringify(ids(await load({ view: 'closed' }))) === JSON.stringify([e.id]), 'closed view: the returned item')
check(JSON.stringify(ids(await load({ view: 'return' }))) === JSON.stringify([d.id]), 'ready-to-return view: awaiting collection')

console.log('\nSearch and paging')
const r102 = await load({ search: '102' })
check(ids(r102).includes(b.id) && r102.rows.every((x) => x.room_number === '102' || x.item_code.includes('102')),
  'search by room number finds that room (and only codes containing it)', JSON.stringify(r102.rows.map((x) => [x.room_number, x.item_code])))
const r105 = await load({ search: '105', view: 'closed' })
check(JSON.stringify(ids(r105)) === JSON.stringify([e.id]), 'search applies within the chosen view')
const byCode = await load({ search: a.code.slice(-4) })
check(ids(byCode).includes(a.id), 'search by part of the item code finds it', a.code)
check((await load({ search: '999' })).total === 0, 'search with no match returns nothing')
const p1 = await load({ pageSize: 2, page: 1 }), p3 = await load({ pageSize: 2, page: 3 })
check(p1.rows.length === 2 && p3.rows.length === 1 && p3.total === 5, 'paging: 2 + 2 + 1 items, total stays 5')
check(cleanSearch(" 10%' or 1=1 -- ") === '10or11--' && cleanSearch({}) === '' && cleanSearch('x'.repeat(50)).length === 20,
  'search input is reduced to letters, digits and dashes (max 20)')

console.log('\nIsolation and photos')
const other = await load({}, OT, OTHER)
check(other.total === 1 && other.rows[0].description === 'Other hotel item', 'the other hotel sees only its own item')
const sneaky = await load({}, HK, OTHER)
check(sneaky.total === 0 && sneaky.counts.open === 0, 'asking for another hotel’s id returns nothing (RLS)')
check(open.rows.find((r) => r.id === a.id).first_photo.endsWith('/first.jpg'), 'thumbnail is the earliest photo')
check(open.rows.find((r) => r.id === s.id).first_photo === null, 'sensitive items never get a thumbnail')
check(open.rows.find((r) => r.id === b.id).first_photo === null, 'items without photos have none')

if (real) {
  console.log('\nValue formats (app pool settings)')
  const row = open.rows.find((r) => r.id === c.id)
  check(row.dispose_after === '2020-01-01', 'dates come back as YYYY-MM-DD strings', JSON.stringify(row.dispose_after))
  const ts = await app.withStaff(HK, (tx) => tx.query(`select found_at from public.lost_items where id = $1`, [a.id]))
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(ts.rows[0].found_at), 'timestamps come back as ISO strings in UTC', ts.rows[0].found_at)
  const tz = await app.withStaff(HK, (tx) => tx.query(`select '2026-01-02 03:04:05.5+05:30'::timestamptz as t, '2026-03-04'::date as d`))
  check(tz.rows[0].t === '2026-01-01T21:34:05.500Z' && tz.rows[0].d === '2026-03-04', 'time zones convert correctly; dates never shift a day')
  await pool.end()
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
