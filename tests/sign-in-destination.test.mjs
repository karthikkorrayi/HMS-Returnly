import test from 'node:test'
import assert from 'node:assert/strict'
import { signInDestination } from '../src/lib/sign-in-destination.ts'

test('quick actions preserve known staff entry points', () => {
  for (const route of ['/items', '/items/new', '/staff']) {
    assert.equal(signInDestination(route), route)
  }
})

test('untrusted destinations fall back to the item board', () => {
  for (const value of [
    undefined, null, '', ['/staff'],
    'https://example.com', '//example.com', '/\\example.com',
    '/items/new?next=https://example.com', '/items/../staff',
    '/login', '/unknown', '%2F%2Fexample.com',
  ]) {
    assert.equal(signInDestination(value), '/items')
  }
})
