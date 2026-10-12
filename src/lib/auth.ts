import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Property, Staff, StaffRole } from '@/lib/types'

// Staff sign in with a username. Supabase Auth needs an email, so each
// username maps to an address on a domain that never receives mail.
// Keep this in sync with scripts/create-staff.mjs.
export const STAFF_EMAIL_DOMAIN = process.env.STAFF_EMAIL_DOMAIN || 'staff.invalid'

export function usernameToEmail(username: string) {
  return `${username.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/

export type Session = {
  staff: Staff
  property: Property
}

// The signed-in, active staff member and their hotel — or null.
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: staff } = await supabase
    .from('staff')
    .select('user_id, property_id, username, display_name, role, active')
    .eq('user_id', user.id)
    .maybeSingle<Staff>()
  if (!staff || !staff.active) return null

  const { data: property } = await supabase
    .from('properties')
    .select('id, inn_code, name, retention_days, trace_window_days, stay_retention_days, check_due_hours, request_retention_days')
    .eq('id', staff.property_id)
    .single<Property>()
  if (!property) return null

  return { staff, property }
})

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
