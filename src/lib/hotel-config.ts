// Hotel configuration managers change in the app (S3/S4): hotel details and
// guest support, floors and rooms, public areas, storage places.
// Everything runs as the signed-in manager inside withStaff(): the database's
// row-level security lets only an active manager of THIS hotel change these
// rows, and the functions below add the rules that keep history intact:
//   * a room, area or storage place that has been used is retired, not
//     deleted (logged items keep pointing at it);
//   * a storage place still holding items can't be retired, and one holding
//     valuable items can't stop being "locked".
// No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'
import { parseRoomList, SetupError } from '@/lib/setup'

export class ConfigError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: string, what: string) => {
  if (!UUID.test(v)) throw new ConfigError(`Unknown ${what}.`)
  return v
}
const label60 = (v: string, what: string) => {
  const s = v.trim()
  if (s.length < 1 || s.length > 60) throw new ConfigError(`${what}: 1–60 characters.`)
  return s
}
const floorName = (v: string) => {
  const s = v.trim()
  if (!/^[A-Za-z0-9 ._-]{1,20}$/.test(s)) throw new ConfigError('Floor name: 1–20 letters, digits, spaces, dots or dashes (e.g. "Ground" or "1").')
  return s
}

/** Plain-language message for an expected database refusal, or '' if unexpected. */
export function configMessage(e: unknown): string {
  if (e instanceof ConfigError || e instanceof SetupError) return e.message
  const err = e as { code?: string; message?: string; constraint?: string; detail?: string }
  if (err?.code === '23505') return 'That name is already used in this hotel.'
  if (err?.code === '23503') return 'It is still in use (it has items or rooms recorded against it), so it can’t be deleted. Retire it instead.'
  if (err?.code === '23514') return 'One of the values is not in the expected format.'
  if (err?.code === '42501') return 'Only managers can change the hotel’s configuration.'
  if (err?.code && ['P0001', 'P0002'].includes(err.code) && err.message) return err.message
  return ''
}

// --- Hotel details and guest support -------------------------------------------

export type HotelDetails = {
  name: string; inn_code: string; address: string | null; contact_phone: string | null
  contact_email: string | null; support_hours: string | null; support_note: string | null
}

export async function loadHotelDetails(tx: Tx): Promise<HotelDetails> {
  const r = await tx.query<HotelDetails>(
    `select name, inn_code, address, contact_phone, contact_email, support_hours, support_note from public.properties limit 1`
  )
  if (!r.rows[0]) throw new ConfigError('Hotel not found.')
  return r.rows[0]
}

export async function saveHotelDetails(tx: Tx, input: {
  name: string; address: string; phone: string; email: string; supportHours: string; supportNote: string
}) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 100) throw new ConfigError('Hotel name: 2–100 characters.')
  const email = input.email.trim().toLowerCase()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConfigError('The contact email does not look right.')
  const phone = input.phone.trim()
  if (phone && !/^[0-9 +()-]{5,30}$/.test(phone)) throw new ConfigError('Contact phone: digits, spaces, +, ( ) and dashes only.')
  if (input.address.trim().length > 300) throw new ConfigError('Address: at most 300 characters.')
  if (input.supportHours.trim().length > 120) throw new ConfigError('Support hours: at most 120 characters.')
  if (input.supportNote.trim().length > 500) throw new ConfigError('Note for guests: at most 500 characters.')
  await tx.query(`select public.update_hotel_details($1, $2, $3, $4, $5, $6)`, [
    name, input.address, phone, email, input.supportHours, input.supportNote,
  ])
}

// --- Floors and rooms -----------------------------------------------------------

export type RoomRow = { room_number: string; active: boolean; used: boolean }
export type FloorWithRooms = { id: string; name: string; sort_order: number; rooms: RoomRow[] }

/** Floors in order with their rooms; rooms without a floor come last as "No floor". */
export async function loadFloors(tx: Tx): Promise<{ floors: FloorWithRooms[]; unassigned: RoomRow[] }> {
  const floors = (await tx.query<{ id: string; name: string; sort_order: number }>(
    `select id, name, sort_order from public.floors order by sort_order, name`
  )).rows
  const rooms = (await tx.query<{ room_number: string; floor_id: string | null; active: boolean; used: boolean }>(
    `select r.room_number, r.floor_id, r.active,
            exists (select 1 from public.lost_items i where i.property_id = r.property_id and i.room_number = r.room_number) as used
       from public.rooms r
      order by length(r.room_number), r.room_number`
  )).rows
  const by = new Map<string, RoomRow[]>()
  const unassigned: RoomRow[] = []
  for (const r of rooms) {
    const row = { room_number: r.room_number, active: r.active, used: r.used }
    if (r.floor_id) by.set(r.floor_id, [...(by.get(r.floor_id) ?? []), row])
    else unassigned.push(row)
  }
  return { floors: floors.map((f) => ({ ...f, rooms: by.get(f.id) ?? [] })), unassigned }
}

