// The role table on the Staff page covers every role, and only real roles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ROLE_ORDER, ROLE_PERMISSIONS } from '../src/lib/role-permissions.ts'
import { STAFF_ROLES } from '../src/lib/staff-admin.ts'

test('every role is a column, once', () => {
  assert.deepEqual([...ROLE_ORDER].sort(), [...STAFF_ROLES].sort())
})

test('every row names only real roles, and managers can do everything', () => {
  for (const p of ROLE_PERMISSIONS) {
    for (const r of p.roles) assert.ok(STAFF_ROLES.includes(r), `${p.what}: ${r}`)
    assert.ok(p.roles.includes('manager'), p.what)
  }
})
