// Data layer for plain Postgres (Railway). Every database call made by the app
// goes through withStaff() or withAnon(), which run it inside one transaction
// as a restricted role, exactly as Supabase did:
//
//   BEGIN;
//   SET LOCAL ROLE authenticated;                          -- or anon
//   SELECT set_config('request.jwt.claim.sub', $1, true);  -- staff user id
//   …your queries…
//   COMMIT;
//
// Row-level security and the workflow functions then decide what is allowed.
// "LOCAL" settings end with the transaction, so nothing can leak to the next
// request that reuses the pooled connection (see supabase/tests/platform.test.mjs).
//
// This file has no Next.js imports so the tests can load it directly;
// the app imports it through ./index.ts (server-only).

export type Row = Record<string, unknown>
export type QueryResult<T extends Row = Row> = { rows: T[]; rowCount: number | null }

// The parts of a node-postgres Pool / PoolClient we use.
export interface PoolClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>
  release(destroy?: boolean | Error): void
}
export interface PoolLike {
  connect(): Promise<PoolClientLike>
}

export interface Tx {
  /** Run one parameterised statement ($1, $2, …). Never build SQL from user input. */
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  /** Call public.<fn>(name => value, …) and return its rows, like supabase.rpc(). */
  rpc<T extends Row = Row>(fn: string, args?: Record<string, unknown>): Promise<QueryResult<T>>
}

export class DbGuardError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/

// Statements that could change who the request runs as (role or user id),
// leak a setting to the next request, or end the transaction early. They are
// refused before reaching the database. Only this module sets the role and id.
const FORBIDDEN: [RegExp, string][] = [
  [/^\s*(set|reset)\b/i, 'SET/RESET statements (role and settings are managed by withStaff/withAnon)'],
  [/\bset_config\s*\(/i, 'set_config() (could change the user id for the rest of the transaction)'],
  [/^\s*(begin|commit|rollback|abort|end|start\s+transaction|savepoint|release|prepare\s+transaction)\b/i, 'transaction control'],
  [/^\s*discard\b/i, 'DISCARD'],
]

export function guardSql(sql: string): void {
  // Ignore string literals and comments when checking.
  const code = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const statement of code.split(';')) {
    for (const [re, what] of FORBIDDEN) {
      if (re.test(statement)) throw new DbGuardError(`Refused SQL: ${what} is not allowed in app queries.`)
    }
  }
}

function makeTx(client: PoolClientLike): Tx {
  const query = async <T extends Row = Row>(sql: string, params: unknown[] = []) => {
    guardSql(sql)
    const r = await client.query(sql, params)
    return { rows: r.rows as T[], rowCount: r.rowCount }
  }
  const rpc = async <T extends Row = Row>(fn: string, args: Record<string, unknown> = {}) => {
    if (!IDENT.test(fn)) throw new DbGuardError(`Bad function name: ${fn}`)
    const names = Object.keys(args)
    for (const n of names) if (!IDENT.test(n)) throw new DbGuardError(`Bad argument name: ${n}`)
    const list = names.map((n, i) => `${n} => $${i + 1}`).join(', ')
    return query<T>(`select * from public.${fn}(${list})`, names.map((n) => args[n]))
  }
  return { query, rpc }
}

async function run<T>(pool: PoolLike, role: 'authenticated' | 'anon', userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken: Error | undefined
  try {
    await client.query('begin')
    await client.query(role === 'authenticated' ? 'set local role authenticated' : 'set local role anon')
    if (userId) await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    const result = await fn(makeTx(client))
    await client.query('commit')
    return result
  } catch (e) {
    try {
      await client.query('rollback')
    } catch (rollbackError) {
      // The connection is in an unknown state: destroy it instead of reusing it.
      broken = rollbackError as Error
    }
    throw e
  } finally {
    client.release(broken ?? false)
  }
}

export function createDb(pool: PoolLike) {
  return {
    /** Run fn as a signed-in staff member. userId must be their auth user id (UUID). */
    withStaff<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
      if (!UUID.test(userId)) throw new DbGuardError('withStaff needs the staff user id (a UUID).')
      return run(pool, 'authenticated', userId, fn)
    },
    /** Run fn for a public, signed-out visitor (customer pages). */
    withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return run(pool, 'anon', null, fn)
    },
  }
}

// Fails closed if the app is connected as anything but the restricted app_user
// (for example a superuser URL pasted by mistake, which would bypass RLS).
export async function assertAppUser(pool: PoolLike): Promise<void> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(`select current_user as u, r.rolsuper as su, r.rolbypassrls as br, r.rolinherit as inh
      from pg_roles r where r.rolname = current_user`)
    const me = rows[0] as { u: string; su: boolean; br: boolean; inh: boolean }
    if (me.u !== 'app_user' || me.su || me.br || me.inh) {
      throw new DbGuardError(`DATABASE_URL must log in as app_user (got "${me.u}"). Refusing to serve requests.`)
    }
  } finally {
    client.release()
  }
}
