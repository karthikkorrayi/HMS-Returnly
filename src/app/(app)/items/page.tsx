import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { signPhotoUrls } from '@/lib/photo-urls'
import { hotelToday } from '@/lib/format'
import { CATEGORY_LABEL, type LostItem } from '@/lib/types'
import ItemDashboard from '@/components/ItemDashboard'
import {
  DASHBOARD_VIEWS,
  getDashboardView,
  type DashboardCounts,
  type DashboardItem,
} from '@/lib/item-dashboard'

const PAGE_SIZE = 12

type DatabaseItem = Pick<
  LostItem,
  'id' | 'item_code' | 'description' | 'category' | 'found_area_type' |
  'room_number' | 'area_label' | 'status' | 'value_tier' | 'dispose_after'
> & {
  item_photos: { storage_path: string; uploaded_at: string }[]
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; p?: string }>
}) {
  const { staff, property } = await requireSession()
  const params = await searchParams

  // Preserve links from the old item board.
  const requestedView = params.view === 'guest'
    ? 'return'
    : params.view === 'closed'
      ? 'closed'
      : params.view

  const selectedView = getDashboardView(requestedView)
  const q = (typeof params.q === 'string' ? params.q : '')
    .trim().replace(/[^A-Za-z0-9-]/g, '').slice(0, 20)

  const requestedPage = Number(params.p)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 10000)
    : 1

  const today = hotelToday()
  const supabase = await createClient()

  let query = supabase
    .from('lost_items')
    .select(
      'id, item_code, description, category, found_area_type, room_number, area_label, status, value_tier, dispose_after, item_photos(storage_path, uploaded_at)',
      { count: 'exact' }
    )
    .eq('property_id', property.id)
    .in('status', [...selectedView.statuses])
    .order(
      selectedView.id === 'retention' ? 'dispose_after' : 'found_at',
      { ascending: selectedView.id === 'retention' }
    )
    .order('id', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (selectedView.id === 'retention') query = query.lt('dispose_after', today)
  if (q) query = query.or(`room_number.eq.${q},item_code.ilike.%${q}%`)

  // Summary counts cover the whole hotel, independent of search/pagination.
  // RLS remains active; explicit property scoping is additional protection.
  const [listResult, summaryResults] = await Promise.all([
    query.returns<DatabaseItem[]>(),
    Promise.all(DASHBOARD_VIEWS.map(async (view) => {
      let countQuery = supabase
        .from('lost_items')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', property.id)
        .in('status', [...view.statuses])

      if (view.id === 'retention') {
        countQuery = countQuery.lt('dispose_after', today)
      }

      const result = await countQuery
      return {
        id: view.id,
        count: result.error ? null : result.count,
        failed: Boolean(result.error),
      }
    })),
  ])

  const total = listResult.error ? null : listResult.count
  const lastPage = total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!listResult.error && lastPage !== null && page > lastPage) {
    const next = new URLSearchParams({ view: selectedView.id })
    if (q) next.set('q', q)
    if (lastPage > 1) next.set('p', String(lastPage))
    redirect(`/items?${next.toString()}`)
  }

  const records = listResult.error ? [] : listResult.data ?? []
  const counts = Object.fromEntries(
    summaryResults.map(({ id, count }) => [id, count])
  ) as DashboardCounts

  function firstPhoto(item: DatabaseItem) {
    if (item.value_tier === 'sensitive') return undefined
    return [...(item.item_photos ?? [])]
      .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))[0]?.storage_path
  }

  let photoUrls: Record<string, string> = {}
  let photosFailed = false
  try {
    photoUrls = await signPhotoUrls(
      supabase,
      records.map(firstPhoto).filter((path): path is string => Boolean(path))
    )
  } catch {
    photosFailed = true
  }

  const retentionStatuses: readonly string[] =
    getDashboardView('retention').statuses

  const items: DashboardItem[] = records.map((item) => {
    const photo = firstPhoto(item)
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
  if (listResult.error) errors.push('Could not load items. Try refreshing the dashboard.')
  if (summaryResults.some((result) => result.failed)) {
    errors.push('Some summary counts are unavailable; they are shown as —.')
  }
  if (photosFailed) errors.push('Item photos could not be loaded.')

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
