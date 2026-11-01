import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { needsSignIn } from '../src/lib/sign-in-gate.ts'
import { supportMessage, detectSupportTopic } from '../src/lib/guest-support.ts'

test('signin is public while staff and admin boundaries remain protected', () => {
  for (const path of [
    '/',
    '/signin',
    '/login',
    '/track',
    '/setup',
    '/api/auth/sign-in/username',
  ])
    assert.equal(needsSignIn(path), false)
  for (const path of [
    '/items',
    '/staff',
    '/settings',
    '/requests',
    '/support',
    '/account',
    '/signin-evil',
  ])
    assert.equal(needsSignIn(path), true)
  assert.match(
    readFileSync(
      new URL('../src/app/signin/page.tsx', import.meta.url),
      'utf8',
    ),
    /export \{ default \} from '\.\.\/login\/page'/,
  )
})
test('support guides sensitive enquiries and return arrangements without claiming a match', () => {
  assert.equal(detectSupportTopic('I lost my passport'), 'sensitive')
  assert.equal(detectSupportTopic('can you track my status'), 'contact')
  assert.equal(detectSupportTopic('arrange delivery'), 'shipping')
  assert.equal(detectSupportTopic('nonsense input'), null)
  assert.match(supportMessage('lost', 'Harbour Hotel').text, /Harbour Hotel/)
  assert.match(
    supportMessage('lost', 'Harbour Hotel').text,
    /review the details before sending/,
  )
  assert.match(supportMessage('shipping', 'Hotel').text, /cannot book shipping/)
  assert.match(
    supportMessage('collection', 'Hotel').text,
    /does not confirm a match/,
  )
})
test('theme initialization uses the existing CSP nonce and original enquiry APIs are reused', () => {
  const root = readFileSync(
    new URL('../src/app/layout.tsx', import.meta.url),
    'utf8',
  )
  const support = readFileSync(
    new URL('../src/components/foundora/GuestExperience.tsx', import.meta.url),
    'utf8',
  )
  assert.match(root, /nonce=\{nonce\}/)
  assert.match(
    support,
    /import EnquiryChat from '@\/components\/enquiry\/EnquiryChat'/,
  )
  assert.doesNotMatch(root + support, /supabase|SERVICE_ROLE|unsafe-inline/)
})