export async function addFloor(tx: Tx, propertyId: string, name: string) {
  const n = floorName(name)
  await tx.query(
    `insert into public.floors (property_id, name, sort_order)
     select $1, $2, coalesce(max(sort_order), 0) + 1 from public.floors`, [propertyId, n])
}

export async function renameFloor(tx: Tx, floorId: string, name: string) {
  const r = await tx.query(`update public.floors set name = $2 where id = $1`, [id(floorId, 'floor'), floorName(name)])
  if (r.rowCount === 0) throw new ConfigError('Floor not found.')
}

/** Only an empty floor can be removed. */
export async function deleteFloor(tx: Tx, floorId: string) {
  const n = (await tx.query<{ n: number }>(`select count(*)::int as n from public.rooms where floor_id = $1`, [id(floorId, 'floor')])).rows[0].n
  if (n > 0) throw new ConfigError('Only an empty floor can be removed: move or delete its rooms first.')
  const r = await tx.query(`delete from public.floors where id = $1`, [floorId])
  if (r.rowCount === 0) throw new ConfigError('Floor not found.')
}

/** Adds rooms ("101, 102, 110-120") to a floor. Returns how many were added. */
export async function addRooms(tx: Tx, propertyId: string, floorId: string, text: string): Promise<number> {
  let rooms: string[]
  try {
    rooms = parseRoomList(text)
  } catch (e) {
    throw new ConfigError((e as Error).message)
  }
  if (rooms.length === 0) throw new ConfigError('Type the room numbers to add, e.g. 101, 102 or 101-120.')
  if (rooms.length > 500) throw new ConfigError('At most 500 rooms at a time.')
  const seen = new Set<string>()
  for (const r of rooms) {
    if (!/^[A-Za-z0-9-]{1,10}$/.test(r)) throw new ConfigError(`Room "${r.slice(0, 20)}": 1–10 letters, digits or dashes.`)
    if (seen.has(r.toUpperCase())) throw new ConfigError(`Room ${r} is listed twice.`)
    seen.add(r.toUpperCase())
  }
  const existing = (await tx.query<{ room_number: string }>(
    `select room_number from public.rooms where upper(room_number) = any (string_to_array($1::text, ','))`,
    [[...seen].join(',')]
  )).rows.map((r) => r.room_number)
  if (existing.length) throw new ConfigError(`Already exists: ${existing.slice(0, 10).join(', ')}${existing.length > 10 ? '…' : ''}.`)
  const r = await tx.query(
    `insert into public.rooms (property_id, room_number, floor_id)
     select $1, unnest(string_to_array($2::text, ',')), $3`,
    [propertyId, rooms.join(','), id(floorId, 'floor')]
  )
  return r.rowCount ?? rooms.length
}

/** Retire (hide from new items) or bring back a room. */
export async function setRoomActive(tx: Tx, roomNumber: string, active: boolean) {
  const r = await tx.query(`update public.rooms set active = $2 where room_number = $1`, [roomNumber, active])
  if (r.rowCount === 0) throw new ConfigError('Room not found.')
}

/** Deletes a room that has never been used; a used room must be retired. */
export async function deleteRoom(tx: Tx, roomNumber: string) {
  const used = (await tx.query<{ used: boolean }>(
    `select exists (select 1 from public.lost_items where room_number = $1) as used`, [roomNumber]
  )).rows[0].used
  if (used) throw new ConfigError(`Room ${roomNumber} has items recorded, so it can’t be deleted. Retire it instead.`)
  const r = await tx.query(`delete from public.rooms where room_number = $1`, [roomNumber])
  if (r.rowCount === 0) throw new ConfigError('Room not found.')
}

export async function moveRoom(tx: Tx, roomNumber: string, floorId: string) {
  const r = await tx.query(`update public.rooms set floor_id = $2 where room_number = $1`, [roomNumber, id(floorId, 'floor')])
  if (r.rowCount === 0) throw new ConfigError('Room not found.')
}

// --- Public areas -----------------------------------------------------------------

export type AreaRow = { id: string; label: string; active: boolean }

export async function loadAreas(tx: Tx): Promise<AreaRow[]> {
  return (await tx.query<AreaRow>(`select id, label, active from public.areas order by sort_order, label`)).rows
}

