// What a manager can do to staff logins (step A4): add someone, set a new
// password, deactivate or reactivate, and (S5) change a name or role.
// Used by src/app/(app)/staff/actions.ts.
// No Next.js imports, so tests can run it against a real database.
//
// Two gates, both enforced:
//   1. the hotel database: the staff row is only written by
//      add_staff_member() / set_staff_active(), which run as the manager under
//      row-level security and refuse non-managers and other hotels
//      (db/migrations/20261024000010_staff_admin.sql);
//   2. Better Auth (auth_service): logins, passwords and sessions.
// Deactivating ends every session at once; a deactivated person who still
// knows their password is signed straight out again (finishSignIn).
import type { Tx } from '@/lib/db/core'
import type { Auth } from '@/lib/better-auth/config'
import { MAX_PASSWORD, MIN_PASSWORD } from '@/lib/better-auth/rules'
import { StaffLoginError, createStaffLogin, endStaffSessions, normaliseUsername, resetStaffPassword } from '@/lib/better-auth/staff-logins'
import type { StaffRole } from '@/lib/types'

export class StaffAdminError extends Error {}

export const STAFF_ROLES: StaffRole[] = ['housekeeping', 'front_office', 'manager', 'support']

/** Runs fn as the given staff member (withStaff from @/lib/db, or createDb(...).withStaff in tests). */
export type WithStaff = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const code = (e: unknown) => (e as { code?: string })?.code
const isUniqueViolation = (e: unknown) =>
  code(e) === '23505' || /unique|duplicate|already exists|already taken/i.test(String((e as Error)?.message ?? ''))

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new StaffAdminError(`Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`)
  }
}

function dbError(e: unknown): never {
  if (['42501', 'P0001', 'P0002'].includes(code(e) ?? '')) throw new StaffAdminError((e as Error).message)
  throw e
}

export async function addStaff(
  auth: Auth,
  withStaff: WithStaff,
  managerId: string,
  input: { username: string; displayName: string; role: string; password: string }
): Promise<string> {
  let username: string
  try {
    username = normaliseUsername(input.username)
  } catch (e) {
    throw new StaffAdminError((e as StaffLoginError).message)
  }
  const name = input.displayName.trim()
  if (name.length < 1 || name.length > 80) throw new StaffAdminError('Enter the person’s name as colleagues know it (up to 80 characters).')
  if (!(STAFF_ROLES as string[]).includes(input.role)) throw new StaffAdminError('Choose a role.')
  checkPassword(input.password)

  let userId: string
  try {
    userId = await createStaffLogin(auth, { username, password: input.password, name })
  } catch (e) {
    if (isUniqueViolation(e)) throw new StaffAdminError('That username is already taken.')
    throw e
  }
  try {
    await withStaff(managerId, (tx) =>
      tx.rpc('add_staff_member', { p_user_id: userId, p_username: username, p_display_name: name, p_role: input.role })
    )
  } catch (e) {
    // The staff row was not added: remove the new login again (its account
    // and any sessions go with it), so no orphan login is left behind.
    const ctx = await auth.$context
    await ctx.internalAdapter.deleteUser(userId)
    if (isUniqueViolation(e)) throw new StaffAdminError('That username is already taken.')
    dbError(e)
  }
  return userId
}

/** The target as the caller sees them under RLS (null = not in the caller's hotel),
 *  after the database confirms the caller is an active manager. */
async function inMyHotel(withStaff: WithStaff, managerId: string, userId: string): Promise<{ active: boolean } | null> {
  const r = await withStaff(managerId, async (tx) => {
    const me = (await tx.query<{ ok: boolean }>(`select public.has_role('{manager}') as ok`)).rows[0]
    if (!me?.ok) throw new StaffAdminError('Only managers can reset passwords.')
    if (!UUID.test(userId)) return []
    return (await tx.query<{ active: boolean }>(`select active from public.staff where user_id = $1`, [userId])).rows
  })
  return r[0] ?? null
}

export async function setStaffPassword(auth: Auth, withStaff: WithStaff, managerId: string, userId: string, password: string): Promise<void> {
  checkPassword(password)
  if (userId === managerId) throw new StaffAdminError('You can’t reset your own password here.')
  const target = await inMyHotel(withStaff, managerId, userId)
  if (!target) throw new StaffAdminError('Staff member not found.')
  if (!target.active) throw new StaffAdminError('Reactivate this person before setting a new password.')
  await resetStaffPassword(auth, userId, password) // also ends all their sessions
}

export async function setStaffActive(auth: Auth, withStaff: WithStaff, managerId: string, userId: string, active: boolean): Promise<void> {
  if (!UUID.test(userId)) throw new StaffAdminError('Staff member not found.')
  try {
    await withStaff(managerId, (tx) => tx.rpc('set_staff_active', { p_user_id: userId, p_active: active }))
  } catch (e) {
    dbError(e)
  }
  if (!active) await endStaffSessions(auth, userId)
}

/** Renames someone or changes their role (e.g. makes them a manager). The
 *  database refuses a manager changing their own role and keeps at least one
 *  active manager (update_staff_member, migration 012). A new role applies on
 *  the person's next page load: roles are read from the database each time. */
export async function updateStaff(
  withStaff: WithStaff,
  managerId: string,
  userId: string,
  input: { displayName: string; role: string }
): Promise<void> {
  if (!UUID.test(userId)) throw new StaffAdminError('Staff member not found.')
  const name = input.displayName.trim()
  if (name.length < 1 || name.length > 80) throw new StaffAdminError('Enter the person’s name as colleagues know it (up to 80 characters).')
  if (!(STAFF_ROLES as string[]).includes(input.role)) throw new StaffAdminError('Choose a role.')
  try {
    await withStaff(managerId, (tx) =>
      tx.query(`select public.update_staff_member($1::uuid, $2, $3::public.staff_role)`, [userId, name, input.role])
    )
  } catch (e) {
    dbError(e)
  }
}
