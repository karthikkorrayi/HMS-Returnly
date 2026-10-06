import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatDateTime, hotelDaysAgo, hotelToday } from '@/lib/format'
import type { Stay } from '@/lib/types'
import ActionForm from '@/components/ActionForm'
import CheckInForm from './CheckInForm'
import ImportStays from './ImportStays'
import { checkOutGuest } from './actions'

export default async function StaysPage() {
  const { property } = await requireSession(['front_office', 'manager'])
  const today = hotelToday()
  const weekAgo = hotelDaysAgo(7)

  const supabase = await createClient()
  const cols = 'id, room_number, reservation_ref, check_in_date, check_out_date, checked_in_at, checked_out_at, status, source, note'
  const [inHouseRes, departedRes, roomsRes] = await Promise.all([
    supabase.from('stays').select(cols).eq('status', 'in_house').order('room_number').returns<Stay[]>(),
    supabase
      .from('stays')
      .select(cols)
      .eq('status', 'departed')
      .gte('check_out_date', weekAgo)
      .order('checked_out_at', { ascending: false })
      .limit(100)
      .returns<Stay[]>(),
    supabase.from('rooms').select('room_number').order('room_number').returns<{ room_number: string }[]>(),
  ])
  const inHouse = (inHouseRes.data ?? []).sort((a, b) => a.room_number.localeCompare(b.room_number, 'en', { numeric: true }))
  const departed = departedRes.data ?? []
  const overdue = inHouse.filter((s) => s.check_out_date < today)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stays</h1>
        <p className="hint mt-1">
          Who stayed in which room, so a found item can be traced back. Kept for {property.stay_retention_days} days,
          then deleted.
        </p>
      </div>

      {overdue.length > 0 && (
        <p role="status" className="rounded-lg bg-attention-soft px-3 py-2 text-attention">
          {overdue.length} guest{overdue.length === 1 ? ' is' : 's are'} still marked in house after their check-out date.
          Check them out so the room gets checked:{' '}
          {overdue.map((s) => s.room_number).join(', ')}.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="checkin" className="panel p-4 sm:p-5">
          <h2 id="checkin" className="mb-3 text-lg font-bold">Check a guest in</h2>
          <CheckInForm rooms={(roomsRes.data ?? []).map((r) => r.room_number)} />
        </section>

        <section aria-labelledby="import" className="panel p-4 sm:p-5">
          <h2 id="import" className="mb-3 text-lg font-bold">Import from the PMS or a sheet</h2>
          <ImportStays today={today} />
        </section>
      </div>

      <section aria-labelledby="inhouse">
        <h2 id="inhouse" className="mb-2 text-lg font-bold">In house ({inHouse.length})</h2>
        {inHouse.length === 0 ? (
          <p className="panel p-4 text-muted">No guests are checked in.</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {inHouse.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <Link href={`/rooms/${encodeURIComponent(s.room_number)}`} className="font-bold hover:text-teal">
                    Room {s.room_number}
                  </Link>{' '}
                  <span className="text-muted">· {s.reservation_ref}</span>
                  <p className={`hint ${s.check_out_date < today ? 'font-semibold text-attention' : ''}`}>
                    {formatDate(s.check_in_date)} – {formatDate(s.check_out_date)}
                    {s.check_out_date < today ? ' · past check-out date' : s.check_out_date === today ? ' · due out today' : ''}
                  </p>
                </div>
                <ActionForm
                  action={checkOutGuest}
                  hidden={{ stay_id: s.id, room_number: s.room_number }}
                  submitLabel="Check out"
                  pendingLabel="Checking out…"
                  variant="secondary"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="departed">
        <h2 id="departed" className="mb-2 text-lg font-bold">Departed in the last 7 days ({departed.length})</h2>
        {departed.length === 0 ? (
          <p className="panel p-4 text-muted">No departures in the last week.</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {departed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <Link href={`/rooms/${encodeURIComponent(s.room_number)}`} className="font-bold hover:text-teal">
                    Room {s.room_number}
                  </Link>{' '}
                  <span className="text-muted">· {s.reservation_ref}</span>
                  <p className="hint">
                    {formatDate(s.check_in_date)} – {formatDate(s.check_out_date)}
                    {s.checked_out_at ? ` · left ${formatDateTime(s.checked_out_at)}` : ''}
                    {s.source === 'import' ? ' · imported' : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
