import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/format'
import { CATEGORY_LABEL } from '@/lib/types'
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABEL,
  type CustomerRequest,
  type MatchBand,
  type MatchRow,
  type RequestStatus,
} from '@/lib/requests/types'
import { MatchBandBadge, RequestStatusBadge } from '@/components/RequestBadges'

const PAGE_SIZE = 20

type Row = Pick<
  CustomerRequest,
  'id' | 'reference' | 'customer_name' | 'booking_ref' | 'item_name' | 'category' | 'status' | 'assigned_to' | 'created_at'
>

export type ListParams = { status?: string; q?: string; assigned?: string; p?: string }

// Server component shared by Customer requests (Admin) and Support requests.
// Row-level security already limits Support to requests assigned to them.
export default async function RequestList({
  basePath,
  params,
  names,
  meId,
  showAssigneeFilter,
}: {
  basePath: '/requests' | '/support'
  params: ListParams
  names: Record<string, string>
  meId: string
  showAssigneeFilter: boolean
}) {
  const status = params.status === 'all' || REQUEST_STATUSES.includes(params.status as RequestStatus)
    ? (params.status as RequestStatus | 'all')
    : 'open'
  const q = (params.q ?? '').replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 40)
  const assigned = ['me', 'unassigned'].includes(params.assigned ?? '') ? params.assigned : 'any'
  const page = Math.max(1, Math.min(500, Number.parseInt(params.p ?? '1', 10) || 1))

  const supabase = await createClient()

  // Summary counts across everything this user can see.
  const { data: all } = await supabase.from('customer_requests').select('status').limit(10000)
  const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>
  for (const r of (all ?? []) as { status: RequestStatus }[]) counts[r.status]++
  const total = (all ?? []).length
  const openCount = OPEN_REQUEST_STATUSES.reduce((n, s) => n + counts[s], 0)

  let query = supabase
    .from('customer_requests')
    .select('id, reference, customer_name, booking_ref, item_name, category, status, assigned_to, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (status === 'open') query = query.in('status', OPEN_REQUEST_STATUSES)
  else if (status !== 'all') query = query.eq('status', status)
  if (assigned === 'me') query = query.eq('assigned_to', meId)
  if (assigned === 'unassigned') query = query.is('assigned_to', null)
  if (q) {
    const like = `*${q}*`
    query = query.or(`reference.ilike.${like},customer_name.ilike.${like},booking_ref.ilike.${like},item_name.ilike.${like}`)
  }
  const { data, error, count } = await query
  const rows = (data ?? []) as Row[]
  const lastPage = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  // Best match per open request on this page — an indicator only.
  const best: Record<string, MatchBand | null> = {}
  await Promise.all(
    rows
      .filter((r) => OPEN_REQUEST_STATUSES.includes(r.status))
      .map(async (r) => {
        const { data: m } = await supabase.rpc('match_request_items', { p_request_id: r.id })
        best[r.id] = ((m ?? []) as MatchRow[])[0]?.band ?? null
      })
  )

  const href = (over: Partial<ListParams>) => {
    const sp = new URLSearchParams()
    const merged = { status, q, assigned, ...over }
    if (merged.status && merged.status !== 'open') sp.set('status', merged.status)
    if (merged.q) sp.set('q', merged.q)
    if (merged.assigned && merged.assigned !== 'any') sp.set('assigned', merged.assigned)
    if (over.p && over.p !== '1') sp.set('p', over.p)
    const s = sp.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  const chips: { key: string; label: string; n: number }[] = [
    { key: 'open', label: 'Open', n: openCount },
    ...REQUEST_STATUSES.map((s) => ({ key: s, label: REQUEST_STATUS_LABEL[s], n: counts[s] })),
    { key: 'all', label: 'All', n: total },
  ]

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {[
          { label: 'Open', n: openCount },
          { label: REQUEST_STATUS_LABEL.pending_review, n: counts.pending_review },
          { label: REQUEST_STATUS_LABEL.awaiting_admin, n: counts.awaiting_admin },
          { label: REQUEST_STATUS_LABEL.awaiting_customer, n: counts.awaiting_customer },
          { label: 'Total', n: total },
        ].map((t) => (
          <div key={t.label} className="panel p-3">
            <dt className="text-sm text-muted">{t.label}</dt>
            <dd className="text-2xl font-bold">{t.n}</dd>
          </div>
        ))}
      </dl>

      <form role="search" className="flex flex-wrap items-end gap-2">
        {status !== 'open' && <input type="hidden" name="status" value={status} />}
        <div className="min-w-0 flex-1">
          <label htmlFor="req-q" className="label">Search</label>
          <input id="req-q" name="q" defaultValue={q} className="field" placeholder="Reference, customer, booking ID or item" />
        </div>
        {showAssigneeFilter && (
          <div>
            <label htmlFor="req-assigned" className="label">Assigned</label>
            <select id="req-assigned" name="assigned" defaultValue={assigned} className="field">
              <option value="any">Anyone</option>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        )}
        <button className="btn btn-secondary">Apply</button>
      </form>

      <nav aria-label="Filter by status" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={href({ status: c.key })}
                aria-current={status === c.key ? 'page' : undefined}
                className={`inline-flex whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                  status === c.key ? 'bg-ink text-white' : 'border border-line bg-surface'
                }`}
              >
                {c.label} ({c.n})
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">Could not load requests: {error.message}</p>
      )}

      {!error && rows.length === 0 && (
        <div className="panel p-8 text-center">
          <p className="font-semibold">{q ? `No requests match “${q}”.` : 'No requests here.'}</p>
          {basePath === '/support' && !q && (
            <p className="hint mt-1">Requests appear here when an admin assigns them to you.</p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="panel divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`} className="grid gap-2 p-4 hover:bg-paper sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{r.reference}</span>
                    <RequestStatusBadge status={r.status} />
                    {best[r.id] && <MatchBandBadge band={best[r.id]!} />}
                  </p>
                  <p className="mt-1 truncate">
                    {r.item_name}
                    {r.category ? <span className="text-muted"> · {CATEGORY_LABEL[r.category]}</span> : null}
                  </p>
                  <p className="hint truncate">
                    {r.customer_name} · Booking {r.booking_ref} · {formatDateTime(r.created_at)}
                  </p>
                </div>
                <p className="text-sm text-muted sm:text-right">
                  {r.assigned_to ? `Assigned: ${r.assigned_to === meId ? 'you' : names[r.assigned_to] ?? 'staff'}` : 'Unassigned'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between">
          {page > 1 ? <Link className="btn btn-secondary" href={href({ p: String(page - 1) })}>Previous</Link> : <span />}
          <span className="hint">Page {page} of {lastPage}</span>
          {page < lastPage ? <Link className="btn btn-secondary" href={href({ p: String(page + 1) })}>Next</Link> : <span />}
        </nav>
      )}
    </div>
  )
}
