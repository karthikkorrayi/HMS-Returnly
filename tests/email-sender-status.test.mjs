// PR L: the email sender status managers see (src/lib/email-log.ts). Without
// a database: what each state says, and that it points at the setting to fix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { senderStatus, SENDER_LATE_MINUTES } from '../src/lib/email-log.ts'

const now = new Date('2026-11-15T12:00:00Z')
const ago = (min) => new Date(now.getTime() - min * 60_000)
const hb = (o) => ({ finishedAt: ago(2), ok: true, mode: 'live', waiting: 0, oldestWaiting: null, ...o })

test('never ran against this database: says which Railway setting to check', () => {
  const s = senderStatus(hb({ finishedAt: null, waiting: 3 }), now)
  assert.equal(s.state, 'never')
  assert.match(s.text, /3 emails are waiting/)
  assert.match(s.text, /same Postgres service as the website \(MIGRATION_DATABASE_URL\)/)
})

test('recent live run: fine', () => {
  assert.equal(senderStatus(hb({}), now).state, 'ok')
  assert.match(senderStatus(hb({ waiting: 1 }), now).text, /1 email is waiting/)
})

test('late after 15 minutes', () => {
  assert.equal(SENDER_LATE_MINUTES, 15)
  assert.equal(senderStatus(hb({ finishedAt: ago(15) }), now).state, 'ok')
  assert.equal(senderStatus(hb({ finishedAt: ago(16) }), now).state, 'late')
})

test('not live, or the key refused: flagged', () => {
  assert.equal(senderStatus(hb({ mode: 'preview' }), now).state, 'off')
  assert.equal(senderStatus(hb({ mode: 'off' }), now).state, 'off')
  assert.match(senderStatus(hb({ ok: false }), now).text, /Resend refused the request: check RESEND_API_KEY/)
  assert.match(senderStatus(hb({ ok: false, stopReason: 'quota' }), now).text, /sending quota/)
  assert.doesNotMatch(senderStatus(hb({ ok: false }), now).text, /Brevo/)
})
