// src/proxy.ts sends signed-out visitors to /login. Which paths stay public,
// and that the check reads Better Auth's cookie (plain and __Secure- names).
import test from 'node:test'
import assert from 'node:assert/strict'
import { getSessionCookie } from 'better-auth/cookies'
import { needsSignIn } from '../src/lib/sign-in-gate.ts'
import { USERNAME_PATTERN, MIN_PASSWORD } from '../src/lib/better-auth/rules.ts'
import * as config from '../src/lib/better-auth/config.ts'

test('public pages and API routes need no sign-in', () => {
  for (const p of ['/', '/login', '/track', '/track/ABC123', '/setup', '/api/auth/get-session', '/api']) {
    assert.equal(needsSignIn(p), false, p)
  }
})

test('staff pages need sign-in, including look-alike paths', () => {
  for (const p of ['/items', '/items/new', '/staff', '/requests/1', '/support', '/settings', '/loginx', '/tracking', '/apis', '/setupx']) {
    assert.equal(needsSignIn(p), true, p)
  }
})

test('the proxy recognises the session cookie over http and https', () => {
  const req = (cookie) => new Request('http://localhost/items', { headers: cookie ? { cookie } : {} })
  assert.equal(getSessionCookie(req()), null)
  assert.equal(getSessionCookie(req('other=1')), null)
  assert.ok(getSessionCookie(req('better-auth.session_token=abc')))
  assert.ok(getSessionCookie(req('__Secure-better-auth.session_token=abc')))
})

test('the browser and the server use the same sign-in rules', () => {
  assert.equal(config.USERNAME_PATTERN, USERNAME_PATTERN)
  assert.equal(config.MIN_PASSWORD, MIN_PASSWORD)
})
