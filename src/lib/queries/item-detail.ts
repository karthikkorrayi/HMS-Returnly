// Everything the item page (/items/[id]) shows, read in one transaction as the
// signed-in staff member, so row-level security decides exactly what they see
// (another hotel's item simply does not exist for them). No Next.js imports,
// so tests can run it against a real database.
import type { Tx } from '@/lib/db/core'
import type { CustodyEvent, GuestCandidate, Handover, LostItem, Staff, StorageLocation } from '@/lib/types'

export type ItemPhoto = { id: string; storage_path: string; uploaded_by: string; uploaded_at: string }

export type ItemDetail = {
  item: LostItem
  photos: ItemPhoto[]
  candidates: GuestCandidate[]
  events: CustodyEvent[]
  handover: Handover | null
  locations: StorageLocation[]
  staff: Staff[]
}

export const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** null when the id is malformed or the item is not visible to this staff member. */
export async function loadItemDetail(tx: Tx, itemId: string, opts: { withCandidates: boolean }): Promise<ItemDetail | null> {
  if (!ITEM_ID.test(itemId)) return null
  const item = (
    await tx.query<LostItem>(
      `select id, property_id, item_code, found_area_type, room_number, area_label, found_at, found_by,
              category, description, brand, colour, value_tier::text as value_tier, status::text as status,
              storage_location_id, dispose_after, created_at, room_check_id, found_spot, spot_hidden
         from public.lost_items where id = $1`,
      [itemId]
    )
  ).rows[0]
  if (!item) return null

  const photos = (
    await tx.query<ItemPhoto>(
      `select id, storage_path, uploaded_by, uploaded_at from public.item_photos
        where item_id = $1 order by uploaded_at, id`,
      [itemId]
    )
  ).rows

  const candidates = opts.withCandidates
    ? (
        await tx.query<GuestCandidate>(
          `select id, item_id, reservation_ref, departure_date, added_by, added_at, confirmed,
                  confirmed_by, confirmed_at, note
             from public.guest_candidates where item_id = $1 order by added_at, id`,
          [itemId]
        )
      ).rows
    : []

  // id is a bigint identity; float8 keeps it a JavaScript number (exact far
  // beyond any realistic number of history entries).
  const events = (
    await tx.query<CustodyEvent>(
      `select id::float8 as id, from_status::text as from_status, to_status::text as to_status,
              storage_location_id, actor, note, created_at
         from public.custody_events where item_id = $1 order by id desc`,
      [itemId]
    )
  ).rows

  const handover =
    (
      await tx.query<Handover>(
        `select method::text as method, id_checked, courier_tracking, handed_over_by, witness, note, handed_over_at
           from public.handovers where item_id = $1`,
        [itemId]
      )
    ).rows[0] ?? null

  const locations = (
    await tx.query<StorageLocation>(`select id, label, is_secure, active from public.storage_locations order by label`)
  ).rows

  const staff = (
    await tx.query<Staff>(
      `select user_id, property_id, username, display_name, role::text as role, active
         from public.staff order by display_name`
    )
  ).rows

  return { item, photos, candidates, events, handover, locations, staff }
}
