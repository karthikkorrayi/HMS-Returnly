// The guest contact record (migration 024): one row per email per hotel,
// kept while the hotel holds a report from that address. Managers only; the
// database's row-level security decides who sees what. Opening the list is
// logged (Settings → Access log). No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'

export type GuestContact = {
  email: string
  first_seen_at: string
  last_seen_at: string
  reports_submitted: number
  reports_on_file: number
}
export type ContactViewRow = { id: number; created_at: string; staff_name: string }

export const CONTACTS_LIMIT = 500

/** The most recently seen contacts first. */
export async function loadGuestContacts(tx: Tx, limit = CONTACTS_LIMIT): Promise<GuestContact[]> {
  const { rows } = await tx.query<GuestContact>(
    `select c.email, c.first_seen_at, c.last_seen_at, c.reports_submitted,
            (select count(*)::int from public.customer_requests r
              where r.property_id = c.property_id and r.customer_email = c.email) as reports_on_file
       from public.guest_contacts c
      order by c.last_seen_at desc, c.email
      limit $1`,
    [Math.min(Math.max(limit, 1), CONTACTS_LIMIT)]
  )
  return rows
}

export async function countGuestContacts(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from public.guest_contacts`)
  return rows[0]?.n ?? 0
}

/** Records that this manager opened the list (at most once per 10 minutes). */
export async function logContactsView(tx: Tx): Promise<void> {
  await tx.rpc('log_contacts_view', {})
}

export async function loadContactViews(tx: Tx, limit = 50): Promise<ContactViewRow[]> {
  const { rows } = await tx.query<ContactViewRow>(
    `select v.id::float8 as id, v.created_at, coalesce(s.display_name, 'Former staff') as staff_name
       from public.guest_contact_views v left join public.staff s on s.user_id = v.staff_id
      order by v.id desc limit $1`,
    [Math.min(Math.max(limit, 1), 200)]
  )
  return rows
}
