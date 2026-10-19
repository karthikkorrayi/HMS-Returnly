// Opens the database the DB test suites run against.
//
//   npm run test:db
//       → in-memory PGlite (default, no setup needed)
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:db
//       → a real local Postgres server (CI does this with Postgres 17)
//
// With TEST_DATABASE_URL each suite creates its own throwaway database
// (returnly_test_<suite>_<pid>) and drops it when it finishes, so suites never
// see each other's data. The URL must be a superuser on a LOCAL test server
// (localhost, 127.0.0.1, ::1 or a Unix socket); anything else is refused so the
// tests can never be pointed at a real database by mistake.
//
// connectAs(role) opens an extra connection that logs in as another role (for
// example app_user, exactly as the web app will). It needs a server that trusts
// local logins without a password (CI and the Docker test container do) and is
// only available on real Postgres; on PGlite it returns null.
import { PGlite } from '@electric-sql/pglite'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])

export async function openTestDb(suite) {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    const db = new PGlite()
    return { db, kind: 'PGlite', connectAs: async () => null, close: () => db.close() }
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
  const wrap = (c) => async (sql, params) => {
    const r = await c.query(sql, params)
    return Object.assign(r, { affectedRows: r.rowCount })
  }
  const run = wrap(client)
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

  const extra = []
  const connectAs = async (role) => {
    if (!/^[a-z_]+$/.test(role)) throw new Error(`Bad role name: ${role}`)
    const u = new URL(parsed.toString())
    u.username = role
    u.password = ''
    const c = new pg.Client({ connectionString: u.toString() })
    await c.connect()
    extra.push(c)
    return { query: wrap(c), exec: (sql) => c.query(sql), end: () => c.end() }
  }

  const close = async () => {
    for (const c of extra) await c.end().catch(() => {})
    await client.end()
    await admin.query(`drop database if exists "${name}"`)
    await admin.end()
  }
  const { rows } = await admin.query(`select current_setting('server_version') as v`)
  return { db, kind: `Postgres ${rows[0].v}`, connectAs, close }
}
