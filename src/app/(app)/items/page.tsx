import { redirect } from 'next/navigation'
import { ITEM_ROLES, requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { hotelToday } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/types'
import ItemDashboard from '@/components/ItemDashboard'
import { getDashboardView, type DashboardCounts, type DashboardItem } from '@/lib/item-dashboard'
import { cleanSearch, loadDashboard } from '@/lib/queries/item-dashboard'

const PAGE_SIZE = 12

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; p?: string }>
}) {
  const { staff, property } = await requireSession(ITEM_ROLES)
  const params = await searchParams

  // Preserve links from the old item board.
  const requestedView = params.view === 'guest'
    ? 'return'
    : params.view === 'closed'
      ? 'closed'
      : params.view

  const selectedView = getDashboardView(requestedView)
  const q = cleanSearch(params.q)

  const requestedPage = Number(params.p)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 10000)
    : 1

  const today = hotelToday()

  // One transaction as this staff member: row-level security limits it to
  // their hotel, and the queries filter on property_id as well.
  let result: Awaited<ReturnType<typeof loadDashboard>> | null = null
  try {
    result = await withStaff(staff.user_id, (tx) =>
      loadDashboard(tx, { propertyId: property.id, view: selectedView.id, search: q, page, pageSize: PAGE_SIZE, today })
    )
  } catch (e) {
    console.error('items dashboard', e)
  }

  const total = result ? result.total : null
  const lastPage = total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (lastPage !== null && page > lastPage) {
    const next = new URLSearchParams({ view: selectedView.id })
    if (q) next.set('q', q)
    if (lastPage > 1) next.set('p', String(lastPage))
    redirect(`/items?${next.toString()}`)
  }

  const records = result?.rows ?? []
  const counts: DashboardCounts = result?.counts ?? { open: null, storage: null, return: null, retention: null, closed: null }

  // Photos move from Supabase Storage to the new photo store in Phase 5;
  // until then the dashboard shows the category icon instead of a thumbnail.
  const photoUrls: Record<string, string> = {}

  const retentionStatuses: readonly string[] =
    getDashboardView('retention').statuses

  const items: DashboardItem[] = records.map((item) => {
    const photo = item.first_photo
    return {
      id: item.id,
      code: item.item_code,
      description: item.description,
      category: CATEGORY_LABEL[item.category] ?? item.category,
      location: item.found_area_type === 'room'
        ? `Room ${item.room_number}`
        : item.area_label ?? 'Public area',
      status: item.status,
      tier: item.value_tier,
      retention: retentionStatuses.includes(item.status) &&
        item.dispose_after < today,
      photoUrl: photo ? photoUrls[photo] : undefined,
    }
  })

  const errors: string[] = []
  if (!result) errors.push('Could not load items. Try refreshing the dashboard. Summary counts are shown as —.')

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-sm text-muted">{property.name}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome back, {staff.display_name}.
          </h1>
          <p className="mt-2 text-sm text-muted">
            Keep found belongings safe and help them find their way home.
          </p>
        </div>
      </div>

      <ItemDashboard
        key={`${selectedView.id}:${q}:${page}`}
        mode="live"
        items={items}
        counts={counts}
        role={staff.role}
        view={selectedView.id}
        search={q}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        error={errors.length ? errors.join(' ') : null}
      />
    </div>
  )
}
