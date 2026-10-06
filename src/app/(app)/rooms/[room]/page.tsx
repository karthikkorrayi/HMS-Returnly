import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canManageItems, requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  ROOM_CHECK_TYPE_LABEL,
  type LostItem,
  type RoomBoardRow,
  type RoomCheck,
  type Staff,
  type Stay,
} from '@/lib/types'
import ActionForm from '@/components/ActionForm'
import RoomStatusBadge from '@/components/RoomStatusBadge'
import { StatusBadge } from '@/components/Badges'
import CheckInForm from '../../stays/CheckInForm'
import { cancelStay, checkOutGuest, markItemsFound, markRoomClean } from '../../stays/actions'

const STAY_STATUS = { in_house: 'In house', departed: 'Departed', cancelled: 'Cancelled' }

export default async function RoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { staff: me } = await requireSession()
  const room = decodeURIComponent((await params).room)
  if (!/^[A-Za-z0-9-]{1,10}$/.test(room)) notFound()

  const desk = canManageItems(me.role)
  const supabase = await createClient()
  const [boardRes, checksRes, staysRes, itemsRes, staffRes] = await Promise.all([
    supabase.rpc('room_board'),
    supabase
      .from('room_checks')
      .select('id, room_number, stay_id, check_type, outcome, checked_by, checked_at, note')
      .eq('room_number', room)
      .order('checked_at', { ascending: false })
      .limit(10)
      .returns<RoomCheck[]>(),
    desk
      ? supabase
          .from('stays')
          .select('id, room_number, reservation_ref, check_in_date, check_out_date, checked_in_at, checked_out_at, status, source, note')
          .eq('room_number', room)
          .order('check_in_date', { ascending: false })
          .limit(10)
          .returns<Stay[]>()
      : Promise.resolve({ data: [] as Stay[] }),
    supabase
      .from('lost_items')
      .select('id, item_code, description, status, found_at')
      .eq('room_number', room)
      .order('found_at', { ascending: false })
      .limit(5)
      .returns<Pick<LostItem, 'id' | 'item_code' | 'description' | 'status' | 'found_at'>[]>(),
    supabase.from('staff').select('user_id, display_name').returns<Pick<Staff, 'user_id' | 'display_name'>[]>(),
  ])

  const row = ((boardRes.data ?? []) as RoomBoardRow[]).find((r) => r.room_number === room)
  if (!row) notFound()
  const checks = checksRes.data ?? []
  const stays = staysRes.data ?? []
  const items = itemsRes.data ?? []
  const names = Object.fromEntries((staffRes.data ?? []).map((s) => [s.user_id, s.display_name]))
  const inHouse = stays.find((s) => s.status === 'in_house')
  const needsCheck = row.status === 'needs_check' || row.status === 'check_overdue'
  const occupied = row.status === 'occupied' || row.status === 'due_out'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/rooms" className="text-sm font-semibold text-teal">← All rooms</Link>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Room {room}</h1>
        <RoomStatusBadge status={row.status} />
      </header>

      {/* Housekeeping: the room check */}
      <section aria-labelledby="check" className="panel p-4 sm:p-5">
        <h2 id="check" className="text-lg font-bold">Room check</h2>
        {needsCheck ? (
          <>
            <p className="mt-1">
              The guest left {row.departed_at ? formatDateTime(row.departed_at) : 'recently'}. Check the whole room —
              drawers, safe, under the bed, behind furniture, bathroom — then record what you found.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ActionForm
                action={markRoomClean}
                hidden={{ room_number: room, check_type: 'departure' }}
                submitLabel="Clean – no items found"
                pendingLabel="Saving…"
              />
              <ActionForm
                action={markItemsFound}
                hidden={{ room_number: room, check_type: 'departure' }}
                submitLabel="Items found – log them"
                pendingLabel="Opening…"
                variant="secondary"
              />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-muted">
              {occupied
                ? 'A guest is in this room. Items found while servicing an occupied room belong to that guest — leave them in place or tell the front desk.'
                : row.last_checked_at
                  ? `Checked ${formatDateTime(row.last_checked_at)} — ${row.last_check_outcome === 'clean' ? 'clean' : 'items found'}.`
                  : 'No departures to check.'}
            </p>
            {!occupied && (
              <details className="mt-3 rounded-lg border border-line p-3">
                <summary className="cursor-pointer font-semibold">Record a recheck</summary>
                <p className="hint mt-2">For a second look, or something found after the room was already checked.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <ActionForm action={markRoomClean} hidden={{ room_number: room, check_type: 'recheck' }} submitLabel="Recheck – clean" variant="secondary" />
                  <ActionForm action={markItemsFound} hidden={{ room_number: room, check_type: 'recheck' }} submitLabel="Recheck – items found" variant="secondary" />
                </div>
              </details>
            )}
          </>
        )}
      </section>

      {/* Front desk: the stay */}
      {desk && (
        <section aria-labelledby="stay" className="panel p-4 sm:p-5">
          <h2 id="stay" className="mb-3 text-lg font-bold">Guest stay</h2>
          {inHouse ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted">Confirmation</dt>
                <dd className="font-semibold">{inHouse.reservation_ref}</dd>
                <dt className="text-muted">Staying</dt>
                <dd>{formatDate(inHouse.check_in_date)} – {formatDate(inHouse.check_out_date)}</dd>
              </dl>
              <ActionForm
                action={checkOutGuest}
                hidden={{ stay_id: inHouse.id, room_number: room }}
                submitLabel="Check out"
                pendingLabel="Checking out…"
              />
              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer font-semibold">Entered by mistake? Cancel this stay</summary>
                <ActionForm
                  action={cancelStay}
                  hidden={{ stay_id: inHouse.id, room_number: room }}
                  submitLabel="Cancel stay"
                  variant="danger"
                  className="mt-3"
                >
                  <div>
                    <label htmlFor="cancel-note" className="label">Reason</label>
                    <input id="cancel-note" name="note" className="field" maxLength={300} required placeholder="e.g. Wrong room, guest is in 190" />
                  </div>
                </ActionForm>
              </details>
            </div>
          ) : (
            <CheckInForm room={room} />
          )}
        </section>
      )}

      {items.length > 0 && (
        <section aria-labelledby="items" className="panel p-4 sm:p-5">
          <h2 id="items" className="mb-3 text-lg font-bold">Items found in this room</h2>
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/items/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-teal">
                  <span>
                    <span className="font-semibold">{i.item_code}</span> · {i.description}
                    <span className="hint block">{formatDateTime(i.found_at)}</span>
                  </span>
                  <StatusBadge status={i.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="history" className="panel p-4 sm:p-5">
        <h2 id="history" className="mb-3 text-lg font-bold">History</h2>
        {checks.length === 0 && stays.length === 0 ? (
          <p className="hint">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {[
              ...checks.map((c) => ({
                at: c.checked_at,
                key: `c-${c.id}`,
                title: `${ROOM_CHECK_TYPE_LABEL[c.check_type]}: ${c.outcome === 'clean' ? 'clean' : 'items found'}`,
                detail: `${names[c.checked_by] ?? 'Staff'}${c.note ? ` · ${c.note}` : ''}`,
              })),
              ...stays.map((s) => ({
                at: s.checked_out_at ?? s.checked_in_at ?? `${s.check_in_date}T15:00:00Z`,
                key: `s-${s.id}`,
                title: `Stay ${s.reservation_ref}: ${STAY_STATUS[s.status]}`,
                detail: `${formatDate(s.check_in_date)} – ${formatDate(s.check_out_date)}${s.source === 'import' ? ' · imported' : ''}${s.note ? ` · ${s.note}` : ''}`,
              })),
            ]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((e) => (
                <li key={e.key} className="border-l-2 border-line pl-3">
                  <p className="font-semibold">{e.title}</p>
                  <p className="hint">{formatDateTime(e.at)} · {e.detail}</p>
                </li>
              ))}
          </ol>
        )}
      </section>
    </div>
  )
}
