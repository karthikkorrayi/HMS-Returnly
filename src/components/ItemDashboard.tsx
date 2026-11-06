'use client'

import type { ActionGroup } from '@/lib/action-groups'
import { Modal } from '@/components/workspace/Modal'
import MetricDetails from '@/components/workspace/MetricDetails'
import { CATEGORIES, type ValueTier } from '@/lib/types'
import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReturnlyIcon from './ReturnlyIcon'
import { StatusBadge, TierBadge } from './Badges'
import { useStaffPath } from './StaffHotel'
import type { StaffRole } from '@/lib/types'
import {
  DASHBOARD_VIEWS,
  DASHBOARD_SUMMARIES,
  dashboardGuidance,
  matchesDashboardFilter,
  type DashboardCounts,
  type DashboardFilter,
  type DashboardItem,
} from '@/lib/item-dashboard'

type Props = {
  groups?: ActionGroup[]
  mode: 'preview' | 'live'
  items: DashboardItem[]
  counts: DashboardCounts
  role?: StaffRole
  view?: DashboardFilter
  search?: string
  page?: number
  pageSize?: number
  total?: number | null
  error?: string | null
  category?: string
  tier?: string
}

export default function ItemDashboard({
  mode,
  items,
  counts,
  role = 'manager',
  view = 'open',
  search = '',
  page = 1,
  pageSize = 12,
  total = null,
  error = null,
  groups = [],
  category = '',
  tier = '',
}: Props) {
  const uid = useId()
  const preview = mode === 'preview'
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const to = useStaffPath()
  const [localView, setLocalView] = useState<DashboardFilter>('open')
  const [query, setQuery] = useState(search)
  const [metric, setMetric] = useState<DashboardFilter | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const activeView = preview ? localView : view
  const normalizedQuery = query.trim().toLowerCase()
  const visible = preview
    ? items.filter(
        (item) =>
          matchesDashboardFilter(item, activeView) &&
          `${item.code} ${item.description} ${item.location} ${item.category}`
            .toLowerCase()
            .includes(normalizedQuery),
      )
    : items

  const selected = visible.find((item) => item.id === selectedId) ?? visible[0]
  const filterLabel = DASHBOARD_VIEWS.find(
    (entry) => entry.id === activeView,
  )?.label
  const lastPage =
    total === null ? null : Math.max(1, Math.ceil(total / pageSize))
  const start = visible.length > 0 ? (page - 1) * pageSize + 1 : 0
  const end = visible.length > 0 ? start + visible.length - 1 : 0

  function chooseFilter(filter: DashboardFilter) {
    setLocalView(filter)
    setSelectedId(null)
  }

  function href(filter: DashboardFilter, targetPage = 1) {
    return {
      pathname: to('/items'),
      query: {
        view: filter,
        ...(category ? { category } : {}),
        ...(tier ? { tier } : {}),
        ...(search ? { q: search } : {}),
        ...(targetPage > 1 ? { p: String(targetPage) } : {}),
      },
    }
  }

  return (
    <section
      id={preview ? 'workspace-preview' : 'hotel-dashboard'}
      aria-labelledby={`${uid}-dashboard-title`}
      className={preview ? 'scroll-mt-6 pt-10' : ''}
    >
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">
            {preview ? 'A calmer shift starts here' : 'Your shift, organised'}
          </p>
          <h2
            id={`${uid}-dashboard-title`}
            className="text-2xl font-bold tracking-tight"
          >
            {preview
              ? 'Your lost & found, at a glance'
              : 'Your hotel, at a glance'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="preview-label">
            <span className="size-1.5 rounded-full bg-teal" />
            {preview
              ? 'Interactive preview · Sample data'
              : 'Staff workspace · Hotel data'}
          </span>
          {!preview && (
            <button
              type="button"
              disabled={pending}
              className="btn btn-secondary !min-h-9 !text-xs"
              onClick={() => startTransition(() => router.refresh())}
            >
              {pending ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      <p className="mb-5 text-sm text-muted">
        {preview
          ? 'Explore fictional items. Select a summary or filter, then choose an item to see its next step.'
          : 'Open a metric for its details. Use the independent action board below to filter records and take action.'}
      </p>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-danger bg-danger-soft p-4 text-sm text-danger"
        >
          {error}
        </div>
      )}

      <div className="metric-selection"><h3 className="font-bold mb-3">Metrics selection</h3><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {DASHBOARD_SUMMARIES.map((card) => {
          const content = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-muted">
                  {card.label}
                </span>
                <span className={`summary-icon summary-icon-${card.tone}`}>
                  <ReturnlyIcon name={card.icon} />
                </span>
              </span>
              <span className="mt-3 block text-3xl font-bold tracking-tight">
                {counts[card.id] ?? '—'}{' '}
                <span className="text-xs font-normal tracking-normal text-muted">
                  {preview ? 'sample items' : 'items'}
                </span>
              </span>
              <span className="mt-2 flex items-center justify-between text-xs text-muted">
                {card.note}
                <ReturnlyIcon name="arrow" className="!size-4" />
              </span>
            </>
          )
          const className = `summary-card ${activeView === card.id ? 'summary-card-active' : ''}`

          return <button key={card.id} type="button" className={className} aria-haspopup="dialog" onClick={() => setMetric(card.id)}>{content}</button>

        })}
      </div>

      </div>
      <Modal open={metric !== null} title={DASHBOARD_SUMMARIES.find((c) => c.id === metric)?.label ?? 'Metric details'} onClose={() => setMetric(null)}>
        {metric && (preview ? <div><p className="hint">Sample data only.</p><p className="metric-total">{counts[metric] ?? '—'}</p><ul>{items.filter((i) => matchesDashboardFilter(i,metric)).map((i) => <li key={i.id} className="py-2">{i.description} · {i.location}</li>)}</ul></div> : <MetricDetails key={metric} metric={metric}/>)}
      </Modal>
      {!preview && <section className="group-overview mt-6" aria-label="Action groups"><header><div><h3 className="font-bold">Action groups</h3><p className="hint">Shared work columns, independent of item status.</p></div><Link href={to('/items/organise')} className="btn btn-secondary">Manage groups</Link></header><div className="group-overview-columns">{groups.map((g)=><Link key={g.id} href={{pathname:to('/items/organise'),query:{group:g.id}}} className="group-overview-card"><strong>{g.title}</strong><span>{g.count} items</span><small>Open column →</small></Link>)}</div></section>}
      <div
        className={`mt-6 grid items-start gap-5 dashboard-board-stack ${pending ? 'opacity-70' : ''}`}
        aria-busy={pending}
      >
        <div className="panel action-board min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <h3 className="font-bold">The action board</h3>

            {preview ? (
              <div className="relative w-full sm:w-64">
                <label htmlFor={`${uid}-dashboard-search`} className="sr-only">
                  Search sample items
                </label>
                <ReturnlyIcon
                  name="search"
                  className="absolute left-3 top-3 !size-4 text-muted"
                />
                <input
                  id={`${uid}-dashboard-search`}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="field !min-h-10 !py-2 pl-9 !text-sm"
                  placeholder="Search item, room or code"
                />
              </div>
            ) : (
              <form
                action={to('/items')}
                method="get"
                role="search"
                className="filter-toolbar item-search-form"
              >
                <input type="hidden" name="view" value={activeView} />
                <label htmlFor={`${uid}-dashboard-search`} className="sr-only">
                  Room or item code
                </label>
                <input
                  id={`${uid}-dashboard-search`}
                  type="search"
                  name="q"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="field !min-h-10 !text-sm sm:w-52"
                  placeholder="Room or item code"
                  maxLength={20}
                />
                <label className="sr-only" htmlFor={`${uid}-item-category`}>Category</label>
                <select id={`${uid}-item-category`} name="category" defaultValue={category} className="field !min-h-10 !text-sm"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                <label className="sr-only" htmlFor={`${uid}-item-tier`}>Value tier</label>
                <select id={`${uid}-item-tier`} name="tier" defaultValue={tier} className="field !min-h-10 !text-sm"><option value="">All value tiers</option>{(['standard','valuable','sensitive'] as ValueTier[]).map((v) => <option key={v}>{v}</option>)}</select>
                <button className="btn btn-secondary !min-h-10 !text-sm">
                  Find
                </button>
              </form>
            )}
          </div>

          <div
            className="overflow-x-auto px-5 pb-4 pt-4"
            role="group"
            aria-label="Filter items"
          >
            <div className="flex w-max gap-2">
              {DASHBOARD_VIEWS.map(({ id, label }) => {
                const content = (
                  <>
                    {label}{' '}
                    <span className="ml-2 opacity-70">{counts[id] ?? '—'}</span>
                  </>
                )
                const className = `preview-filter ${activeView === id ? 'preview-filter-active' : ''}`
                return preview ? (
                  <button
                    key={id}
                    type="button"
                    className={className}
                    onClick={() => chooseFilter(id)}
                    aria-pressed={activeView === id}
                    aria-controls={`${uid}-dashboard-items`}
                  >
                    {content}
                  </button>
                ) : (
                  <Link
                    key={id}
                    href={href(id)}
                    className={className}
                    aria-current={activeView === id ? 'page' : undefined}
                  >
                    {content}
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-y border-line bg-paper px-5 py-2 text-xs text-muted">
            <span>
              {preview ? 'Sample item / Found in' : 'Item / Found in'}
            </span>
            <span>Select for next step</span>
          </div>

          <ul id={`${uid}-dashboard-items`} className="divide-y divide-line">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`preview-row ${selected?.id === item.id ? 'preview-row-selected' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={selected?.id === item.id}
                  aria-controls={`${uid}-dashboard-next-step`}
                >
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl ${
                      item.tier === 'sensitive'
                        ? 'bg-attention-soft text-attention'
                        : 'bg-paper text-teal'
                    }`}
                  >
                    {item.photoUrl && item.tier !== 'sensitive' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Private, short-lived signed URLs.
                      <img
                        src={item.photoUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ReturnlyIcon
                        name={item.tier === 'sensitive' ? 'shield' : 'tag'}
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold">
                      {item.description}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {item.location} · {item.code}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1 sm:hidden">
                      <StatusBadge status={item.status} />
                      {item.retention && (
                        <span className="badge bg-attention-soft text-attention">
                          Past retention
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="hidden flex-col items-end gap-1 sm:flex">
                    <StatusBadge status={item.status} />
                    {item.retention && (
                      <span className="badge bg-attention-soft text-attention">
                        Past retention
                      </span>
                    )}
                  </span>
                  <ReturnlyIcon name="arrow" className="!size-4 text-muted" />
                </button>
              </li>
            ))}
          </ul>

          {!error && visible.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="font-semibold">
                {preview
                  ? 'No sample items match.'
                  : search
                    ? 'No items match this search.'
                    : 'No items in this view yet.'}
              </p>
              <p className="mt-2 text-sm text-muted">
                {preview
                  ? 'Try another search or reset the board.'
                  : 'Choose another filter, clear the search, or log a found item.'}
              </p>
              {preview ? (
                <button
                  type="button"
                  className="btn btn-secondary mt-4"
                  onClick={() => {
                    setQuery('')
                    chooseFilter('open')
                  }}
                >
                  Reset filters
                </button>
              ) : (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link href={to('/items')} className="btn btn-secondary">
                    Reset filters
                  </Link>
                  <Link href={to('/items/new')} className="btn btn-primary">
                    Log an item
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p
              aria-live="polite"
              aria-atomic="true"
              className="text-xs text-muted"
            >
              {preview
                ? `Showing ${visible.length} sample items in ${filterLabel?.toLowerCase()}.`
                : total === null
                  ? 'Item totals are unavailable.'
                  : visible.length > 0
                    ? `Showing ${start}–${end} of ${total} matching items.`
                    : `Showing 0 of ${total} matching items.`}
            </p>
            {!preview && lastPage !== null && lastPage > 1 && (
              <nav
                aria-label="Item pages"
                className="flex items-center gap-3 text-xs font-semibold"
              >
                {page > 1 && (
                  <Link href={href(activeView, page - 1)} className="text-teal">
                    Previous
                  </Link>
                )}
                <span>
                  Page {page} of {lastPage}
                </span>
                {page < lastPage && (
                  <Link href={href(activeView, page + 1)} className="text-teal">
                    Next
                  </Link>
                )}
              </nav>
            )}
          </div>
        </div>

        <aside
          className="space-y-4"
          aria-label="Item guidance and quick actions"
        >
          <section
            id={`${uid}-dashboard-next-step`}
            className="panel p-5"
            aria-labelledby={`${uid}-next-step-title`}
          >
            <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal">
              <ReturnlyIcon name="grid" className="!size-4" />
              {preview ? 'Preview / Next step' : 'Next step'}
            </p>
            <div aria-live="polite" aria-atomic="true">
              <h3 id={`${uid}-next-step-title`} className="text-lg font-bold">
                {selected ? selected.description : 'Choose an item'}
              </h3>
              {selected ? (
                <>
                  <p className="mb-3 mt-1 text-xs text-muted">
                    {selected.code} · {selected.location}
                  </p>
                  <TierBadge tier={selected.tier} />
                  <p className="mt-4 text-sm leading-relaxed text-muted">
                    {dashboardGuidance(selected, role)}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Choose another filter or clear your search to see items.
                </p>
              )}
            </div>
            {preview ? (
              <Link
                href="/login"
                className="btn btn-secondary mt-5 w-full text-sm"
              >
                Sign in to manage items{' '}
                <ReturnlyIcon name="arrow" className="!size-4" />
              </Link>
            ) : selected ? (
              <Link
                href={to(`/items/${selected.id}`)}
                className="btn btn-primary mt-5 w-full text-sm"
              >
                Open item record{' '}
                <ReturnlyIcon name="arrow" className="!size-4" />
              </Link>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  )
}
