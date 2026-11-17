// The setup form shows one card per step (src/lib/setup-steps.ts). When the
// server refuses something, the form must open the card the message is about.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SETUP_STEPS, setupErrorStep } from '../src/lib/setup-steps.ts'

test('seven cards, in the order of the form', () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.short), ['Key', 'Hotel', 'Rooms', 'Areas', 'Storage', 'Support', 'Admin'])
  const form = readFileSync(new URL('../src/app/setup/SetupForm.tsx', import.meta.url), 'utf8')
  const titles = [...form.matchAll(/<Section step=\{(\d)\} current=\{step\} title="([^"]+)"/g)].map((m) => [Number(m[1]), m[2]])
  assert.deepEqual(titles, SETUP_STEPS.map((s, i) => [i + 1, s.title]))
})

test('every setup message opens the right card', () => {
  const cases = [
    ['The setup key is not correct.', 0],
    ['Setup is locked: SETUP_TOKEN is not set (or is shorter than 24 characters) on the server.', 0],
    ['Hotel code: 3–10 letters or digits, e.g. GRAND. It appears on every item tag and cannot be changed later.', 1],
    ['Hotel name: 2–100 characters.', 1],
    ['Address: at most 300 characters.', 1],
    ['Add at least one floor with its rooms.', 2],
    ['Floor "2": add its room numbers, e.g. 101, 102, 103 or 101-120.', 2],
    ['Room 101 is listed twice.', 2],
    ['Room range 101-9999 is too long (at most 500 rooms).', 2],
    ['Area "Pool" is listed twice.', 3],
    ['Storage place "Safe" is listed twice.', 4],
    ['Add at least one place where found items are kept.', 4],
    ['The contact email does not look right.', 5],
    ['Contact phone: digits, spaces, +, ( ) and dashes only.', 5],
    ['Administrator name: 1–80 characters.', 6],
    ['The two administrator passwords do not match.', 6],
    ['That username is already taken. Choose another one.', 6],
    ['Administrator password: 15–128 characters.', 6],
  ]
  for (const [m, step] of cases) assert.equal(setupErrorStep(m), step, m)
  for (const m of [null, '', 'Setup could not be completed. Nothing was saved. Please try again.', 'This installation is already set up. Sign in instead.'])
    assert.equal(setupErrorStep(m), null, String(m))
})
