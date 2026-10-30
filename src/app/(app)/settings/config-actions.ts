'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { withStaff, type Tx } from '@/lib/db'
import * as cfg from '@/lib/hotel-config'
import type { ActionState } from '@/lib/types'

// Hotel configuration (S3/S4). Each action re-checks that the caller is a
// manager, then runs as them: the database lets only a manager of this hotel
// change these rows, and src/lib/hotel-config.ts keeps history intact.

const str = (f: FormData, k: string) => String(f.get(k) ?? '')

async function run(fn: (tx: Tx, propertyId: string) => Promise<unknown>): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  if (session.staff.role !== 'manager') return { error: 'Only managers can change the hotel’s configuration.' }
  try {
    await withStaff(session.staff.user_id, (tx) => fn(tx, session.property.id))
  } catch (e) {
    const message = cfg.configMessage(e)
    if (!message) console.error('hotel configuration change failed', e)
    return { error: message || 'That change could not be saved. Please try again.' }
  }
  revalidatePath('/', 'layout') // hotel name in the header, "Log item" lists, guest page
  return { error: null, ok: true }
}

export async function saveHotelDetailsAction(_p: ActionState, f: FormData) {
  return run((tx) => cfg.saveHotelDetails(tx, {
    name: str(f, 'name'), address: str(f, 'address'), phone: str(f, 'phone'), email: str(f, 'email'),
    supportHours: str(f, 'support_hours'), supportNote: str(f, 'support_note'),
  }))
}

// Floors and rooms
export async function addFloorAction(_p: ActionState, f: FormData) {
  return run((tx, property) => cfg.addFloor(tx, property, str(f, 'name')))
}
export async function renameFloorAction(_p: ActionState, f: FormData) {
  return run((tx) => cfg.renameFloor(tx, str(f, 'floor_id'), str(f, 'name')))
}
export async function deleteFloorAction(_p: ActionState, f: FormData) {
  return run((tx) => cfg.deleteFloor(tx, str(f, 'floor_id')))
}
export async function addRoomsAction(_p: ActionState, f: FormData) {
  return run((tx, property) => cfg.addRooms(tx, property, str(f, 'floor_id'), str(f, 'rooms')))
}
export async function changeRoomAction(_p: ActionState, f: FormData) {
  const room = str(f, 'room').trim().toUpperCase()
  const what = str(f, 'what')
  return run(async (tx) => {
    // Room numbers are matched as typed by staff; find the stored spelling.
    const found = (await tx.query<{ room_number: string }>(`select room_number from public.rooms where upper(room_number) = $1`, [room])).rows[0]
    if (!found) throw new cfg.ConfigError(`Room ${room || '—'} is not on this hotel’s list.`)
    if (what === 'retire') return cfg.setRoomActive(tx, found.room_number, false)
    if (what === 'restore') return cfg.setRoomActive(tx, found.room_number, true)
    if (what === 'delete') return cfg.deleteRoom(tx, found.room_number)
    if (what.startsWith('move:')) return cfg.moveRoom(tx, found.room_number, what.slice(5))
    throw new cfg.ConfigError('Choose what to do with the room.')
  })
}

// Areas
export async function addAreaAction(_p: ActionState, f: FormData) {
  return run((tx, property) => cfg.addArea(tx, property, str(f, 'label')))
}
export async function renameAreaAction(_p: ActionState, f: FormData) {
  return run((tx) => cfg.renameArea(tx, str(f, 'area_id'), str(f, 'label')))
}
export async function setAreaActiveAction(_p: ActionState, f: FormData) {
  return run((tx) => cfg.setAreaActive(tx, str(f, 'area_id'), str(f, 'active') === 'true'))
}

// Storage places
export async function addStorageAction(_p: ActionState, f: FormData) {
  return run((tx, property) => cfg.addStorage(tx, property, str(f, 'label'), str(f, 'kind') === 'secure'))
}
export async function saveStorageAction(_p: ActionState, f: FormData) {
  return run(async (tx) => {
    const locationId = str(f, 'location_id')
    await cfg.renameStorage(tx, locationId, str(f, 'label'))
    await cfg.setStorageSecure(tx, locationId, str(f, 'kind') === 'secure')
  })
}
export async function setStorageActiveAction(_p: ActionState, f: FormData) {
  return run((tx) => cfg.setStorageActive(tx, str(f, 'location_id'), str(f, 'active') === 'true'))
}
