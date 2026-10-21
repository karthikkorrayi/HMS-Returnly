// The app's single Better Auth instance, created on first use from the
// environment (so `next build` needs no credentials) and checked once to be
// logged in as auth_service before it serves any request.
import 'server-only'
import { assertAuthService, createAuthPool } from '@/lib/db/auth-pool'
import { makeAuth, type Auth } from './config'

type Holder = { auth?: Auth; checked?: Promise<void> }
const holder = globalThis as typeof globalThis & { __returnlyAuth?: Holder }
const state: Holder = (holder.__returnlyAuth ??= {})

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set.`)
  return value
}

export function authBaseURL(): string {
  return need('BETTER_AUTH_URL')
}

export async function getAuth(): Promise<Auth> {
  if (!state.auth) {
    const pool = createAuthPool(need('AUTH_DATABASE_URL'))
    state.auth = makeAuth({
      database: pool,
      baseURL: authBaseURL(),
      secret: need('BETTER_AUTH_SECRET'),
      ipHeader: process.env.AUTH_IP_HEADER || undefined,
    })
    state.checked = assertAuthService(pool).catch((e) => {
      state.auth = undefined
      state.checked = undefined
      throw e
    })
  }
  await state.checked
  return state.auth!
}
