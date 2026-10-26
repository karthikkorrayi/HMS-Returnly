// A signed-in staff member changing their own password (Phase 6, step 2).
// Needs the current password (so a phone left signed in can't be used to take
// over the account), signs out every other device, and keeps this one signed
// in with a fresh session. Wrong current passwords count towards the same
// per-username lock as sign-in: this runs inside the server, where Better
// Auth's per-address limit does not apply. No Next.js imports.
import { isAPIError } from 'better-auth/api'
import type { Auth } from './config'
import { MAX_PASSWORD, MIN_PASSWORD } from './rules'
import { LOCK_MINUTES, guardKey, makeSignInGuard, type Query } from './sign-in-guard'

export class OwnPasswordError extends Error {}

const SESSION_ENDED = 'Your session has ended. Sign in again.'

/** Returns the response headers (the new session cookie). In the app the
 *  nextCookies() plugin applies them; tests read them directly. */
export async function changeOwnPassword(
  auth: Auth,
  headers: Headers,
  input: { current: string; next: string; confirm: string }
): Promise<Headers> {
  if (!input.current) throw new OwnPasswordError('Enter your current password.')
  if (input.next.length < MIN_PASSWORD || input.next.length > MAX_PASSWORD) {
    throw new OwnPasswordError(`The new password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`)
  }
  if (input.next !== input.confirm) throw new OwnPasswordError('The two new passwords do not match.')
  if (input.next === input.current) throw new OwnPasswordError('Choose a new password that is different from the current one.')

  // The username comes from the session itself, never from the form.
  const session = await auth.api.getSession({ headers })
  if (!session) throw new OwnPasswordError(SESSION_ENDED)
  const key = guardKey((session.user as { username?: string | null }).username)

  const pool = auth.options.database as { query?: Query }
  if (typeof pool?.query !== 'function') throw new Error('changeOwnPassword needs the auth_service pool.')
  const guard = makeSignInGuard(pool.query.bind(pool))
  if (key) {
    const minutes = await guard.lockedMinutes(key)
    if (minutes > 0) {
      throw new OwnPasswordError(`Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
    }
  }

  try {
    const res = await auth.api.changePassword({
      body: { currentPassword: input.current, newPassword: input.next, revokeOtherSessions: true },
      headers,
      returnHeaders: true,
    })
    if (key) await guard.clear(key)
    return res.headers
  } catch (e) {
    if (isAPIError(e) && (e.body as { code?: string } | undefined)?.code === 'INVALID_PASSWORD') {
      if (key && (await guard.recordFailure(key)).locked) {
        throw new OwnPasswordError(`Too many wrong passwords. This username is locked for ${LOCK_MINUTES} minutes.`)
      }
      throw new OwnPasswordError('Your current password is not correct.')
    }
    if (isAPIError(e) && e.statusCode === 401) throw new OwnPasswordError(SESSION_ENDED)
    throw e
  }
}
