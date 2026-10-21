// Who is signed in, as the hotel database sees it. Runs inside withStaff(),
// so row-level security applies: auth.uid() is the Better Auth user id, and
// only an ACTIVE staff member gets a property back (public.current_property_id()).
// No Next.js imports, so tests can run it against a real database.
import type { Tx } from '@/lib/db/core'
import type { Property, Staff } from '@/lib/types'

export type Session = {
  staff: Staff
  property: Property
}

export async function loadStaffSession(tx: Tx): Promise<Session | null> {
  const staff = (
    await tx.query<Staff>(
      `select user_id, property_id, username, display_name, role::text as role, active
         from public.staff where user_id = auth.uid()`
    )
  ).rows[0]
  if (!staff || !staff.active) return null

  const property = (
    await tx.query<Property>(
      `select id, inn_code, name, retention_days, trace_window_days, stay_retention_days,
              check_due_hours, request_retention_days
         from public.properties where id = $1`,
      [staff.property_id]
    )
  ).rows[0]
  if (!property) return null

  return { staff, property }
}
