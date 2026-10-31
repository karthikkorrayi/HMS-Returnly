// What each role can do, shown read-only on the Staff page. This is a
// description for people: the rules themselves are enforced by the database
// (row-level security and the workflow functions in db/migrations), so
// changing this list changes no permission. Keep it in step with them.
import type { StaffRole } from '@/lib/types'

export const ROLE_ORDER: StaffRole[] = ['housekeeping', 'front_office', 'support', 'manager']

export const ROLE_PERMISSIONS: { what: string; roles: StaffRole[]; note?: string }[] = [
  { what: 'Log found items, add photos, put items in storage', roles: ['housekeeping', 'front_office', 'manager'] },
  { what: 'Match items to guests, contact guests, arrange collection or posting, hand items over', roles: ['front_office', 'manager'] },
  { what: 'Change how valuable an item is', roles: ['front_office', 'manager'] },
  { what: 'Answer customer enquiries', roles: ['support', 'manager'], note: 'Support: only enquiries assigned to them' },
  { what: 'Assign and approve enquiries', roles: ['manager'] },
  { what: 'Dispose of or donate unclaimed items, delete photos', roles: ['manager'] },
  { what: 'Staff, roles and passwords', roles: ['manager'] },
  { what: 'Hotel details, rooms, areas, storage places, retention', roles: ['manager'] },
]
