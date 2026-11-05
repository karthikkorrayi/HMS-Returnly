// Hotel-addressed staff pages and sign-in (src/lib/staff-paths.ts,
// src/lib/hotel-login.ts), without a server: the address rules, the sign-in
// hotel check, and a scan that no staff page links to a bare /items-style
// address (every staff link must carry the hotel).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STAFF_MODULES, isStaffPath, staffPath, splitHotelPath, withoutHotel, isStaffPage } from '../src/lib/staff-paths.ts'
import { hotelLoginPath, findHotel, signedInAtOwnHotel } from '../src/lib/hotel-login.ts'

test('staff modules match the folders of src/app/(app)', () => {
  const dir = new URL('../src/app/(app)/', import.meta.url).pathname
  const folders = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort()
  assert.deepEqual([...STAFF_MODULES].sort(), folders)
})

test('staff addresses carry the hotel', () => {
  assert.equal(staffPath('grand', '/items'), '/h/grand/items')
  assert.equal(staffPath('grand', '/items/abc?logged=1'), '/h/grand/items/abc?logged=1')
  assert.equal(staffPath('grand', '/track'), '/track', 'guest pages are not staff pages')
  assert.equal(staffPath('admin', '/items'), '/items', 'never a reserved word as a hotel')
  assert.ok(isStaffPath('/settings/branding') && !isStaffPath('/itemsx') && !isStaffPath('/found'))
})

test('reading an address: only /h/<valid slug>/<staff module>', () => {
  assert.deepEqual(splitHotelPath('/h/grand/requests/123'), { slug: 'grand', path: '/requests/123' })
  assert.equal(splitHotelPath('/h/grand'), null, 'the guest page')
  assert.equal(splitHotelPath('/h/grand/login'), null, 'sign-in is a public page')
  assert.equal(splitHotelPath('/h/grand/found'), null)
  assert.equal(splitHotelPath('/h/grand/api/photos/1'), null, 'never mapped onto API routes')
  assert.equal(splitHotelPath('/h/../items'), null)
  assert.equal(splitHotelPath('/h/Grand/items'), null)
  assert.equal(withoutHotel('/h/grand/items/new'), '/items/new')
  assert.equal(withoutHotel('/track'), '/track')
})

test('no guest support button on staff pages or staff sign-in', () => {
  for (const p of ['/items', '/h/grand/items', '/h/grand/login', '/login', '/settings/branding', '/h/grand/notifications']) assert.ok(isStaffPage(p), p)
  for (const p of ['/', '/h/grand', '/h/grand/found', '/found', '/track']) assert.ok(!isStaffPage(p), p)
})

test('sign-in address keeps only safe query values', () => {
  assert.equal(hotelLoginPath('grand'), '/h/grand/login')
  assert.equal(hotelLoginPath('grand', { next: '/requests', setup: 'done', u: 'grace.m' }), '/h/grand/login?next=%2Frequests&setup=done&u=grace.m')
  assert.equal(hotelLoginPath('grand', { next: 'https://evil.example', u: '<x>' }), '/h/grand/login')
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
