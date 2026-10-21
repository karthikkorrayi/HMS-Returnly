// Better Auth pieces that need no database: the cross-site check on
// /api/auth (docs/AUTH_SPIKE_REPORT.md §2 finding 3), input rules, and the
// configuration values the report's conditions require.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromOurSite } from '../src/lib/better-auth/origin.ts'
import { makeAuth, SESSION_HOURS, MIN_PASSWORD, SIGN_IN_ATTEMPTS_PER_MINUTE } from '../src/lib/better-auth/config.ts'
import { normaliseUsername, checkPassword, StaffLoginError } from '../src/lib/better-auth/staff-logins.ts'
import { randomBytes } from 'node:crypto'

const BASE = 'https://returnly.example'
const req = (headers) => new Request(BASE + '/api/auth/sign-in/username', { method: 'POST', headers })

test('POSTs from our own site are allowed', () => {
  assert.equal(fromOurSite(req({ origin: BASE }), BASE), true)
  assert.equal(fromOurSite(req({ 'sec-fetch-site': 'same-origin' }), BASE), true)
  assert.equal(fromOurSite(req({ 'sec-fetch-site': 'none' }), BASE), true)
  assert.equal(fromOurSite(req({}), BASE), true, 'non-browser clients send neither header')
})

test('cross-site POSTs are refused', () => {
  assert.equal(fromOurSite(req({ origin: 'https://evil.example' }), BASE), false)
  assert.equal(fromOurSite(req({ origin: 'https://returnly.example.evil.example' }), BASE), false)
  assert.equal(fromOurSite(req({ origin: 'http://returnly.example' }), BASE), false, 'http is a different origin')
  assert.equal(fromOurSite(req({ origin: 'null' }), BASE), false)
  assert.equal(fromOurSite(req({ 'sec-fetch-site': 'cross-site' }), BASE), false)
  assert.equal(fromOurSite(req({ 'sec-fetch-site': 'same-site' }), BASE), false, 'a sibling subdomain is not us')
  assert.equal(fromOurSite(req({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), BASE), false, 'Origin wins')
})

test('usernames and passwords follow the app rules', () => {
  assert.equal(normaliseUsername('  Front.Desk-1 '), 'front.desk-1')
  for (const bad of ['ab', 'has space', 'émile', 'x'.repeat(33), 'semi;colon']) assert.throws(() => normaliseUsername(bad), StaffLoginError, bad)
  assert.throws(() => checkPassword('x'.repeat(MIN_PASSWORD - 1)), StaffLoginError)
  assert.throws(() => checkPassword('x'.repeat(129)), StaffLoginError)
  assert.doesNotThrow(() => checkPassword('x'.repeat(MIN_PASSWORD)))
})

test('configuration matches the spike report conditions', () => {
  assert.equal(SESSION_HOURS, 12)
  assert.equal(MIN_PASSWORD, 10)
  assert.equal(SIGN_IN_ATTEMPTS_PER_MINUTE, 5)
  assert.throws(() => makeAuth({ database: undefined, baseURL: BASE, secret: 'too-short' }), /at least 32/)
  const auth = makeAuth({ database: undefined, baseURL: BASE, secret: randomBytes(24).toString('base64url') })
  const o = auth.options
  assert.equal(o.emailAndPassword.disableSignUp, true, 'public sign-up disabled')
  assert.equal(o.session.cookieCache.enabled, false, 'no cookie cache: revocation is immediate')
  assert.equal(o.session.expiresIn, 12 * 3600)
  assert.equal(o.rateLimit.storage, 'database')
  assert.equal(o.telemetry.enabled, false)
  assert.equal(o.advanced.useSecureCookies, true, 'https base → Secure cookies')
  assert.match(o.advanced.database.generateId(), /^[0-9a-f-]{36}$/)
  assert.deepEqual(o.advanced.ipAddress.ipAddressHeaders, ['x-real-ip'])
  assert.ok(!o.plugins.some((p) => p.id === 'admin'), 'no admin plugin (no impersonation)')
})
