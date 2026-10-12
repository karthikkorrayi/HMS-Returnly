import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDetails } from '../src/lib/requests/extract.ts'
import { ruleBasedAssistant } from '../src/lib/requests/assistant.ts'

const TODAY = '2026-10-13'

test('extracts item, category, colour and brand from natural language', () => {
  assert.deepEqual(extractDetails('I left a gold Pandora bracelet on the bedside table'), {
    itemName: 'Bracelet', category: 'jewellery_watches', colour: 'Gold', brand: 'Pandora', location: 'Bedroom',
  })
  const phone = extractDetails('My black iPhone in a red case, room 109')
  assert.equal(phone.category, 'electronics')
  assert.equal(phone.itemName, 'Iphone')
  assert.equal(phone.colour, 'Black')
  assert.equal(phone.location, 'Room 109')
})

test('does not match words inside other words', () => {
  const r = extractDetails('A scarfing ringtone')
  assert.equal(r.category, null)
})

test('unknown items lead to a category question, then location, date, review', () => {
  const a = ruleBasedAssistant
  let s = a.start(TODAY)
  assert.equal(s.step, 'describe')
  s = a.respond(s, { kind: 'text', text: 'A small wooden carving of an owl' }, TODAY)
  assert.equal(s.step, 'category')
  assert.ok(s.quickReplies.length > 5)
  s = a.respond(s, { kind: 'choice', value: 'other', label: 'Other' }, TODAY)
  assert.equal(s.step, 'location')
  assert.equal(s.draft.itemName, 'Other')
  s = a.respond(s, { kind: 'choice', value: 'Guest room', label: 'In my room' }, TODAY)
  assert.equal(s.draft.lostLocation, 'Guest room')
  s = a.respond(s, { kind: 'choice', value: '2026-10-12', label: 'Yesterday' }, TODAY)
  assert.equal(s.step, 'review')
  assert.equal(s.draft.lostDate, '2026-10-12')
})

test('known items skip the category question; bad dates are re-asked', () => {
  const a = ruleBasedAssistant
  let s = a.respond(a.start(TODAY), { kind: 'text', text: 'Navy blue North Face jacket' }, TODAY)
  assert.equal(s.step, 'location')
  assert.equal(s.draft.category, 'clothing')
  assert.equal(s.draft.brand, 'North Face')
  s = a.respond(s, { kind: 'text', text: '' }, TODAY)
  s = a.respond(s, { kind: 'text', text: '2027-01-01' }, TODAY)
  assert.equal(s.step, 'date')
  s = a.respond(s, { kind: 'choice', value: '', label: 'Not sure' }, TODAY)
  assert.equal(s.step, 'review')
  assert.equal(s.draft.lostDate, null)
})

test('too-short descriptions are re-asked', () => {
  const a = ruleBasedAssistant
  const s = a.respond(a.start(TODAY), { kind: 'text', text: 'it' }, TODAY)
  assert.equal(s.step, 'describe')
})
