// Data for the items dashboard (/items), read as the signed-in staff member:
// row-level security limits everything to their hotel, and every query also
// filters on property_id as a second guard. No Next.js imports, so tests can
// run it against a real database.
import type { Tx } from '@/lib/db/core'
import { DASHBOARD_VIEWS, getDashboardView, type DashboardCounts, type DashboardFilter } from '@/lib/item-dashboard'
import type { LostItem } from '@/lib/types'

export type DashboardRow = Pick<
  LostItem,
  'id' | 'item_code' | 'description' | 'category' | 'found_area_type' |
  'room_number' | 'area_label' | 'status' | 'value_tier' | 'dispose_after'
> & {
  /** Id of the earliest photo (shown via /api/photos/<id>); always null for sensitive items. */
  first_photo: string | null
}

export type DashboardQuery = {
  propertyId: string
  view: DashboardFilter
  /** Already cleaned: letters, digits and dashes only, at most 20 characters. */
  search: string
  page: number
  pageSize: number
  /** The hotel's today, 'YYYY-MM-DD'. */
  today: string
}

/** Only letters, digits and dashes; at most 20 characters. */
export function cleanSearch(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').trim().replace(/[^A-Za-z0-9-]/g, '').slice(0, 20)
}

export async function loadDashboard(tx: Tx, q: DashboardQuery): Promise<{ rows: DashboardRow[]; total: number; counts: DashboardCounts }> {
  const view = getDashboardView(q.view)
  const retention = view.id === 'retention'

  // $1 property, $2 statuses, $3 today (retention only), $4 search (optional)
  // Status lists are passed as one comma-separated string (portable to every
  // Postgres driver) and turned into an enum array in SQL.
  const params: unknown[] = [q.propertyId, view.statuses.join(','), retention ? q.today : null, q.search || null]
  const where = `i.property_id = $1
      and i.status = any(string_to_array($2::text, ',')::public.item_status[])
      and ($3::date is null or i.dispose_after < $3::date)
      and ($4::text is null or i.room_number = $4 or i.item_code ilike '%' || $4 || '%')`

  const total = (await tx.query<{ n: number }>(`select count(*)::int as n from public.lost_items i where ${where}`, params)).rows[0].n

  const order = retention ? 'i.dispose_after asc' : 'i.found_at desc'
  const rows = (
    await tx.query<DashboardRow>(
      `select i.id, i.item_code, i.description, i.category, i.found_area_type,
              i.room_number, i.area_label, i.status::text as status, i.value_tier::text as value_tier, i.dispose_after,
              case when i.value_tier = 'sensitive' then null else (
                select p.id from public.item_photos p
                 where p.item_id = i.id order by p.uploaded_at, p.id limit 1
              ) end as first_photo
         from public.lost_items i
        where ${where}
        order by ${order}, i.id asc
        limit $5 offset $6`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize]
    )
  ).rows

  // Summary counts for the whole hotel, independent of search and page: one
  // pass over the table, one FILTER per dashboard view.
  const countParams: unknown[] = [q.propertyId, q.today]
  const parts = DASHBOARD_VIEWS.map((v) => {
    countParams.push(v.statuses.join(','))
    const idx = countParams.length
    const extra = v.id === 'retention' ? ' and dispose_after < $2::date' : ''
    return `count(*) filter (where status = any(string_to_array($${idx}::text, ',')::public.item_status[])${extra})::int as "${v.id}"`
  })
  const counts = (
    await tx.query<DashboardCounts>(
      `select ${parts.join(',\n             ')} from public.lost_items where property_id = $1 and $2::date is not null`,
      countParams
    )
  ).rows[0]

  return { rows, total, counts }
}
