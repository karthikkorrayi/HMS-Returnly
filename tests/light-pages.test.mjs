// PR G: lighter pages. The workspace intro only on staff pages, once per
// browser session (src/lib/app-entry.ts); the live bell polls a small
// "pulse" every 30 seconds instead of the full list every 5; guest forms
// can't send twice from a double tap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ENTRY_COOKIE, ENTRY_MS, entryCookie, showsEntry } from '../src/lib/app-entry.ts'

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('guest pages never show the intro', () => {
  // On guest pages the proxy sets no staff path at all.
  for (const p of [null, undefined, '']) assert.equal(showsEntry(p, false), false)
  // Even if a guest path somehow arrived, it is not a staff module.
  for (const p of ['/', '/track', '/track?ref=LF-1', '/found', '/login', '/signin', '/setup', '/h/grand', '/h/grand/found', '/h/grand/login'])
    assert.equal(showsEntry(p, false), false, p)
})

test('staff pages show it once per browser session', () => {
  for (const p of ['/items', '/items/123', '/requests?status=open', '/settings', '/notifications', '/account', '/staff', '/support'])
    assert.equal(showsEntry(p, false), true, p)
  assert.equal(showsEntry('/items', true), false, 'cookie set: not again')
  assert.equal(showsEntry('/itemsX', false), false, 'only whole module names')
})

test('the intro is short and its cookie holds nothing personal', () => {
  assert.ok(ENTRY_MS <= 1500, `intro is ${ENTRY_MS} ms`)
  assert.equal(entryCookie(true), `${ENTRY_COOKIE}=1; Path=/; SameSite=Lax; Secure`)
  assert.equal(entryCookie(false), `${ENTRY_COOKIE}=1; Path=/; SameSite=Lax`)
  assert.doesNotMatch(entryCookie(true), /Expires|Max-Age/, 'a session cookie: gone when the browser closes')
})

test('the root layout decides it from the proxy header and the cookie', () => {
  const layout = src('src/app/layout.tsx')
  assert.match(layout, /showsEntry\(head\.get\('x-foundora-path'\)/)
  assert.match(layout, /<AppEntry show=\{entry\}>/)
  // The header is only trusted because the proxy removes browser copies first.
  assert.match(src('src/proxy.ts'), /requestHeaders\.delete\('x-foundora-path'\)/)
})

test('the live bell polls the small pulse every 30 seconds', () => {
  const live = src('src/components/foundora/NotificationLive.tsx')
  assert.match(live, /export const POLL_MS = 30_000/)
  assert.match(live, /notificationPulseNow\(/)
  assert.doesNotMatch(live, /notificationSnapshot/, 'not the full 200-item list')
  assert.doesNotMatch(live, /setInterval\([^)]*5000\)/)
})

test('guest forms block a double tap with a ref, not only state', () => {
  assert.match(src('src/components/enquiry/FoundReportForm.tsx'), /sending\.current = true/)
  assert.match(src('src/components/enquiry/TrackEnquiry.tsx'), /replying\.current = true/)
  assert.match(src('src/components/enquiry/EnquiryChat.tsx'), /pending\.current = true/)
})