export async function addArea(tx: Tx, propertyId: string, label: string) {
  await tx.query(
    `insert into public.areas (property_id, label, sort_order)
     select $1, $2, coalesce(max(sort_order), 0) + 1 from public.areas`, [propertyId, label60(label, 'Area')])
}

/** Renaming keeps old items' wording: they store the area as text. */
export async function renameArea(tx: Tx, areaId: string, label: string) {
  const r = await tx.query(`update public.areas set label = $2 where id = $1`, [id(areaId, 'area'), label60(label, 'Area')])
  if (r.rowCount === 0) throw new ConfigError('Area not found.')
}

export async function setAreaActive(tx: Tx, areaId: string, active: boolean) {
  const r = await tx.query(`update public.areas set active = $2 where id = $1`, [id(areaId, 'area'), active])
  if (r.rowCount === 0) throw new ConfigError('Area not found.')
}

// --- Storage places ---------------------------------------------------------------

export type StorageRow = { id: string; label: string; is_secure: boolean; active: boolean; holding: number; valuables: number }

export async function loadStorage(tx: Tx): Promise<StorageRow[]> {
  return (await tx.query<StorageRow>(
    `select l.id, l.label, l.is_secure, l.active,
            (select count(*)::int from public.lost_items i where i.storage_location_id = l.id and i.status = 'stored') as holding,
            (select count(*)::int from public.lost_items i where i.storage_location_id = l.id and i.status = 'stored'
                and i.value_tier <> 'standard') as valuables
       from public.storage_locations l
      order by l.active desc, l.label`
  )).rows
}

export async function addStorage(tx: Tx, propertyId: string, label: string, secure: boolean) {
  await tx.query(`insert into public.storage_locations (property_id, label, is_secure) values ($1, $2, $3)`,
    [propertyId, label60(label, 'Storage place'), secure])
}

export async function renameStorage(tx: Tx, locationId: string, label: string) {
  const r = await tx.query(`update public.storage_locations set label = $2 where id = $1`,
    [id(locationId, 'storage place'), label60(label, 'Storage place')])
  if (r.rowCount === 0) throw new ConfigError('Storage place not found.')
}

async function storageCounts(tx: Tx, locationId: string) {
  const row = (await tx.query<{ holding: number; valuables: number }>(
    `select count(*)::int as holding, count(*) filter (where value_tier <> 'standard')::int as valuables
       from public.lost_items where storage_location_id = $1 and status = 'stored'`, [id(locationId, 'storage place')]
  )).rows[0]
  return row
}

/** A place holding valuable items must stay locked. */
export async function setStorageSecure(tx: Tx, locationId: string, secure: boolean) {
  if (!secure && (await storageCounts(tx, locationId)).valuables > 0) {
    throw new ConfigError('Valuable items are stored here, so it must stay a locked place. Move them first.')
  }
  const r = await tx.query(`update public.storage_locations set is_secure = $2 where id = $1`, [locationId, secure])
  if (r.rowCount === 0) throw new ConfigError('Storage place not found.')
}

/** A place still holding items can't be retired. */
export async function setStorageActive(tx: Tx, locationId: string, active: boolean) {
  if (!active) {
    const { holding } = await storageCounts(tx, locationId)
    if (holding > 0) throw new ConfigError(`${holding} item${holding === 1 ? ' is' : 's are'} stored here. Move ${holding === 1 ? 'it' : 'them'} before retiring this place.`)
  }
  const r = await tx.query(`update public.storage_locations set active = $2 where id = $1`, [locationId, active])
  if (r.rowCount === 0) throw new ConfigError('Storage place not found.')
}

// --- What item logging offers -------------------------------------------------------

/** Active rooms and areas, for the "Log item" form. */
export async function loadLoggingChoices(tx: Tx): Promise<{ rooms: string[]; areas: string[] }> {
  const rooms = (await tx.query<{ room_number: string }>(
    `select room_number from public.rooms where active order by length(room_number), room_number`
  )).rows.map((r) => r.room_number)
  const areas = (await tx.query<{ label: string }>(
    `select label from public.areas where active order by sort_order, label`
  )).rows.map((r) => r.label)
  return { rooms, areas }
}

// --- Guests -----------------------------------------------------------------------

export type PublicContact = { inn_code: string; contact_phone: string | null; contact_email: string | null; support_hours: string | null; support_note: string | null }

export async function publicContacts(tx: Tx): Promise<PublicContact[]> {
  return (await tx.query<PublicContact>(`select * from public.public_hotel_contacts()`)).rows
}
