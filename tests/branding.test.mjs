// PR E without a database: web-address rules, colour contrast, which hotel a
// request is for (path now, subdomain later), logo addresses, the welcome line
// in emails, and the photo store accepting logo keys only in brand/.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidSlug, suggestSlug, cleanColour, contrastWithWhite, logoPath, RESERVED_SLUGS } from '../src/lib/branding.ts'
import { hotelSlugFrom } from '../src/lib/hotel-resolve.ts'
import { isStoreKey } from '../src/lib/storage/s3.ts'
import { renderEmail } from '../scripts/email/templates.mjs'
import { readFileSync } from 'node:fs'

test('web addresses: lower-case letters, digits, single dashes, 3–40 characters, not reserved', () => {
  for (const ok of ['grand', 'the-grand-london', 'h0tel-22']) assert.ok(isValidSlug(ok), ok)
  for (const bad of ['', 'ab', 'Grand', '-grand', 'grand-', 'gr--and', 'grand hotel', 'a'.repeat(41), 'www', 'api', 'admin', 'h']) {
    assert.ok(!isValidSlug(bad), bad)
  }
})

test('the reserved list matches the database’s', () => {
  const sql = readFileSync(new URL('../db/migrations/20261104000019_hotel_branding.sql', import.meta.url), 'utf8')
  for (const r of RESERVED_SLUGS) assert.ok(sql.includes(`'${r}'`), r)
})

test('a suggested address from the hotel name', () => {
  assert.equal(suggestSlug('The Grand Hotel, London'), 'the-grand-hotel-london')
  assert.equal(suggestSlug('Café & Spa'), 'cafe-and-spa')
})

test('email colour must be dark enough for white text', () => {
  assert.equal(cleanColour(''), null)
  assert.equal(cleanColour('#0B6468'), '#0b6468')
  assert.ok(contrastWithWhite('#000000') > 20 && contrastWithWhite('#ffffff') === 1)
  assert.throws(() => cleanColour('#ffee99'), /too light/)
  assert.throws(() => cleanColour('red'), /#1A2B3C/)
})

test('which hotel: /h/<slug> now; <slug>.foundora.co.uk only once switched on', () => {
  assert.equal(hotelSlugFrom({ pathname: '/h/grand-london' }), 'grand-london')
  assert.equal(hotelSlugFrom({ pathname: '/h/grand-london/found' }), 'grand-london')
  assert.equal(hotelSlugFrom({ pathname: '/h/admin' }), null)
  assert.equal(hotelSlugFrom({ pathname: '/track' }), null)
  assert.equal(hotelSlugFrom({ host: 'grand.foundora.co.uk', pathname: '/' }), null, 'off until HOTEL_SUBDOMAIN_BASE is set')
  const base = 'foundora.co.uk'
  assert.equal(hotelSlugFrom({ host: 'grand.foundora.co.uk:443', pathname: '/', subdomainBase: base }), 'grand')
  assert.equal(hotelSlugFrom({ host: 'app.foundora.co.uk', pathname: '/', subdomainBase: base }), null, 'reserved names are never hotels')
  assert.equal(hotelSlugFrom({ host: 'a.b.foundora.co.uk', pathname: '/', subdomainBase: base }), null)
  assert.equal(hotelSlugFrom({ host: 'evil-foundora.co.uk', pathname: '/', subdomainBase: base }), null)
})

test('logo address carries the version', () => {
  assert.equal(logoPath('grand-london', 3), '/brand/grand-london/logo?v=3')
})

test('the photo store accepts logos only in a hotel’s brand/ folder', () => {
  const u = '0f8fad5b-d9cb-469f-a165-70867728950e'
  assert.ok(isStoreKey(`${u}/${u}/${u}.jpg`))
  assert.ok(isStoreKey(`${u}/brand/${u}.jpg`))
  for (const bad of [`${u}/brands/${u}.jpg`, `${u}/brand/../${u}.jpg`, `brand/${u}.jpg`, `${u}/brand/${u}.png`]) assert.ok(!isStoreKey(bad), bad)
})

test('the welcome line appears in the first email only, as escaped text', () => {
  const d = { template: 'received', reportType: 'lost', reference: 'LF-12345-ABCDE', itemName: 'Scarf', createdAt: '2026-11-04T10:00:00Z',
    trackUrl: 'https://s.example/track?ref=LF-12345-ABCDE#t=' + 'a'.repeat(64), hotel: { name: 'Grand', intro: 'Welcome <back> & thanks' } }
  const m = renderEmail(d)
  assert.ok(m.text.includes('Welcome <back> & thanks'))
  assert.ok(m.html.includes('Welcome &lt;back&gt; &amp; thanks'))
  assert.ok(!renderEmail({ ...d, template: 'resolved' }).text.includes('Welcome'))
})
