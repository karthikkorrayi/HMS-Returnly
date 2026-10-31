// The daily clean-up without a database: the status managers see on Settings,
// and the command line, which must never print the database URL (it contains
// the password), whatever is wrong with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cleanupStatus, LATE_AFTER_HOURS } from '../src/lib/daily-cleanup.ts'

const NOW = new Date('2026-11-01T12:00:00Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000)

test('never ran: says so and where to look', () => {
  const s = cleanupStatus(null, NOW)
  assert.equal(s.state, 'never')
  assert.match(s.text, /has not run yet/)
  assert.match(s.text, /daily-cleanup/)
})

test('ran last night: ok, with how long ago', () => {
  assert.deepEqual([cleanupStatus(hoursAgo(9), NOW).state, cleanupStatus(hoursAgo(9), NOW).text], ['ok', 'Last ran 9 hours ago.'])
  assert.equal(cleanupStatus(hoursAgo(0.2), NOW).text, 'Last ran less than an hour ago.')
  assert.equal(cleanupStatus(hoursAgo(1), NOW).text, 'Last ran 1 hour ago.')
})

test('one missed night is tolerated; after a day and a half it is late', () => {
  assert.equal(LATE_AFTER_HOURS, 36)
  assert.equal(cleanupStatus(hoursAgo(35.9), NOW).state, 'ok')
  const late = cleanupStatus(hoursAgo(37), NOW)
  assert.equal(late.state, 'late')
  assert.match(late.text, /37 hours ago/)
  assert.match(cleanupStatus(hoursAgo(24 * 5), NOW).text, /5 days ago/)
})

test('a clock slightly behind the database does not say "-1 hours"', () => {
  assert.equal(cleanupStatus(new Date(NOW.getTime() + 60_000), NOW).text, 'Last ran less than an hour ago.')
})

// A fresh random stand-in password per run: no fixed value in the code.
const SECRET = randomBytes(18).toString('base64url')
const run = (env) => {
  const r = spawnSync(process.execPath, ['scripts/daily-cleanup.mjs'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 30000 })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('variable missing: exit 2 with a clear message', () => {
  const r = run({})
  assert.equal(r.code, 2)
  assert.match(r.out, /MIGRATION_DATABASE_URL is not set/)
})

test('empty host (an empty Railway reference): exit 2, no password', () => {
  const r = run({ MIGRATION_DATABASE_URL: `postgresql://app_owner:${SECRET}@:5432/returnly` })
  assert.equal(r.code, 2)
  assert.match(r.out, /EMPTY host name/)
  assert.ok(!r.out.includes(SECRET), r.out)
})

test('not a URL: exit 2, no password', () => {
  const r = run({ MIGRATION_DATABASE_URL: `app_owner:${SECRET} nonsense` })
  assert.equal(r.code, 2)
  assert.ok(!r.out.includes(SECRET), r.out)
})

test('database unreachable: exit 1 with the error code, no password', () => {
  const r = run({ MIGRATION_DATABASE_URL: `postgresql://app_owner:${SECRET}@no-such-host.invalid:5432/returnly` })
  assert.equal(r.code, 1)
  assert.match(r.out, /could not connect/)
  assert.ok(!r.out.includes(SECRET), r.out)
})
