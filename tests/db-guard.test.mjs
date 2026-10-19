// The data layer's safety rules (src/lib/db/core.ts), without a database:
// which SQL the app may send, input validation, and a scan of the source code
// so nothing outside src/lib/db switches roles or talks to Postgres directly.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { guardSql, createDb, DbGuardError } from '../src/lib/db/core.ts'

const refuses = (sql) => assert.throws(() => guardSql(sql), DbGuardError, sql)
const allows = (sql) => assert.doesNotThrow(() => guardSql(sql), sql)

test('ordinary queries are allowed', () => {
  allows('select id, status from public.lost_items where id = $1')
  allows('update public.lost_items set description = $1 where id = $2')
  allows('insert into public.item_photos (item_id, storage_path) values ($1, $2) returning id')
  allows('delete from public.item_photos where id = $1')
  allows('with x as (select 1) select * from x')
  allows('select * from public.change_status(p_item => $1)')
})

test('role, user-id and session changes are refused', () => {
  refuses('set role app_owner')
  refuses('SET ROLE postgres')
  refuses('set session role authenticated')
  refuses('set local role anon')
  refuses('reset role')
  refuses('RESET ALL')
  refuses('set session authorization postgres')
  refuses("set request.jwt.claim.sub = 'x'")
  refuses("set local request.jwt.claim.sub = 'x'")
  refuses("select set_config('request.jwt.claim.sub', $1, true)")
  refuses("select set_config('request.jwt.claim.sub', $1, false)")
  refuses("with x as (select set_config('role', 'postgres', false)) select * from x")
  refuses('discard all')
})

test('transaction control is refused', () => {
  for (const s of ['begin', 'COMMIT', 'rollback', 'abort', 'end', 'start transaction', 'savepoint a', 'release savepoint a', "prepare transaction 'x'"]) refuses(s)
})

test('a second statement is checked too', () => {
  refuses('select 1; set role app_owner')
  refuses('select 1;\n  commit')
})

test('words inside strings and comments are not mistaken for commands', () => {
  allows("select 'set role app_owner' as note")
  allows("select 'it''s; reset all' as note")
  allows('select 1 -- set role app_owner')
  allows('select /* commit */ 1')
})

test('withStaff needs a real user id; rpc names are validated', async () => {
  const pool = { connect: async () => { throw new Error('should not connect') } }
  const db = createDb(pool)
  assert.throws(() => db.withStaff('', async () => 1), DbGuardError)
  assert.throws(() => db.withStaff("x' or 1=1 --", async () => 1), DbGuardError)
  assert.throws(() => db.withStaff('not-a-uuid', async () => 1), DbGuardError)

  const calls = []
  const client = {
    query: async (sql, params) => { calls.push([sql, params]); return { rows: [], rowCount: 0 } },
    release: () => {},
  }
  const fake = createDb({ connect: async () => client })
  await fake.withAnon(async (tx) => {
    await tx.rpc('customer_request_status', { p_reference: 'LF-1', p_booking_ref: 'B1' })
    await assert.rejects(tx.rpc('x; drop table y'), DbGuardError)
    await assert.rejects(tx.rpc('ok', { 'a) or (1': 1 }), DbGuardError)
  })
  const rpcCall = calls.find(([s]) => s.includes('customer_request_status'))
  assert.equal(rpcCall[0], 'select * from public.customer_request_status(p_reference => $1, p_booking_ref => $2)')
  assert.deepEqual(rpcCall[1], ['LF-1', 'B1'])
  assert.deepEqual(calls.map(([s]) => s).filter((s) => !s.includes('customer_request_status')),
    ['begin', 'set local role anon', 'commit'])
})

test('a failed transaction is rolled back and a broken connection is not reused', async () => {
  const released = []
  const failingRollback = {
    query: async (sql) => {
      if (sql === 'rollback') throw new Error('connection lost')
      return { rows: [], rowCount: 0 }
    },
    release: (destroy) => released.push(destroy),
  }
  const db = createDb({ connect: async () => failingRollback })
  await assert.rejects(db.withAnon(async () => { throw new Error('boom') }), /boom/)
  assert.ok(released[0] instanceof Error, 'connection must be destroyed when rollback fails')

  const ok = { query: async () => ({ rows: [], rowCount: 0 }), release: (d) => released.push(d) }
  await createDb({ connect: async () => ok }).withAnon(async () => 1)
  assert.equal(released[1], false, 'healthy connection goes back to the pool')
})

// --- Source scan ---------------------------------------------------------------------
const ROOT = new URL('..', import.meta.url).pathname
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield p
  }
}

test('only src/lib/db sets roles, user ids or talks to Postgres directly', () => {
  const offenders = []
  for (const f of files(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f)
    if (rel.startsWith('src/lib/db/')) continue
    const text = readFileSync(f, 'utf8')
    if (/\bset\s+(local\s+|session\s+)?role\b/i.test(text)) offenders.push(`${rel}: SET ROLE`)
    if (/\bset_config\s*\(/i.test(text)) offenders.push(`${rel}: set_config(`)
    if (/from\s+['"]pg['"]|require\(\s*['"]pg['"]\s*\)/.test(text)) offenders.push(`${rel}: imports pg`)
  }
  assert.deepEqual(offenders, [])
})
