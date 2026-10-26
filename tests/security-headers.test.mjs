// Phase 6 step 3: the browser security rules (src/lib/security-headers.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { contentSecurityPolicy, makeNonce, SECURITY_HEADERS } from '../src/lib/security-headers.ts'

const parse = (csp) => Object.fromEntries(csp.split('; ').map((d) => { const [k, ...v] = d.split(' '); return [k, v] }))

test('production policy: only our own, nonce-marked scripts run', () => {
  const p = parse(contentSecurityPolicy({ nonce: 'abc123==', dev: false, https: true }))
  assert.deepEqual(p['script-src'], ["'self'", "'nonce-abc123=='", "'strict-dynamic'"])
  assert.deepEqual(p['style-src'], ["'self'", "'nonce-abc123=='"])
  for (const d of Object.values(p)) {
    assert.ok(!d.includes("'unsafe-eval'") && !d.includes("'unsafe-inline'") && !d.includes('*'), 'no unsafe or wildcard sources')
  }
  assert.deepEqual(p['object-src'], ["'none'"])
  assert.deepEqual(p['frame-ancestors'], ["'none'"])
  assert.deepEqual(p['form-action'], ["'self'"])
  assert.deepEqual(p['base-uri'], ["'self'"])
  assert.ok('upgrade-insecure-requests' in p)
})

test('local http and dev mode', () => {
  const p = parse(contentSecurityPolicy({ nonce: 'n', dev: true, https: false }))
  assert.ok(p['script-src'].includes("'unsafe-eval'"), 'dev: React error overlay needs eval')
  assert.ok(p['style-src'].includes("'unsafe-inline'"))
  assert.ok(!('upgrade-insecure-requests' in p), 'plain http (phone on Wi-Fi) is not upgraded')
})

test('nonces are random and unguessable', () => {
  const seen = new Set(Array.from({ length: 200 }, makeNonce))
  assert.equal(seen.size, 200)
  for (const n of seen) assert.equal(Buffer.from(n, 'base64').length, 16)
})

test('fixed headers', () => {
  const h = Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]))
  assert.equal(h['x-content-type-options'], 'nosniff')
  assert.equal(h['x-frame-options'], 'DENY')
  assert.equal(h['referrer-policy'], 'same-origin')
  assert.match(h['permissions-policy'], /camera=\(\)/)
  assert.equal(h['strict-transport-security'], 'max-age=31536000')
})
