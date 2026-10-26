// Phase 7: the health check Railway uses (src/lib/health.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkHealth } from '../src/lib/health.ts'

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

test('database answers: ok / 200', async () => {
  assert.deepEqual(await checkHealth(async () => ({ rows: [1] })), { status: 'ok', httpStatus: 200 })
})

test('database refuses: unavailable / 503, and the error message is not logged', async () => {
  const logged = []
  const e = console.error; console.error = (m) => logged.push(String(m))
  try {
    const err = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2'), { code: 'ECONNREFUSED' })
    assert.deepEqual(await checkHealth(async () => { throw err }), { status: 'unavailable', httpStatus: 503 })
  } finally { console.error = e }
  assert.equal(logged.length, 1)
  assert.match(logged[0], /ECONNREFUSED/)
  assert.ok(!/10\.1\.2\.3|hunter2/.test(logged[0]), 'no address or secret in the log')
})

test('database hangs: unavailable within the time limit', async () => {
  const t = Date.now()
  const r = await quiet(() => checkHealth(() => new Promise(() => {}), 100))
  assert.deepEqual(r, { status: 'unavailable', httpStatus: 503 })
  assert.ok(Date.now() - t < 1000)
})
