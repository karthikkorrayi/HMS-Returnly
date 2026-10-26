import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/better-auth/instance'
import { withStaff } from '@/lib/db'
import { loadStaffSession, type Session } from '@/lib/staff-session'
import type { StaffRole } from '@/lib/types'

export type { Session } from '@/lib/staff-session'
export { USERNAME_PATTERN } from '@/lib/better-auth/rules'

// The Better Auth login behind this request's session cookie, or null.
// Checked against the database on every call (no cookie cache), so ending a
// session takes effect on the very next request.
// headers() comes first: it marks every page that checks the session as
// rendered per request, so `next build` never tries to sign in.
// The cookie header is rebuilt from cookies(), which (unlike headers()) also
// sees a cookie a server action has just set: after a password change the
// page re-renders with the NEW session, not the one that was just ended.
export const currentLogin = cache(async (): Promise<{ userId: string } | null> => {
  const requestHeaders = new Headers(await headers())
  const jar = (await cookies()).toString()
  if (jar) requestHeaders.set('cookie', jar)
  else requestHeaders.delete('cookie')
  const auth = await getAuth()
  const result = await auth.api.getSession({ headers: requestHeaders })
  return result ? { userId: result.user.id } : null
})

// The signed-in, ACTIVE staff member and their hotel — or null. Read as that
// staff member, so row-level security decides exactly as it will for pages.
export const getSession = cache(async (): Promise<Session | null> => {
  const login = await currentLogin()
  if (!login) return null
  return withStaff(login.userId, loadStaffSession)
})

// Ends the current session (database row and cookie). Safe to call when
// there is no session.
export async function endCurrentSession(): Promise<void> {
  const requestHeaders = await headers()
  const auth = await getAuth()
  try {
    await auth.api.signOut({ headers: requestHeaders })
  } catch {
    // No session to end: nothing to do.
  }
}

// Roles that work with found items (logging, storing, returning).
export const ITEM_ROLES: StaffRole[] = ['housekeeping', 'front_office', 'manager']

// Where each role lands after sign-in or when a page isn't theirs.
export function homeFor(role: StaffRole) {
  return role === 'support' ? '/support' : '/items'
}

// For pages: redirect to /login when there is no active staff session, and to
// the role's own home when the page isn't for their role. This is a real
// server-side check; the database enforces the same rules again.
export async function requireSession(roles?: StaffRole[]): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (roles && !roles.includes(session.staff.role)) redirect(homeFor(session.staff.role))
  return session
}

export function canManageItems(role: StaffRole) {
  return role === 'front_office' || role === 'manager'
}
