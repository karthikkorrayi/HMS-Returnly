// PR B without a database: the email rule (same as the database's), the
// on-screen confirmation text, and the guest-facing status labels.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidEmail, normaliseEmail, emailTypoHint, CONFIRM_EMAIL_TEXT } from '../src/lib/requests/email.ts'
import { GUEST_STATUS, REQUEST_STATUSES, customerStatus } from '../src/lib/requests/types.ts'
import { trackingPath } from '../src/lib/requests/tracking.ts'

test('emails: normalised and checked like the database does', () => {
  assert.equal(normaliseEmail('  Ann.Guest@Example.COM '), 'ann.guest@example.com')
  for (const ok of ['a@b.co', "o'brien@example.ie", 'x+lost@mail.example.co.uk']) assert.ok(isValidEmail(ok), ok)
  for (const bad of ['', 'no-at.example.com', 'a@b', 'a@b.c', 'a b@c.com', 'a@b..com', 'a..b@c.com', '<x>@y.com', `${'a'.repeat(250)}@b.com`]) {
    assert.ok(!isValidEmail(bad), bad)
  }
})

test('common typos get a second look', () => {
  assert.equal(emailTypoHint('ann@gmial.com'), 'Did you mean …@gmail.com?')
  assert.equal(emailTypoHint('ann@gmail.com'), null)
})

test('the confirmation question is the agreed wording', () => {
  assert.equal(CONFIRM_EMAIL_TEXT, 'Is this your correct email address? We will send your reference ID and future status updates to this email.')
})

test('every internal status has one of the six guest labels', () => {
  const six = new Set(['Submitted', 'Under review', 'Contact required', 'Matched', 'Resolved', 'Closed'])
  for (const s of REQUEST_STATUSES) assert.ok(six.has(GUEST_STATUS[s]), s)
  assert.equal(GUEST_STATUS.rejected, 'Closed')
  assert.equal(GUEST_STATUS.awaiting_admin, 'Under review')
})

test('a finder is never told about an owner', () => {
  for (const s of REQUEST_STATUSES) {
    assert.doesNotMatch(customerStatus(s, 'found').body, /your item|owner|photo ID/i, s)
  }
  assert.match(customerStatus('approved', 'lost').body, /your item/)
})

test('the tracking link keeps the token after #, apart from the reference', () => {
  const t = 'a'.repeat(64)
  assert.equal(trackingPath('LF-12345-ABCDE', t), `/track?ref=LF-12345-ABCDE#t=${t}`)
})
