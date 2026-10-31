// Run with: npm run test:db
// Page port, group 3 + Phase 5: logging an item (src/lib/log-item.ts) and its
// photos (src/lib/item-photos.ts), run as the app runs them: through the data
// layer as a staff member, under row-level security.
//   Photo store: a real S3-compatible bucket when S3_TEST_ENDPOINT is set
//   (CI starts versitygw for this), otherwise an in-memory stand-in so the
//   database rules are still checked everywhere.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { logItem, LogItemError } from '../../src/lib/log-item.ts'
import { addPhoto, readPhoto, deletePhoto, PhotoRejected } from '../../src/lib/item-photos.ts'
import { makeStore } from '../../src/lib/storage/s3.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, close } = await openTestDb('pages_log_photos')
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const real = kind !== 'PGlite'

// --- Photo store ------------------------------------------------------------------------
const S3 = process.env.S3_TEST_ENDPOINT
let store, storeKind
if (S3) {
  const bucket = `returnly-test-${process.pid}-${randomBytes(3).toString('hex')}`
  store = makeStore({
    endpoint: S3, bucket,
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? '',
    region: process.env.S3_TEST_REGION || 'us-east-1', pathStyle: true,
  })
  check((await store.ensureBucket()) === 'created', `test bucket created on ${new URL(S3).host}`)
  check((await store.ensureBucket()) === 'exists', 'creating it again is harmless')
  storeKind = 'S3 at ' + new URL(S3).host
} else {
  const objects = new Map()
  store = {
    put: async (k, b, t) => { objects.set(k, { body: Uint8Array.from(b), contentType: t }) },
    get: async (k) => objects.get(k) ?? null,
    delete: async (k) => { objects.delete(k) },
    ensureBucket: async () => 'exists',
    _objects: objects,
  }
  storeKind = 'in-memory stand-in (set S3_TEST_ENDPOINT for a real bucket; CI does)'
}
console.log(`database: ${kind}; photo store: ${storeKind}`)

