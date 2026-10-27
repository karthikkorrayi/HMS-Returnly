// The migration runner's command line must never print the database URL
// (it contains the password), whatever is wrong with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const SECRET = 'wIFk1E1yjSecretPw-xyz'
const run = (url) => {
  const r = spawnSync(process.execPath, ['db/migrate.mjs'], { env: { ...process.env, MIGRATION_DATABASE_URL: url }, encoding: 'utf8', timeout: 20000 })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('empty host (an empty Railway reference): clear message, no password', () => {
  const r = run(`postgresql://app_owner:${SECRET}@:5432/returnly`)
  assert.equal(r.code, 2)
  assert.match(r.out, /value not shown/)
  assert.ok(!r.out.includes(SECRET), r.out)
})

test('not a URL at all: clear message, no password', () => {
  const r = run(`app_owner:${SECRET} nonsense`)
  assert.equal(r.code, 2)
  assert.ok(!r.out.includes(SECRET), r.out)
})

test('host that does not exist: fails with the error code, no password', () => {
  const r = run(`postgresql://app_owner:${SECRET}@no-such-host.invalid:5432/returnly`)
  assert.equal(r.code, 1)
  assert.match(r.out, /could not connect/)
  assert.ok(!r.out.includes(SECRET), r.out)
})
