// Adds a staff member: a Better Auth login plus their public.staff row.
// Used by the create-staff command (scripts/create-staff.mjs) to create the
// first manager of a hotel. It does NOT check who is calling: only someone
// with the app_owner database login can run it.
//
// The login (auth_service pool) and the staff row (app_owner connection) are
// in two different connections, so this cannot be one transaction. Instead:
// everything that can be checked is checked first, and if the staff row still
// fails, the new login is deleted again so no orphan login is left behind.
import type { Auth } from './config'
import { StaffLoginError, checkPassword, createStaffLogin, normaliseUsername } from './staff-logins'

export const STAFF_ROLES = ['housekeeping', 'front_office', 'manager', 'support'] as const
export type StaffRoleName = (typeof STAFF_ROLES)[number]

/** A connection logged in as app_owner (e.g. pg.Client from MIGRATION_DATABASE_URL). */
export type OwnerDb = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export async function assertOwner(db: OwnerDb): Promise<void> {
  const me = (await db.query(`select current_user as u, r.rolsuper as su from pg_roles r where r.rolname = current_user`)).rows[0]
  if (me?.u !== 'app_owner' || me?.su) {
    throw new StaffLoginError(`This must connect as app_owner (got "${String(me?.u)}"). Check MIGRATION_DATABASE_URL.`)
  }
}

export async function addStaffMember(
  auth: Auth,
  owner: OwnerDb,
  input: { property: string; username: string; name: string; role: string; password: string }
): Promise<{ userId: string; propertyName: string }> {
  const username = normaliseUsername(input.username)
  checkPassword(input.password)
  if (!(STAFF_ROLES as readonly string[]).includes(input.role)) {
    throw new StaffLoginError(`Role must be one of: ${STAFF_ROLES.join(', ')}.`)
  }
  const name = input.name.trim()
  if (name.length < 1 || name.length > 80) throw new StaffLoginError('Name must be 1–80 characters.')

  await assertOwner(owner)
  const property = (
    await owner.query(`select id, name from public.properties where inn_code = $1`, [input.property.trim().toUpperCase()])
  ).rows[0] as { id: string; name: string } | undefined
  if (!property) throw new StaffLoginError(`No hotel with code ${input.property}. Did the seed run?`)

  const taken = (
    await owner.query(
      `select 1 from public.staff where username = $1 union all select 1 from auth.users where username = $1`,
      [username]
    )
  ).rows.length
  if (taken) throw new StaffLoginError(`The username "${username}" is already taken.`)

  const userId = await createStaffLogin(auth, { username, password: input.password, name })
  try {
    await owner.query(
      `insert into public.staff (user_id, property_id, username, display_name, role)
       values ($1, $2, $3, $4, $5::public.staff_role)`,
      [userId, property.id, username, name, input.role]
    )
  } catch (e) {
    const ctx = await auth.$context
    await ctx.internalAdapter.deleteUser(userId) // its account and sessions go with it (on delete cascade)
    throw new StaffLoginError(`Could not add the staff row, so the login was removed again: ${(e as Error).message}`)
  }
  return { userId, propertyName: property.name }
}
