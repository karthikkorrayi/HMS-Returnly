import Link from 'next/link'
import { ITEM_ROLES, requireSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { RoomCheck } from '@/lib/types'
import LogItemForm from './LogItemForm'

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; check?: string }>
}) {
  const { staff, property } = await requireSession(ITEM_ROLES)
  const params = await searchParams
  const supabase = await createClient()

  const { data: rooms } = await supabase
    .from('rooms')
    .select('room_number')
    .order('room_number')
    .returns<{ room_number: string }[]>()

  // Opened from a room check ("Items found – log them"): lock the item to that
  // room and link it to the check, so tracing knows which departure it followed.
  let check: Pick<RoomCheck, 'id' | 'room_number' | 'outcome'> | null = null
  if (params.check && /^[0-9a-f-]{36}$/i.test(params.check)) {
    const { data } = await supabase
      .from('room_checks')
      .select('id, room_number, outcome')
      .eq('id', params.check)
      .maybeSingle<Pick<RoomCheck, 'id' | 'room_number' | 'outcome'>>()
    if (data?.outcome === 'items_found') check = data
  }
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
        propertyId={property.id}
        userId={staff.user_id}
        rooms={(rooms ?? []).map((r) => r.room_number)}
        initialRoom={roomFromLink}
        roomCheckId={check?.id}
      />
    </div>
  )
}
