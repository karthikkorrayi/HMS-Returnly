// Better Auth configured for HMS Returnly (decision D2, docs/AUTH_SPIKE_REPORT.md).
// No Next.js imports, so tests can build it directly.
//
//   * username + password only; public sign-up is disabled;
//   * ids are UUIDs generated here, so auth.users.id = public.staff.user_id = auth.uid();
//   * tables live in schema auth and are reached only through the auth_service pool;
//   * sessions last 12 hours (refreshed hourly while in use); no cookie cache, so
//     ending a session takes effect on the very next request;
//   * sign-in attempts are rate limited per address (30 a minute: the hotel
//     Wi-Fi is one address) with counters in Postgres, and wrong passwords
//     are limited per username (10 in 15 minutes locks it for 15 minutes);
//   * deactivated staff are refused a session (auth.users.blocked);
//   * telemetry is off.
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { username } from 'better-auth/plugins'
import { randomUUID } from 'node:crypto'
import { SESSION_HOURS, SIGN_IN_ATTEMPTS_PER_MINUTE, MIN_PASSWORD, MAX_PASSWORD, USERNAME_PATTERN } from './rules'
import { guardKey, makeSignInGuard, type Query } from './sign-in-guard'

export { USERNAME_PATTERN, MIN_PASSWORD, MAX_PASSWORD, SESSION_HOURS, SIGN_IN_ATTEMPTS_PER_MINUTE } from './rules'

type BetterAuthOptions = Parameters<typeof betterAuth>[0]

export type AuthConfig = {
  /** pg Pool logged in as auth_service (see src/lib/db/auth-pool.ts). */
  database: BetterAuthOptions['database']
  /** Public address of the app, e.g. https://returnly.example */
  baseURL: string
  /** At least 32 random characters, from the environment. */
  secret: string
  /** The single header the hosting proxy sets (and overwrites) with the client IP. */
  ipHeader?: string
  /** Secure cookies; defaults to true when baseURL is https. */
  secure?: boolean
  /** Added after the username plugin, e.g. nextCookies() in the app (it must be last). */
  plugins?: BetterAuthPlugin[]
}

const fields = (map: Record<string, string>) => map

export function makeAuth(cfg: AuthConfig) {
  if (cfg.secret.length < 32) throw new Error('The Better Auth secret must be at least 32 characters.')
  // The sign-in guard uses the same auth_service pool (fails closed without it).
  const pool = cfg.database as { query?: Query }
  if (typeof pool?.query !== 'function') throw new Error('makeAuth needs the auth_service pg Pool as database.')
  const guard = makeSignInGuard(pool.query.bind(pool))
  const secure = cfg.secure ?? cfg.baseURL.startsWith('https://')
  return betterAuth({
    database: cfg.database,
    baseURL: cfg.baseURL,
    secret: cfg.secret,
    trustedOrigins: [new URL(cfg.baseURL).origin],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: MAX_PASSWORD,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      modelName: 'session',
      fields: fields({ userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' }),
      expiresIn: SESSION_HOURS * 60 * 60,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    user: {
      modelName: 'users',
      fields: fields({ emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' }),
    },
    account: {
      modelName: 'account',
      fields: fields({
        accountId: 'account_id', providerId: 'provider_id', userId: 'user_id',
        accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at', updatedAt: 'updated_at',
      }),
    },
    verification: {
      modelName: 'verification',
      fields: fields({ expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' }),
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rate_limit',
      fields: fields({ lastRequest: 'last_request' }),
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/username': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
        '/sign-in/email': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
      },
    },
    advanced: {
      // 'uuid' would leave ids to Postgres defaults; generate them here instead.
      database: { generateId: () => randomUUID() },
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure },
      ipAddress: { ipAddressHeaders: [cfg.ipHeader ?? 'x-real-ip'] },
    },
    // Phase 6 sign-in protection (src/lib/better-auth/sign-in-guard.ts).
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/username') return
        const key = guardKey((ctx.body as { username?: unknown } | undefined)?.username)
        if (!key) return
        const minutes = await guard.lockedMinutes(key)
        if (minutes > 0) {
          throw new APIError('TOO_MANY_REQUESTS', {
            code: 'USERNAME_LOCKED',
            message: `Too many wrong passwords for this username. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask a manager to set a new password.`,
          })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/username') return
        const key = guardKey((ctx.body as { username?: unknown } | undefined)?.username)
        if (!key) return
        const returned = ctx.context.returned
        if (isAPIError(returned)) {
          if (returned.statusCode === 401) await guard.recordFailure(key) // wrong username or password
          return
        }
        await guard.clear(key) // correct password: start again from zero
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // A deactivated staff member never gets a session, by any route.
          before: async (session) => {
            if (await guard.isBlocked(session.userId)) {
              throw new APIError('FORBIDDEN', { code: 'ACCOUNT_DISABLED', message: 'This account is not active. Ask a manager.' })
            }
          },
        },
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (u) => USERNAME_PATTERN.test(u),
        schema: { user: { fields: { displayUsername: 'display_username' } } },
      }),
      ...(cfg.plugins ?? []),
    ],
  })
}

export type Auth = ReturnType<typeof makeAuth>
