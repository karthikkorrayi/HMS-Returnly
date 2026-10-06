import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/format'
import { ROOM_STATUS_LABEL, type RoomBoardRow, type RoomStatus } from '@/lib/types'
import RoomStatusBadge from '@/components/RoomStatusBadge'

const FILTERS = {
  todo: { label: 'To check', statuses: ['check_overdue', 'needs_check'] as RoomStatus[] },
  due: { label: 'Due out', statuses: ['due_out'] as RoomStatus[] },
  all: { label: 'All rooms', statuses: null },
}
type Filter = keyof typeof FILTERS

// Overdue first, then the rest in the order housekeeping works them.
const ORDER: Record<RoomStatus, number> = { check_overdue: 0, needs_check: 1, due_out: 2, occupied: 3, ready: 4 }

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { property } = await requireSession()
  const params = await searchParams
  const filter: Filter = params.show && params.show in FILTERS ? (params.show as Filter) : 'todo'

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('room_board')
  const all = (data ?? []) as RoomBoardRow[]

  const counts = Object.fromEntries(
    (Object.keys(ROOM_STATUS_LABEL) as RoomStatus[]).map((s) => [s, all.filter((r) => r.status === s).length])
  ) as Record<RoomStatus, number>

  const shown = FILTERS[filter].statuses
    ? all.filter((r) => FILTERS[filter].statuses!.includes(r.status))
    : all
  const sorted = [...shown].sort((a, b) =>
    filter === 'all'
      ? a.room_number.localeCompare(b.room_number, 'en', { numeric: true })
      : ORDER[a.status] - ORDER[b.status] || a.room_number.localeCompare(b.room_number, 'en', { numeric: true })
  )
  const floors = filter === 'all'
    ? [...new Set(sorted.map((r) => r.floor ?? '—'))]
    : [null]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Rooms</h1>
        <p className="hint mt-1">
          Check every room after a guest leaves, even when nothing is there. A missed check is flagged after{' '}
          {property.check_due_hours} hour{property.check_due_hours === 1 ? '' : 's'}.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['check_overdue', 'needs_check', 'due_out', 'ready'] as RoomStatus[]).map((s) => (
          <div key={s} className="panel p-3">
            <dt className="text-sm text-muted">{ROOM_STATUS_LABEL[s]}</dt>
            <dd className={`text-2xl font-bold ${s === 'check_overdue' && counts[s] > 0 ? 'text-danger' : ''}`}>{counts[s]}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Filter rooms" className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link
            key={f}
            href={{ pathname: '/rooms', query: { show: f } }}
            aria-current={f === filter ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              f === filter ? 'bg-ink text-white' : 'border border-line bg-surface'
            }`}
          >
            {FILTERS[f].label}
            {f === 'todo' && ` (${counts.check_overdue + counts.needs_check})`}
          </Link>
        ))}
      </nav>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
          Could not load rooms: {error.message}
        </p>
      )}

      {!error && sorted.length === 0 && (
        <div className="panel p-8 text-center">
          <p className="font-semibold">
            {filter === 'todo' ? 'Every departed room has been checked.' : 'No rooms here.'}
          </p>
        </div>
      )}

      {floors.map((floor) => {
        const rooms = floor === null ? sorted : sorted.filter((r) => (r.floor ?? '—') === floor)
        return (
          <section key={floor ?? 'list'} aria-label={floor === null ? undefined : `Floor ${floor}`}>
            {floor !== null && <h2 className="mb-2 font-bold">Floor {floor}</h2>}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {rooms.map((r) => (
                <li key={r.room_number}>
                  <Link
                    href={`/rooms/${encodeURIComponent(r.room_number)}`}
                    className={`panel block p-3 hover:border-teal ${r.status === 'check_overdue' ? 'border-danger' : ''}`}
                  >
                    <p className="text-xl font-bold">{r.room_number}</p>
                    <RoomStatusBadge status={r.status} />
                    <p className="hint mt-1.5 text-xs">
                      {(r.status === 'needs_check' || r.status === 'check_overdue') && r.departed_at
                        ? `Left ${formatDateTime(r.departed_at)}`
                        : r.last_checked_at
                          ? `Checked ${formatDateTime(r.last_checked_at)}`
                          : 'Not checked yet'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
