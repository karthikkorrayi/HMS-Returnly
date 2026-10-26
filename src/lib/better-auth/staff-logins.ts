// Staff logins are managed through Better Auth's internal adapter (design
// option 2, docs/AUTH_SPIKE_REPORT.md): no admin plugin, so no extra roles and
// no impersonation. Permissions stay in public.staff.role.
// These functions do NOT check who is calling: the caller (a manager-only
// server action or the create-staff command) must do that first.
import { MAX_PASSWORD, MIN_PASSWORD, USERNAME_PATTERN, type Auth } from './config'
import { guardKey, makeSignInGuard, type Query } from './sign-in-guard'

export class StaffLoginError extends Error {}

export const STAFF_EMAIL_DOMAIN = process.env.STAFF_EMAIL_DOMAIN || 'staff.invalid'

export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new StaffLoginError(`Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`)
  }
}

export function normaliseUsername(raw: string): string {
  const username = raw.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) {
    throw new StaffLoginError('Username must be 3–32 characters: a–z, 0–9, dot, dash or underscore.')
  }
  return username
}

/** Creates a login (public sign-up is disabled). Returns the new user id (UUID). */
export async function createStaffLogin(auth: Auth, input: { username: string; password: string; name: string }): Promise<string> {
  const username = normaliseUsername(input.username)
  checkPassword(input.password)
  const name = input.name.trim()
  if (name.length < 1 || name.length > 80) throw new StaffLoginError('Name must be 1–80 characters.')
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    name,
    email: `${username}@${STAFF_EMAIL_DOMAIN}`, // never mailed; the column is required
    emailVerified: true,
    username,
    displayUsername: username,
  }, { method: 'admin' })
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  })
  return user.id
}

/** Sets a new password (stored as a scrypt hash), ends every session of that
 *  user, and clears any wrong-password lock on their username. */
export async function resetStaffPassword(auth: Auth, userId: string, password: string): Promise<void> {
  checkPassword(password)
  const ctx = await auth.$context
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password))
  await ctx.internalAdapter.deleteUserSessions(userId)
  const user = (await ctx.internalAdapter.findUserById(userId)) as { username?: string | null } | null
  const key = guardKey(user?.username)
  const pool = auth.options.database as { query?: Query }
  if (key && typeof pool?.query === 'function') await makeSignInGuard(pool.query.bind(pool)).clear(key)
}

/** Ends every session of a user. Deactivation = set staff.active = false, then call this. */
export async function endStaffSessions(auth: Auth, userId: string): Promise<void> {
  const ctx = await auth.$context
  await ctx.internalAdapter.deleteUserSessions(userId)
}
