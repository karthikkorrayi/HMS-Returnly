// Guards the Railway copy of the migrations (db/migrations) against drifting
// from the Supabase originals (supabase/migrations) while both exist.
// Rule: same file names (apart from the Railway-only files listed in
// RAILWAY_ONLY); every shared file byte-identical, except
//   004_photo_storage   → comments only (Supabase Storage setup has no
//                          equivalent in plain Postgres), and
//   008_customer_requests → identical apart from the Railway note at the top
//                          and ONE removed block: the storage.objects upload policy.
// Photo rules move to the app in Phase 5 (see docs/MIGRATION_PLAN.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const SUPA = `${ROOT}supabase/migrations/`
const RAIL = `${ROOT}db/migrations/`
const read = (dir, f) => readFileSync(dir + f, 'utf8')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const sqlLines = (s) => s.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'))

const PHOTO = '20260929000004_photo_storage.sql'
const REQUESTS = '20261013000008_customer_requests.sql'
// The Supabase original of 004 that the empty Railway copy stands in for.
const PHOTO_SHA256 = '63368dea05b796be5f3ad892fd02c87b8d1adfbb455eb0c1949438108fdbea66'
const REMOVED_BLOCK_START = 'drop policy if exists item_photos_upload on storage.objects;\n'
const MARKER = '-- [Railway] Supabase Storage policy item_photos_upload removed here; see note at the top.\n\n'
const NOTE_END = '-- (end of Railway note)\n'
// Migrations that exist only for Railway (Supabase has its own Auth until
// launch). Each must be listed here explicitly and sort after every shared file.
const RAILWAY_ONLY = new Set(['20261022000009_auth_tables.sql', '20261024000010_staff_admin.sql', '20261026000011_sign_in_guard.sql', '20261030000012_hotel_setup.sql'])

test('both folders hold the same migration file names, apart from listed Railway-only files', () => {
  const rail = readdirSync(RAIL).sort()
  const supa = readdirSync(SUPA).sort()
  assert.deepEqual(rail.filter((f) => !RAILWAY_ONLY.has(f)), supa)
  for (const f of RAILWAY_ONLY) {
    assert.ok(rail.includes(f), `${f} is listed as Railway-only but missing from db/migrations`)
    assert.ok(!supa.includes(f), `${f} is listed as Railway-only but also exists in supabase/migrations`)
    assert.ok(supa.every((s) => s < f), `${f} must sort after every shared migration`)
  }
})

test('every migration except 004 and 008 is byte-identical', () => {
  for (const f of readdirSync(SUPA).sort()) {
    if (f === PHOTO || f === REQUESTS) continue
    assert.equal(read(RAIL, f), read(SUPA, f), `${f} differs between db/ and supabase/`)
  }
})

test('004 Railway copy contains no SQL, and the original is unchanged', () => {
  assert.deepEqual(sqlLines(read(RAIL, PHOTO)), [], 'db/migrations 004 must stay comments only')
  assert.equal(sha256(read(SUPA, PHOTO)), PHOTO_SHA256,
    'supabase/migrations 004 changed: re-check what the Railway copy and Phase 5 must cover')
})

test('008 Railway copy = original minus exactly the storage upload policy', () => {
  const original = read(SUPA, REQUESTS)
  const copy = read(RAIL, REQUESTS)

  const start = original.indexOf(REMOVED_BLOCK_START)
  assert.notEqual(start, -1, 'storage block not found in the original')
  assert.equal(original.indexOf(REMOVED_BLOCK_START, start + 1), -1, 'storage block appears twice')
  const end = original.indexOf('  );\n\n', start) + '  );\n\n'.length
  const block = original.slice(start, end)
  assert.match(block, /^drop policy if exists item_photos_upload on storage\.objects;\ncreate policy item_photos_upload on storage\.objects\n/)
  assert.equal(sqlLines(block).length, 15, 'removed block should be the 15-line policy')

  const noteEnd = copy.indexOf(NOTE_END)
  assert.notEqual(noteEnd, -1, 'Railway note missing at the top of the 008 copy')
  assert.ok(copy.slice(0, noteEnd).split('\n').every((l) => l === '' || l.startsWith('--')), 'note must be comments only')
  const body = copy.slice(noteEnd + NOTE_END.length)
  assert.equal(body, original.slice(0, start) + MARKER + original.slice(end))
})

test('no Railway migration touches Supabase Storage', () => {
  for (const f of readdirSync(RAIL)) {
    const hits = sqlLines(read(RAIL, f)).filter((l) => /\bstorage\.(objects|buckets|foldername)\b/.test(l))
    assert.deepEqual(hits, [], `${f} still references Supabase Storage`)
  }
})
