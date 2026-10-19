// Opens the database the DB test suites run against.
//
//   npm run test:db       → in-memory PGlite (default, no setup needed)
//   npm run test:db:pg    → a real Postgres server named by TEST_DATABASE_URL
//
// With TEST_DATABASE_URL each suite creates its own throwaway database
// (returnly_test_<suite>_<pid>) and drops it when it finishes, so suites never
// see each other's data. The URL must be a superuser on a LOCAL test server
// (localhost, 127.0.0.1, ::1 or a Unix socket); anything else is refused so the
// tests can never be pointed at a real database by mistake.
import { PGlite } from '@electric-sql/pglite'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])

export async function openTestDb(suite) {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    const db = new PGlite()
    return { db, kind: 'PGlite', close: () => db.close() }
  }

  const parsed = new URL(url)
  const socketHost = parsed.searchParams.get('host') ?? ''
  if (!LOCAL_HOSTS.has(parsed.hostname) && !socketHost.startsWith('/')) {
    throw new Error('TEST_DATABASE_URL must point at a local test server (localhost or a Unix socket).')
  }
  if (!/^[a-z0-9_]+$/.test(suite)) throw new Error(`Bad suite name: ${suite}`)

  const { default: pg } = await import('pg')
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()

  const name = `returnly_test_${suite}_${process.pid}`
  await admin.query(`drop database if exists "${name}"`)
  await admin.query(`create database "${name}"`)
  // Roles are shared by the whole server, so create them once, idempotently.
  for (const role of ['anon', 'authenticated']) {
    try {
      await admin.query(`create role ${role} nologin`)
    } catch (e) {
      if (e.code !== '42710') throw e // 42710 = role already exists
    }
  }

  parsed.pathname = '/' + name
  const client = new pg.Client({ connectionString: parsed.toString() })
  await client.connect()

  // PGlite reports changed rows as `affectedRows`; node-postgres calls it
  // `rowCount`. Expose both so the suites read the same field on either.
  const run = async (sql, params) => {
    const r = await client.query(sql, params)
    return Object.assign(r, { affectedRows: r.rowCount })
  }
  const db = {
    exec: (sql) => client.query(sql),
    query: run,
    async transaction(fn) {
      await client.query('begin')
      try {
        const result = await fn({ query: run })
        await client.query('commit')
        return result
      } catch (e) {
        await client.query('rollback')
        throw e
      }
    },
  }

  const close = async () => {
    await client.end()
    await admin.query(`drop database if exists "${name}"`)
    await admin.end()
  }
  const { rows } = await admin.query(`select current_setting('server_version') as v`)
  return { db, kind: `Postgres ${rows[0].v}`, close }
}