// --- Database ---------------------------------------------------------------------------
await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8')}\n;reset role;`)
}
await db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/seed.sql`, 'utf8')}\n;reset role;`)
const U = {
  hk: '00000000-0000-0000-0000-0000000000e1',
  fo: '00000000-0000-0000-0000-0000000000e2',
  mgr: '00000000-0000-0000-0000-0000000000e3',
  other: '00000000-0000-0000-0000-0000000000e4',
}
await db.exec(`
  set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.rooms (property_id, room_number) select id, '101' from public.properties where inn_code = 'OTHER';
  insert into auth.users (id) select unnest(array['${U.hk}','${U.fo}','${U.mgr}','${U.other}']::uuid[]);
  insert into public.staff (user_id, property_id, username, display_name, role)
  select u, (select id from public.properties where inn_code = p), n, n, r::public.staff_role
  from (values ('${U.hk}'::uuid, 'DEMO', 'hk.p', 'housekeeping'), ('${U.fo}'::uuid, 'DEMO', 'fo.p', 'front_office'),
               ('${U.mgr}'::uuid, 'DEMO', 'mgr.p', 'manager'), ('${U.other}'::uuid, 'OTHER', 'hk.o', 'housekeeping')) t(u, p, n, r);
  reset role;
`)
const DEMO = (await db.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id
const OTHER = (await db.query(`select id from public.properties where inn_code = 'OTHER'`)).rows[0].id

let pool
if (real) {
  const pg = (await import('pg')).default
  const name = (await db.query('select current_database() as d')).rows[0].d
  const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + name; u.username = 'app_user'; u.password = ''
  pool = new pg.Pool({ connectionString: u.toString(), max: 3, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const W = app.withStaff
const asOwner = async (sql, params) => {
  if (!real) await db.exec('reset role')
  try { await db.exec('set role app_owner'); return await db.query(sql, params) } finally { await db.exec(real ? 'reset role' : 'set role app_user') }
}

// An 8×8 red JPEG, and the same with EXIF/GPS, XMP and a comment added.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z', 'base64')
const seg = (m, s) => { const p = Buffer.from(s); return Buffer.concat([Buffer.from([0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff]), p]) }
const DIRTY = Buffer.concat([JPEG.subarray(0, 2), seg(0xe1, 'Exif\0\0GPSLatitude=51.5072 BodySerialNumber=SN-PRIVATE'), seg(0xfe, 'room 214'), JPEG.subarray(2)])

const base = {
  areaType: 'room', roomNumber: '101', areaLabel: null, foundAt: new Date(Date.now() - 3600e3).toISOString(),
  category: 'electronics', description: 'Black phone charger', brand: null, colour: 'black', valueTier: 'standard',
  roomCheckId: null, foundSpot: 'under the bed', spotHidden: true,
}
const log = (who, prop, input = {}) => W(who, (tx) => logItem(tx, who, prop, { ...base, ...input }))
const logErr = async (who, prop, input) => {
  try { await log(who, prop, input); return '' } catch (e) { return e instanceof LogItemError ? e.message : 'UNEXPECTED: ' + e.message }
}

// --- Logging ----------------------------------------------------------------------------
console.log('\nLogging an item')
const ITEM = await log(U.hk, DEMO)
const row = (await asOwner(`select item_code, status::text, found_by, room_number, found_spot, spot_hidden, colour, dispose_after from public.lost_items where id = $1`, [ITEM])).rows[0]
check(/^DEMO-\d{6}-\d{4}$/.test(row.item_code) && row.status === 'logged' && row.found_by === U.hk, `housekeeping logs an item: ${row.item_code}, status logged, in their name`)
check(row.room_number === '101' && row.found_spot === 'under the bed' && row.spot_hidden === true && row.colour === 'black', 'room, spot and details are saved')
const PUB = await log(U.fo, DEMO, { areaType: 'public_area', roomNumber: '999', areaLabel: ' Gym ', foundSpot: 'ignored', spotHidden: true })
const pub = (await asOwner(`select room_number, area_label, found_spot, spot_hidden from public.lost_items where id = $1`, [PUB])).rows[0]
check(pub.room_number === null && pub.area_label === 'Gym' && pub.found_spot === null && pub.spot_hidden === false, 'a public-area item ignores the room fields')
check((await logErr(U.hk, DEMO, { roomNumber: '999' })) === 'That room is not on this hotel’s room list.', 'an unknown room is refused with a plain message')
check((await logErr(U.hk, DEMO, { foundAt: new Date(Date.now() + 3600e3).toISOString() })) === 'The time found can’t be in the future.', 'a time in the future is refused')
check((await logErr(U.hk, DEMO, { description: 'ab' })) === 'Describe the item in 3–500 characters.', 'a too-short description is refused')
check((await logErr(U.hk, DEMO, { category: 'weapons' })) === 'Choose what kind of item it is.', 'an unknown category is refused')
check((await logErr(U.hk, DEMO, { valueTier: 'priceless' })) === 'Choose how valuable it is.', 'an unknown value tier is refused')
check((await logErr(U.hk, DEMO, { areaType: 'public_area', areaLabel: '' })) === 'Say where in the hotel it was found.', 'a public-area item needs a place')
check((await logErr(U.hk, DEMO, { brand: 'x'.repeat(61) })).startsWith('Some details are too long'), 'an over-long brand is refused')
check((await logErr(U.hk, OTHER)) === 'You can’t log items for this hotel.', 'cannot log items into another hotel')
check((await logErr(U.hk, DEMO, { roomCheckId: '00000000-0000-0000-0000-000000000000' })) === 'Room check does not match this item\'s room', 'an unknown room check is refused (database message)')

// --- Photos -----------------------------------------------------------------------------
console.log('\nPhotos')
const has = (buf, t) => Buffer.from(buf).includes(Buffer.from(t))
const P1 = await addPhoto(W, store, U.hk, ITEM, DIRTY)
const saved = (await asOwner(`select storage_path, uploaded_by from public.item_photos where id = $1`, [P1])).rows[0]
check(saved.storage_path === `${DEMO}/${ITEM}/${saved.storage_path.split('/')[2]}` && saved.uploaded_by === U.hk, 'housekeeping adds a photo: recorded at hotel/item/<random>.jpg, in their name')
const got = await readPhoto(W, store, U.fo, P1)
check(got && Buffer.from(got.body).equals(JPEG), 'a colleague sees exactly the photo, with metadata removed')
check(got && !has(got.body, 'GPSLatitude') && !has(got.body, 'SN-PRIVATE') && !has(got.body, 'room 214'), 'no location, serial number or comment is stored')
check((await readPhoto(W, store, U.other, P1)) === null, 'staff of another hotel get nothing (same as "no such photo")')
check((await readPhoto(W, store, U.fo, '00000000-0000-0000-0000-000000000000')) === null && (await readPhoto(W, store, U.fo, '../x')) === null, 'unknown or malformed photo ids get nothing')

const rejects = async (p, re, msg) => {
  try { await p; fail(msg + ' (accepted)') } catch (e) { check(e instanceof PhotoRejected && re.test(e.message), msg, e.message) }
}
await rejects(addPhoto(W, store, U.hk, ITEM, Buffer.from('not a jpeg')), /Only JPEG/, 'a file that is not a JPEG is refused')
await rejects(addPhoto(W, store, U.other, ITEM, JPEG), /Unknown item/, 'another hotel cannot add photos to this item')
await addPhoto(W, store, U.hk, ITEM, JPEG)
await addPhoto(W, store, U.fo, ITEM, JPEG)
await rejects(addPhoto(W, store, U.hk, ITEM, JPEG), /already has 3 photos/, 'a 4th photo is refused')

// Two phones adding the last photo at the same moment: only one wins.
const ITEM2 = await log(U.hk, DEMO, { description: 'Grey hoodie' })
await addPhoto(W, store, U.hk, ITEM2, JPEG); await addPhoto(W, store, U.hk, ITEM2, JPEG)
if (real) {
  const race = await Promise.allSettled([addPhoto(W, store, U.hk, ITEM2, JPEG), addPhoto(W, store, U.fo, ITEM2, JPEG)])
  const n = (await asOwner(`select count(*)::int n from public.item_photos where item_id = $1`, [ITEM2])).rows[0].n
  check(n === 3 && race.filter((r) => r.status === 'fulfilled').length === 1, 'two simultaneous uploads of the last photo: exactly one is accepted', `${n} photos`)
}

const SENS = await log(U.fo, DEMO, { description: 'Passport', valueTier: 'sensitive' })
await rejects(addPhoto(W, store, U.fo, SENS, JPEG), /sensitive or closed/, 'sensitive items cannot get photos')
await asOwner(`update public.lost_items set status = 'returned' where id = $1`, [PUB])
await rejects(addPhoto(W, store, U.fo, PUB, JPEG), /sensitive or closed/, 'closed items cannot get photos')

console.log('\nIf the bucket fails')
const before = (await asOwner(`select count(*)::int n from public.item_photos`)).rows[0].n
const brokenPut = { ...store, put: async () => { throw new Error('bucket unavailable') } }
const ITEM3 = await log(U.hk, DEMO, { description: 'Blue umbrella' })
try { await addPhoto(W, brokenPut, U.hk, ITEM3, JPEG); fail('upload with a failing bucket succeeded') }
catch (e) { check(/bucket unavailable/.test(e.message), 'a failing upload reports an error') }
check((await asOwner(`select count(*)::int n from public.item_photos`)).rows[0].n === before, 'and leaves no photo record behind (rolled back)')

console.log('\nDeleting')
await rejects(deletePhoto(W, store, U.fo, ITEM, P1), /Only managers/, 'front office cannot delete photos')
const brokenDelete = { ...store, delete: async () => { throw new Error('bucket unavailable') } }
try { await deletePhoto(W, brokenDelete, U.mgr, ITEM, P1); fail('delete with a failing bucket succeeded') } catch { pass('a failing delete reports an error') }
check((await readPhoto(W, store, U.mgr, P1)) !== null, 'and the photo is still there, record and file')
await rejects(deletePhoto(W, store, U.mgr, ITEM2, P1), /Only managers/, 'a photo cannot be deleted through a different item')
await deletePhoto(W, store, U.mgr, ITEM, P1)
check((await asOwner(`select count(*)::int n from public.item_photos where id = $1`, [P1])).rows[0].n === 0, 'a manager deletes it: the record is gone')
check((await store.get(saved.storage_path)) === null, 'and so is the file in the bucket')
check((await readPhoto(W, store, U.mgr, P1)) === null, 'it no longer shows')

if (S3) {
  // Leave nothing behind in the test bucket.
  const keys = (await asOwner(`select storage_path from public.item_photos`)).rows.map((r) => r.storage_path)
  for (const k of keys) await store.delete(k)
}
if (real) await pool.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
