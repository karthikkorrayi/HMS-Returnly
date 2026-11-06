// PR A: who is asking (src/lib/rate-limit.ts), without a database. The visitor
// is identified only by the header Railway's edge sets, and only as a keyed
// hash, so the database never holds an IP address.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { clientIp, rateKey, TOO_MANY } from '../src/lib/rate-limit.ts'

const h = (o) => new Headers(o)
const SECRET = 'unit-test-rate-secret-2026-not-for-runtime' // deterministic test fixture, never a runtime credential

test('IP comes from the trusted header only', () => {
  assert.equal(clientIp(h({ 'x-real-ip': '203.0.113.7' }), 'x-real-ip'), '203.0.113.7')
  assert.equal(clientIp(h({ 'x-real-ip': '2001:DB8::1' }), 'x-real-ip'), '2001:db8::1')
  // A visitor-supplied header is ignored when the trusted one is configured.
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4' }), 'x-real-ip'), 'unknown')
})

test('anything that is not an IP address counts as "unknown"', () => {
  for (const v of ['', 'localhost', '<script>', '999', 'a'.repeat(80)]) {
    assert.equal(clientIp(h({ 'x-real-ip': v }), 'x-real-ip'), 'unknown', v)
  }
  assert.equal(clientIp(h({ 'x-real-ip': '203.0.113.7, 10.0.0.1' }), 'x-real-ip'), '203.0.113.7')
})

test('the key is a 64-character hash that hides the IP', () => {
  const k = rateKey('submit', '203.0.113.7', SECRET)
  assert.match(k, /^[0-9a-f]{64}$/)
  // A valid hex HMAC can coincidentally contain '203'; verify the full reference vector.
  assert.equal(k, '5c9b72ac5c7d7c5e21e33f107392a61baebdb2602e49962737087b5bb87d452d')
  assert.equal(k, rateKey('submit', '203.0.113.7', SECRET), 'same visitor, same key')
  assert.notEqual(k, rateKey('lookup', '203.0.113.7', SECRET), 'each limit has its own key')
  assert.notEqual(k, rateKey('submit', '203.0.113.8', SECRET), 'each visitor has their own key')
  assert.notEqual(k, rateKey('submit', '203.0.113.7', randomBytes(24).toString('hex')), 'depends on the secret')
})

test('no secret: refuses instead of using a guessable key', () => {
  assert.throws(() => rateKey('submit', '203.0.113.7', ''), /BETTER_AUTH_SECRET/)
  assert.throws(() => rateKey('submit', '203.0.113.7', 'short'), /BETTER_AUTH_SECRET/)
})

test('messages are plain, one per limit, and give no numbers to aim at', () => {
  for (const m of Object.values(TOO_MANY)) {
    assert.match(m, /Too many/)
    assert.doesNotMatch(m, /\d/)
  }
})
