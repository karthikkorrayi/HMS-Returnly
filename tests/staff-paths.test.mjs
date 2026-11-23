// Hotel-addressed staff pages and sign-in (src/lib/staff-paths.ts,
// src/lib/hotel-login.ts), without a server: the address rules, the sign-in
// hotel check, and a scan that no staff page links to a bare /items-style
// address (every staff link must carry the hotel).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STAFF_MODULES, isStaffPath, staffPath, splitHotelPath, withoutHotel, isStaffPage, hotelRoute, hotelPagePath, legacyHotelAddress } from '../src/lib/staff-paths.ts'
import { RESERVED_SLUGS, isValidSlug } from '../src/lib/branding-paths.ts'
import { hotelLoginPath, findHotel, signedInAtOwnHotel } from '../src/lib/hotel-login.ts'

test('staff modules match the folders of src/app/(app)', () => {
  const dir = new URL('../src/app/(app)/', import.meta.url).pathname
  const folders = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort()
  assert.deepEqual([...STAFF_MODULES].sort(), folders)
})

test('staff addresses carry the hotel', () => {
  assert.equal(staffPath('grand', '/items'), '/grand/items')
  assert.equal(staffPath('grand', '/items/abc?logged=1'), '/grand/items/abc?logged=1')
  assert.equal(staffPath('grand', '/track'), '/track', 'guest pages are not staff pages')
  assert.equal(staffPath('admin', '/items'), '/items', 'never a reserved word as a hotel')
  assert.ok(isStaffPath('/settings/branding') && !isStaffPath('/itemsx') && !isStaffPath('/found'))
  assert.equal(hotelPagePath('grand'), '/grand')
  assert.equal(hotelPagePath('grand', '/found'), '/grand/found')
})

test('reading an address: only /<valid slug>/<staff module>', () => {
  assert.deepEqual(splitHotelPath('/grand/requests/123'), { slug: 'grand', path: '/requests/123' })
  assert.equal(splitHotelPath('/grand'), null, 'the guest page')
  assert.equal(splitHotelPath('/grand/login'), null, 'sign-in is a public page')
  assert.equal(splitHotelPath('/grand/found'), null)
  assert.equal(splitHotelPath('/grand/api/photos/1'), null, 'never mapped onto API routes')
  assert.equal(splitHotelPath('/../items'), null)
  assert.equal(splitHotelPath('/Grand/items'), null)
  assert.equal(splitHotelPath('/items/123'), null, 'an old-style staff address is not a hotel called "items"')
  assert.equal(withoutHotel('/grand/items/new'), '/items/new')
  assert.equal(withoutHotel('/track'), '/track')
})

test('what the proxy does with each address', () => {
  assert.deepEqual(hotelRoute('/grand'), { kind: 'guest', slug: 'grand', internal: '/h/grand' })
  assert.deepEqual(hotelRoute('/grand/'), { kind: 'guest', slug: 'grand', internal: '/h/grand' })
  assert.deepEqual(hotelRoute('/grand/found'), { kind: 'guest', slug: 'grand', internal: '/h/grand/found' })
  assert.deepEqual(hotelRoute('/grand/login'), { kind: 'guest', slug: 'grand', internal: '/h/grand/login' })
  assert.deepEqual(hotelRoute('/grand/settings/emails'), { kind: 'staff', slug: 'grand', path: '/settings/emails' })
  // Old addresses (sent emails, QR codes, bookmarks) move permanently.
  assert.deepEqual(hotelRoute('/h/grand'), { kind: 'legacy', to: '/grand' })
  assert.deepEqual(hotelRoute('/h/grand/'), { kind: 'legacy', to: '/grand' })
  assert.deepEqual(hotelRoute('/h/grand/items/9'), { kind: 'legacy', to: '/grand/items/9' })
  assert.deepEqual(hotelRoute('/h/grand/login'), { kind: 'legacy', to: '/grand/login' })
  assert.equal(legacyHotelAddress('/h/admin'), null, 'never redirects to a reserved word')
  // Everything the app owns stays as it was.
  for (const p of ['/', '/login', '/track', '/found', '/setup', '/signin', '/items', '/items/1', '/settings', '/brand/grand/logo', '/api/health', '/h', '/grand/unknown', '/grand/api/x'])
    assert.equal(hotelRoute(p), null, p)
})

test('every top-level address of the app is reserved, so it is never read as a hotel', () => {
  const app = new URL('../src/app/', import.meta.url).pathname
  const top = readdirSync(app).filter((f) => statSync(join(app, f)).isDirectory() && !f.startsWith('(') && !f.startsWith('['))
  const groups = readdirSync(app).filter((f) => f.startsWith('(')).flatMap((g) => readdirSync(join(app, g)).filter((f) => statSync(join(app, g, f)).isDirectory()))
  const pub = readdirSync(new URL('../public/', import.meta.url).pathname)
  for (const name of [...top, ...groups, ...pub].filter((n) => /^[a-z0-9-]+$/.test(n))) {
    assert.ok(!isValidSlug(name), `${name} must be in RESERVED_SLUGS`)
  }
  // Same list as the database (migration 025).
  const sql = readFileSync(new URL('../db/migrations/20261115000025_hotel_paths_email_heartbeat.sql', import.meta.url), 'utf8')
  const list = [...sql.slice(sql.indexOf('p not in ('), sql.indexOf(')', sql.indexOf('p not in ('))).matchAll(/'([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual([...list].sort(), [...RESERVED_SLUGS].sort())
})

test('no guest support button on staff pages or staff sign-in', () => {
  for (const p of ['/items', '/grand/items', '/grand/login', '/login', '/settings/branding', '/grand/notifications']) assert.ok(isStaffPage(p), p)
  for (const p of ['/', '/grand', '/grand/found', '/found', '/track']) assert.ok(!isStaffPage(p), p)
})

test('sign-in address keeps only safe query values', () => {
  assert.equal(hotelLoginPath('grand'), '/grand/login')
  assert.equal(hotelLoginPath('grand', { next: '/requests', setup: 'done', u: 'grace.m' }), '/grand/login?next=%2Frequests&setup=done&u=grace.m')
  assert.equal(hotelLoginPath('grand', { next: 'https://evil.example', u: '<x>' }), '/grand/login')
})

test('finding a hotel by code or address', () => {
  const hotels = [{ inn_code: 'KK1469', slug: 'kk-grand' }, { inn_code: 'GRAND', slug: 'grand' }]
  assert.equal(findHotel(hotels, 'kk1469')?.slug, 'kk-grand')
  assert.equal(findHotel(hotels, ' KK-GRAND ')?.slug, 'kk-grand')
  assert.equal(findHotel(hotels, 'nope'), null)
  assert.equal(findHotel(hotels, ''), null)
})

test('an account may only sign in on its own hotel’s page', () => {
  assert.ok(signedInAtOwnHotel('grand', 'grand'))
  assert.ok(!signedInAtOwnHotel('grand', 'other'))
  assert.ok(!signedInAtOwnHotel('grand', null))
  assert.ok(!signedInAtOwnHotel('grand', ''))
})

test('no staff page links to a bare /items-style address', () => {
  const roots = ['src/app/(app)', 'src/components'].map((r) => new URL(`../${r}/`, import.meta.url).pathname)
  const bare = /(href|action|push|replace|redirect)\(?\s*=?\s*\{?\s*['"`]\/(items|requests|staff|settings|support|account|notifications)\b/
  const offenders = []
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|mjs)$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (bare.test(line)) offenders.push(`${p}:${i + 1}`) })
    }
  }
  roots.forEach(walk)
  assert.deepEqual(offenders, [])
})
