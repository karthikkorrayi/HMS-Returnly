import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { signPhotoUrls } from '@/lib/photo-urls'
import { formatDateTime, hotelToday } from '@/lib/format'
import { CATEGORY_LABEL, type ItemStatus, type LostItem } from '@/lib/types'
import { StatusBadge, TierBadge } from '@/components/Badges'

const VIEWS = {
  open: { label: 'In hand', statuses: ['logged', 'stored', 'matched', 'guest_contacted'] },
  guest: { label: 'With guest', statuses: ['awaiting_collection', 'awaiting_shipping'] },
  retention: { label: 'Past retention', statuses: ['stored', 'matched', 'guest_contacted'] },
  closed: { label: 'Closed', statuses: ['returned', 'disposed', 'donated'] },
} satisfies Record<string, { label: string; statuses: ItemStatus[] }>
type View = keyof typeof VIEWS

type BoardItem = Pick<
  LostItem,
  'id' | 'item_code' | 'found_area_type' | 'room_number' | 'area_label' | 'found_at' | 'category' | 'description' | 'value_tier' | 'status' | 'dispose_after'
> & { item_photos: { storage_path: string; uploaded_at: string }[] }

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>
}) {
  await requireSession()
  const params = await searchParams
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : 'open'
  const q = (params.q ?? '').trim().replace(/[^A-Za-z0-9-]/g, '').slice(0, 20)
  const today = hotelToday()

  const supabase = await createClient()
  let query = supabase
    .from('lost_items')
    .select(
      'id, item_code, found_area_type, room_number, area_label, found_at, category, description, value_tier, status, dispose_after, item_photos(storage_path, uploaded_at)'
    )
    .in('status', VIEWS[view].statuses)
    .order('found_at', { ascending: view === 'retention' })
    .limit(view === 'closed' ? 60 : 200)

  if (view === 'retention') query = query.lt('dispose_after', today)
  if (q) query = query.or(`room_number.eq.${q},item_code.ilike.%${q}%`)

  const { data, error } = await query.returns<BoardItem[]>()
  const items = data ?? []

  const firstPhoto = (i: BoardItem) =>
    [...i.item_photos].sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))[0]?.storage_path
  const urls = await signPhotoUrls(
    supabase,
    items.map(firstPhoto).filter((p): p is string => Boolean(p))
  )

  // Count how many open items are past retention, to surface the tab.
  const { count: overdue } = await supabase
    .from('lost_items')
    .select('id', { count: 'exact', head: true })
    .in('status', VIEWS.retention.statuses)
    .lt('dispose_after', today)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Items</h1>
        <form className="flex w-full gap-2 sm:w-auto" role="search">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="q" className="sr-only">Room or item code</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Room or item code"
            className="field sm:w-56"
            inputMode="text"
            autoCapitalize="characters"
          />
          <button className="btn btn-secondary">Find</button>
        </form>
      </div>

      <nav aria-label="Filter items" className="-mx-4 mt-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <li key={v}>
              <Link
                href={{ pathname: '/items', query: { view: v, ...(q ? { q } : {}) } }}
                aria-current={v === view ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                  v === view ? 'bg-ink text-white' : 'bg-surface text-ink border border-line'
                }`}
              >
                {VIEWS[v].label}
                {v === 'retention' && (overdue ?? 0) > 0 && (
                  <span className="rounded-full bg-attention px-1.5 text-xs text-white">{overdue}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-danger-soft px-3 py-2 text-danger">
          Could not load items: {error.message}
        </p>
      )}

      {!error && items.length === 0 && (
        <div className="panel mt-6 p-8 text-center">
          <p className="font-semibold">
            {q ? `Nothing matches “${q}” here.` : view === 'retention' ? 'Nothing is past its retention date.' : 'No items here yet.'}
          </p>
          {view === 'open' && !q && (
            <Link href="/items/new" className="btn btn-primary mt-4">Log an item</Link>
          )}
        </div>
      )}

      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const photo = firstPhoto(item)
          const where = item.found_area_type === 'room' ? `Room ${item.room_number}` : item.area_label
          return (
            <li key={item.id}>
              <Link href={`/items/${item.id}`} className="panel block overflow-hidden hover:border-teal">
                <div className="relative aspect-[4/3] bg-paper">
                  {photo && urls[photo] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs, not optimisable
                    <img src={urls[photo]} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted">
                      {item.value_tier === 'sensitive' ? 'No photo — sensitive item' : CATEGORY_LABEL[item.category]}
                    </div>
                  )}
                  <span className="tag absolute left-2 top-2 text-[0.7rem]">{item.item_code}</span>
                </div>
                <div className="space-y-1.5 p-3">
                  <p className="line-clamp-1 font-semibold">{item.description}</p>
                  <p className="text-sm text-muted">
                    {where} · {formatDateTime(item.found_at)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={item.status} />
                    <TierBadge tier={item.value_tier} />
                  </div>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
