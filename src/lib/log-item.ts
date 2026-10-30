// Logging a found item (page port, group 3). Runs inside withStaff() as the
// signed-in staff member: row-level security only lets them log items for
// their own hotel in their own name, and the table's checks (room on the
// hotel's list, time not in the future, lengths) apply as before. Database
// errors are turned into plain messages. No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'
import { CATEGORIES, type ValueTier } from '@/lib/types'

export class LogItemError extends Error {}

export type LogItemInput = {
  areaType: 'room' | 'public_area'
  roomNumber: string | null
  areaLabel: string | null
  /** ISO timestamp from the phone. */
  foundAt: string
  category: string
  description: string
  brand: string | null
  colour: string | null
  valueTier: ValueTier
  roomCheckId: string | null
  foundSpot: string | null
  spotHidden: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIERS: ValueTier[] = ['standard', 'valuable', 'sensitive']

const CONSTRAINT_MESSAGE: Record<string, string> = {
  room_exists: 'That room is not on this hotel’s room list.',
  found_not_in_future: 'The time found can’t be in the future.',
  room_required_for_rooms: 'Enter the room number.',
  area_required_for_public: 'Say where in the hotel it was found.',
}

export async function logItem(tx: Tx, userId: string, propertyId: string, input: LogItemInput): Promise<string> {
  const room = input.areaType === 'room'
  if (input.areaType !== 'room' && input.areaType !== 'public_area') throw new LogItemError('Choose where it was found.')
  if (!CATEGORIES.some((c) => c.value === input.category)) throw new LogItemError('Choose what kind of item it is.')
  if (!TIERS.includes(input.valueTier)) throw new LogItemError('Choose how valuable it is.')
  const description = input.description.trim()
  if (description.length < 3 || description.length > 500) throw new LogItemError('Describe the item in 3–500 characters.')
  const foundAt = new Date(input.foundAt)
  if (Number.isNaN(foundAt.getTime())) throw new LogItemError('Enter when it was found.')
  if (input.roomCheckId !== null && !UUID.test(input.roomCheckId)) throw new LogItemError('Unknown room check.')
  // A retired room (Settings → Floors and rooms) is no longer offered; refuse it
  // here too, so the rule doesn't depend on the form.
  if (room && input.roomNumber?.trim()) {
    const found = (await tx.query<{ active: boolean }>(`select active from public.rooms where room_number = $1`, [input.roomNumber.trim()])).rows[0]
    if (found && !found.active) throw new LogItemError('That room has been retired. Ask a manager if it should be back in use.')
  }

  try {
    const r = await tx.query<{ id: string }>(
      `insert into public.lost_items
         (property_id, found_area_type, room_number, area_label, found_at, found_by, category, description,
          brand, colour, value_tier, room_check_id, found_spot, spot_hidden)
       values ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11::public.value_tier, $12, $13, $14)
       returning id`,
      [
        propertyId,
        input.areaType,
        room ? input.roomNumber?.trim() || null : null,
        room ? null : input.areaLabel?.trim() || null,
        foundAt.toISOString(),
        userId,
        input.category,
        description,
        input.brand?.trim() || null,
        input.colour?.trim() || null,
        input.valueTier,
        room ? input.roomCheckId : null,
        room ? input.foundSpot?.trim() || null : null,
        room && input.spotHidden,
      ]
    )
    return r.rows[0].id
  } catch (e) {
    const err = e as { code?: string; constraint?: string; message?: string }
    if (err.constraint && CONSTRAINT_MESSAGE[err.constraint]) throw new LogItemError(CONSTRAINT_MESSAGE[err.constraint])
    if (err.code === '23514') throw new LogItemError('Some details are too long or missing. Check the form and try again.')
    if (err.code === '42501' && /row-level security/.test(err.message ?? '')) throw new LogItemError('You can’t log items for this hotel.')
    // Raised by the room-check link trigger, e.g. a check from another room.
    if (err.code === 'P0001' && err.message) throw new LogItemError(err.message)
    throw e
  }
}
