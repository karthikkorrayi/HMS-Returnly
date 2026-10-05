import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDashboardView,
  matchesDashboardFilter,
  dashboardGuidance,
} from '../src/lib/item-dashboard.ts'

function item(status, overrides = {}) {
  return {
    id: 'example', code: 'EXAMPLE', description: 'Example',
    category: 'Other', location: 'Lobby', status,
    tier: 'standard', retention: false, ...overrides,
  }
}

test('awaiting collection and posting remain open and ready to return', () => {
  for (const status of ['awaiting_collection', 'awaiting_shipping']) {
    assert.equal(matchesDashboardFilter(item(status), 'open'), true)
    assert.equal(matchesDashboardFilter(item(status), 'return'), true)
  }
})

test('expired closed, logged and awaiting items are not disposal candidates', () => {
  for (const status of [
    'returned', 'disposed', 'donated', 'logged',
    'awaiting_collection', 'awaiting_shipping',
  ]) {
    assert.equal(
      matchesDashboardFilter(item(status, { retention: true }), 'retention'),
      false
    )
  }
  for (const status of ['stored', 'matched', 'guest_contacted']) {
    assert.equal(
      matchesDashboardFilter(item(status, { retention: true }), 'retention'),
      true
    )
    assert.equal(matchesDashboardFilter(item(status), 'retention'), false)
  }
})

test('unknown filters safely use the open view', () => {
  for (const value of [undefined, null, '__proto__', 'unknown']) {
    assert.equal(getDashboardView(value).id, 'open')
  }
})

test('guidance respects staff responsibility and sensitive-item handling', () => {
  const sensitive = item('logged', { tier: 'sensitive' })
  assert.match(dashboardGuidance(sensitive, 'housekeeping'), /Do not photograph/)
  const matched = item('matched')
  assert.match(dashboardGuidance(matched, 'housekeeping'), /front desk will/)
  assert.match(dashboardGuidance(matched, 'front_office'), /Contact the guest/)
  const valuable = item('awaiting_collection', { tier: 'valuable' })
  assert.match(dashboardGuidance(valuable, 'front_office'), /witness/)
})
