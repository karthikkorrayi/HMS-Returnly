import 'server-only'
import { Pool } from 'pg'
import { assertAppUser, createDb, type PoolLike } from './core'

export type { Tx, Row, QueryResult } from './core'
export { DbGuardError } from './core'

// One pool per server process. Kept on globalThis so Next.js dev reloads reuse
// it instead of opening new connections on every code change.
type Holder = { pool?: Pool; checked?: Promise<void> }
const holder = globalThis as typeof globalThis & { __returnlyDb?: Holder }
const state: Holder = (holder.__returnlyDb ??= {})

function pool(): Pool {
  if (!state.pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set (it must log in as app_user).')
    state.pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      application_name: 'returnly-web',
    })
  }
  return state.pool
}

// Checked once per process, before the first query: fails closed if the URL
// logs in as anything other than the restricted app_user.
async function ready(): Promise<PoolLike> {
  const p = pool()
  state.checked ??= assertAppUser(p).catch((e) => {
    state.checked = undefined
    throw e
  })
  await state.checked
  return p
}

const lazyPool: PoolLike = { connect: async () => (await ready()).connect() }
const db = createDb(lazyPool)

/** Run fn as a signed-in staff member (RLS applies as that user). */
export const withStaff = db.withStaff
/** Run fn as a public, signed-out visitor (customer pages). */
export const withAnon = db.withAnon
