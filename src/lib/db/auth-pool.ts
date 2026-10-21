// The connection pool Better Auth uses. It lives under src/lib/db because only
// this folder may talk to Postgres directly (tests/db-guard.test.mjs).
// It logs in as auth_service, which can reach only the sign-in tables in
// schema auth (db/migrations/20261022000009_auth_tables.sql) — never hotel data.
import pg from 'pg'

export class AuthPoolError extends Error {}

export function createAuthPool(connectionString: string, max = 5): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    application_name: 'returnly-auth',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  })
}

// Fails closed unless the pool logs in as auth_service with its expected
// limits (not a superuser, no BYPASSRLS, search_path = auth).
export async function assertAuthService(pool: pg.Pool): Promise<void> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(`select current_user as u, r.rolsuper as su, r.rolbypassrls as br,
      current_setting('search_path') as path from pg_roles r where r.rolname = current_user`)
    const me = rows[0] as { u: string; su: boolean; br: boolean; path: string }
    if (me.u !== 'auth_service' || me.su || me.br) {
      throw new AuthPoolError(`AUTH_DATABASE_URL must log in as auth_service (got "${me.u}"). Refusing to start sign-in.`)
    }
    if (!/^"?auth"?$/.test(me.path.trim())) {
      throw new AuthPoolError(`auth_service search_path is "${me.path}", expected "auth". Re-run db/bootstrap/000_platform.sql.`)
    }
  } finally {
    client.release()
  }
}
