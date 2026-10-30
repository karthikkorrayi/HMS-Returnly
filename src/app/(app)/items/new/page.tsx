import Link from 'next/link'
import { ITEM_ROLES, requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadLoggingChoices } from '@/lib/hotel-config'
import type { RoomCheck } from '@/lib/types'
import LogItemForm from './LogItemForm'

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; check?: string }>
}) {
  const { staff } = await requireSession(ITEM_ROLES)
  const params = await searchParams
  // Read as this staff member (row-level security: their hotel only).
  const checkId = params.check && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.check) ? params.check : null
  // Rooms and areas in use (managers retire old ones under Settings).
  const { choices, found } = await withStaff(staff.user_id, async (tx) => ({
    choices: await loadLoggingChoices(tx),
    found: checkId
      ? (await tx.query<Pick<RoomCheck, 'id' | 'room_number' | 'outcome'>>(
          `select id, room_number, outcome::text as outcome from public.room_checks where id = $1`, [checkId])).rows[0]
      : undefined,
  }))

  // Opened from a room check ("Items found – log them"): lock the item to that
  // room and link it to the check, so tracing knows which departure it followed.
  const check = found?.outcome === 'items_found' ? found : null
  const rooms = choices.rooms.map((room_number) => ({ room_number }))
  const roomFromLink =
    check?.room_number ??
    (params.room && (rooms ?? []).some((r) => r.room_number === params.room) ? params.room : undefined)

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Log a found item</h1>
      <p className="hint mt-1">Takes about a minute. Write the code you get on the item’s tag.</p>
      {check && (
        <p className="mt-3 rounded-lg bg-teal-soft px-3 py-2 text-sm">
          Logging items from the check of room <strong>{check.room_number}</strong>. Log each item separately — after
          saving one, come back to{' '}
          <Link href={`/items/new?check=${check.id}`} className="font-semibold text-teal underline">this form</Link>{' '}
          for the next.
        </p>
      )}
      <LogItemForm
        rooms={choices.rooms}
        areas={choices.areas}
        initialRoom={roomFromLink}
        roomCheckId={check?.id}
      />
    </div>
  )
}
