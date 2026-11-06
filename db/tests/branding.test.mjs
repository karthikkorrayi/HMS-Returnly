// Run with: npm run test:db
// PR E: hotel branding and hotel addresses (migration 019, src/lib/branding.ts,
// scripts/email/dispatch.mjs), run as the app runs them: managers through the
// data layer with row-level security, guests as anon. The photo bucket is
// replaced by an in-memory store. Both test databases.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import * as br from '../../src/lib/branding.ts'
import { configMessage } from '../../src/lib/hotel-config.ts'
import { submitReport } from '../../src/lib/requests/public-queries.ts'
import { dispatch } from '../../scripts/email/dispatch.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, connectAs, close } = await openTestDb('branding')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)
// An 8×8 JPEG, as the phone sends after shrinking.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z', 'base64')

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
// An existing hotel before 019, with a code that is a reserved word.
const files = readdirSync(`${ROOT}/db/migrations`).sort()
for (const f of files.filter((f) => f < '20261104000019')) await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))
await asOwner(`insert into public.properties (inn_code, name) values ('APP', 'App Hotel'), ('OTHER', 'Other Hotel')`)
for (const f of files.filter((f) => f >= '20261104000019')) await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))

const MGR = randomUUID(), HK = randomUUID(), OTHER = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${MGR}'), ('${HK}'), ('${OTHER}');
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${MGR}', id, 'mgr.brand', 'Mo', 'manager' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${HK}', id, 'hk.brand', 'Hana', 'housekeeping' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.brand', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';`)

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
const attempt = async (who, fn) => { try { await S(who, fn); return '' } catch (e) { return e instanceof br.BrandingError ? e.message : configMessage(e) || (e.code ?? e.message) } }
const ownerDb = real
  ? await connectAs('app_owner')
  : { query: async (sql, p) => { await db.exec('reset role; set role app_owner'); try { return await db.query(sql, p) } finally { await db.exec('reset role; set role app_user') } } }
const DEMO = (await ownerDb.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id

console.log('\nWeb addresses (slugs)')
const slugs = Object.fromEntries((await ownerDb.query(`select inn_code, slug from public.properties`)).rows.map((r) => [r.inn_code, r.slug]))
check(slugs.DEMO === 'demo' && slugs.OTHER === 'other', 'existing hotels get their code in lower case', JSON.stringify(slugs))
check(slugs.APP === 'app-hotel', 'a code that is a reserved word gets "-hotel"')
await ownerDb.query(`insert into public.properties (inn_code, name) values ('NEWH', 'New Hotel')`)
check((await ownerDb.query(`select slug from public.properties where inn_code = 'NEWH'`)).rows[0].slug === 'newh', 'a new hotel (first-time setup) gets one automatically')

console.log('\nManagers change branding')
check(await attempt(MGR, (tx) => br.saveBranding(tx, { slug: 'grand-london', colour: '#0B3D2E', intro: 'Thank you for staying with us.' })) === '', 'a manager saves address, colour and welcome line')
const b = await S(MGR, br.loadBranding)
check(b.slug === 'grand-london' && b.brand_colour === '#0b3d2e' && b.brand_intro === 'Thank you for staying with us.', 'and reads them back (colour in lower case)', JSON.stringify(b))
check((await attempt(MGR, (tx) => br.saveBranding(tx, { slug: 'other', colour: '', intro: '' }))) === 'That web address is already used by another hotel.', 'another hotel’s address is refused')
check(/reserved word/.test(await attempt(MGR, (tx) => br.saveBranding(tx, { slug: 'admin', colour: '', intro: '' }))), 'a reserved word is refused')
check(/too light/.test(await attempt(MGR, (tx) => br.saveBranding(tx, { slug: 'grand-london', colour: '#ffee99', intro: '' }))), 'a colour too light for white text is refused')
check(/plain text/.test(await attempt(MGR, (tx) => br.saveBranding(tx, { slug: 'grand-london', colour: '', intro: '<b>Hi</b>' }))), 'HTML in the welcome line is refused')
check(/reserved word/.test(await attempt(MGR, (tx) => tx.rpc('update_hotel_branding', { p_slug: 'api', p_colour: null, p_intro: null }))), 'the database refuses a reserved word too (not only the app)')
check(/Only managers/.test(await attempt(HK, (tx) => br.saveBranding(tx, { slug: 'hacked', colour: '', intro: '' }))), 'housekeeping cannot change branding')

console.log('\nLogo')
const files_ = new Map()
const store = {
  put: async (k, body) => { files_.set(k, Buffer.from(body)) },
  get: async (k) => (files_.has(k) ? { body: files_.get(k), contentType: 'image/jpeg' } : null),
  delete: async (k) => { files_.delete(k) },
}
const old1 = await S(MGR, (tx) => br.replaceLogo(tx, store, DEMO, JPEG))
const k1 = (await S(MGR, br.loadBranding)).logo_key
check(old1 === null && new RegExp(`^${DEMO}/brand/[0-9a-f-]{36}\\.jpg$`).test(k1) && files_.has(k1), 'the logo is stored under the hotel’s brand/ folder')
const withExif = Buffer.concat([JPEG.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0GPS=51.5'), JPEG.subarray(2)])
const old2 = await S(MGR, (tx) => br.replaceLogo(tx, store, DEMO, withExif))
const b2 = await S(MGR, br.loadBranding)
check(old2 === k1 && b2.logo_version === 2 && !files_.get(b2.logo_key).includes(Buffer.from('GPS')), 'replacing returns the old key (deleted after) and strips hidden data')
check(/Only JPEG/.test(await attempt(MGR, (tx) => br.replaceLogo(tx, store, DEMO, Buffer.from('<svg onload=alert(1)>')))), 'anything but a JPEG is refused (no SVG)')
const otherKey = `${randomUUID()}/brand/${randomUUID()}.jpg`
check(await attempt(MGR, (tx) => tx.rpc('set_hotel_logo', { p_key: otherKey })) === '22023', 'a manager can’t point at a file outside their hotel’s folder')
check(/Only managers/.test(await attempt(HK, (tx) => tx.rpc('set_hotel_logo', { p_key: null }))), 'housekeeping cannot change the logo')

console.log('\nWhat guests see')
const pub = await A(br.publicHotels)
const demo = pub.find((h) => h.inn_code === 'DEMO')
check(demo.slug === 'grand-london' && demo.has_logo === true && demo.logo_version === 2 && demo.brand_colour === '#0b3d2e', 'the hotel list carries address, logo flag and colour')
check(!('logo_key' in demo) && Object.keys(demo).length === 6, 'and nothing else (no file names, no contact or internal data)', Object.keys(demo).join())
check((await A((tx) => br.publicLogoKey(tx, 'grand-london'))) === b2.logo_key, '/brand/<slug>/logo finds the logo')
check((await A((tx) => br.publicLogoKey(tx, '../etc'))) === null && (await A((tx) => br.publicLogoKey(tx, 'nope-hotel'))) === null, 'unknown or malformed addresses find nothing')

console.log('\nBranding in emails')
const R = await A((tx) => submitReport(tx, { innCode: 'DEMO', reportType: 'lost', email: 'ann@example.com', emailConfirmed: true, itemName: 'Blue scarf',
  description: 'Blue wool scarf', category: null, colour: null, brand: null, location: null, date: null, customerName: 'Ann Guest', bookingRef: 'BK-1', whereabouts: null }))
const sent = []
await dispatch(ownerDb, { mode: 'live', baseUrl: 'https://staging.example', from: { email: 'notifications@foundora.co.uk', name: 'Foundora' },
  send: async (m) => { sent.push(m); return { ok: true, messageId: 'x' } }, log: () => {} })
const mail = sent.find((m) => m.html.includes(R.reference))
check(mail && mail.html.includes('https://staging.example/brand/grand-london/logo?v=2'), 'the email shows the hotel’s logo')
check(mail && mail.html.includes('#0b3d2e'), '…in the hotel’s colour')
check(mail && mail.text.includes('Thank you for staying with us.'), '…with its welcome line in the first email')


console.log('\nDark logo isolation and fallback')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', true))) === b2.logo_key, 'dark theme falls back to the default logo')
const darkOld = await S(MGR, (tx) => br.replaceLogo(tx, store, DEMO, JPEG, true))
const darkBrand = await S(MGR, br.loadBranding)
check(darkOld === null && darkBrand.dark_logo_key !== darkBrand.logo_key && files_.has(darkBrand.dark_logo_key), 'dark logo is stored separately')
check(darkBrand.logo_version === 3, 'dark replacement invalidates cached logo URLs')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', true))) === darkBrand.dark_logo_key, 'public dark endpoint resolves the selected variant')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london'))) === b2.logo_key, 'dark upload does not replace the light variant')
check(/Only managers/.test(await attempt(HK, (tx) => br.removeLogo(tx, true))), 'housekeeping cannot remove the dark logo')
check(await attempt(MGR, (tx) => tx.rpc('set_hotel_dark_logo', { p_key: otherKey })) === '22023', 'dark logo cannot reference another hotel folder')
check((await S(OTHER, (tx) => br.removeLogo(tx, true))) === null, 'another hotel manager cannot remove this hotel dark logo')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', true))) === darkBrand.dark_logo_key, 'other hotel changes leave this hotel logo intact')
check((await S(MGR, (tx) => br.removeLogo(tx, true))) === darkBrand.dark_logo_key, 'removing returns the dark file key for cleanup')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', true))) === b2.logo_key, 'removal restores the default fallback')


console.log('\nStandalone mark access and independence')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', 'mark'))) === null, 'no mark is fabricated or cropped from the full logo')
const priorMark = await S(MGR, (tx) => br.replaceLogo(tx, store, DEMO, JPEG, 'mark'))
const marked = await S(MGR, br.loadBranding)
check(priorMark === null && files_.has(marked.mark_logo_key), 'standalone logo has a separate stored file')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', 'mark'))) === marked.mark_logo_key, 'public mark endpoint resolves that file')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london'))) === b2.logo_key, 'mark upload leaves the full logo unchanged')
check(/Only managers/.test(await attempt(HK, (tx) => br.removeLogo(tx, 'mark'))), 'housekeeping cannot remove the standalone mark')
check(await attempt(MGR, (tx) => tx.rpc('set_hotel_mark_logo', {p_key:otherKey})) === '22023', 'standalone mark cannot reference another hotel folder')
await S(OTHER, (tx) => br.removeLogo(tx, 'mark'))
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', 'mark'))) === marked.mark_logo_key, 'another hotel manager cannot remove this mark')
check((await S(MGR, (tx) => br.removeLogo(tx, 'mark'))) === marked.mark_logo_key, 'removing the mark returns its old key for file cleanup')
check((await A((tx) => br.publicLogoKey(tx, 'grand-london', 'mark'))) === null, 'removed mark is no longer publicly available')

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall branding checks passed')
process.exit(failures ? 1 : 0)
