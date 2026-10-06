'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canManageItems, getSession, type Session } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/types'
import type { StayImportRow } from '@/lib/csv'

// Each action re-checks the session; the database functions enforce role,
// hotel and data rules, so a crafted POST can't skip them.

const UUID = /^[0-9a-f-]{36}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

function refresh(room?: string) {
  revalidatePath('/rooms')
  revalidatePath('/stays')
  if (room) revalidatePath(`/rooms/${encodeURIComponent(room)}`)
}

type Gate = { error: string; session?: undefined } | { error: null; session: Session }

async function deskSession(): Promise<Gate> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  if (!canManageItems(session.staff.role)) return { error: 'Only front office or managers can do this.' }
  return { error: null, session }
}

// --- Front desk -----------------------------------------------------------------

export async function checkInGuest(_p: ActionState, f: FormData): Promise<ActionState> {
  const gate = await deskSession()
  if (gate.error !== null) return { error: gate.error }

  const room = str(f, 'room_number')
  const ref = str(f, 'reservation_ref')
  const surname = str(f, 'guest_surname')
  const checkIn = str(f, 'check_in_date')
  const checkOut = str(f, 'check_out_date')
  if (!room || !ref || !surname) return { error: 'Room, confirmation number and surname are all required.' }
  if (!DATE.test(checkOut)) return { error: 'Enter the check-out date.' }
  if (checkIn && !DATE.test(checkIn)) return { error: 'Check-in date is not valid.' }
  if (checkIn && checkOut < checkIn) return { error: 'Check-out can’t be before check-in.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('check_in_guest', {
    p_room_number: room,
    p_reservation_ref: ref,
    p_guest_surname: surname,
    p_check_out_date: checkOut,
    p_check_in_date: checkIn || null,
  })
  if (error) return { error: error.message }
  refresh(room)
  return { error: null, ok: true }
}

export async function checkOutGuest(_p: ActionState, f: FormData): Promise<ActionState> {
  const gate = await deskSession()
  if (gate.error !== null) return { error: gate.error }
  const stayId = str(f, 'stay_id')
  if (!UUID.test(stayId)) return { error: 'Unknown stay.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('check_out_guest', { p_stay_id: stayId })
  if (error) return { error: error.message }
  refresh(str(f, 'room_number') || undefined)
  return { error: null, ok: true }
}

export async function cancelStay(_p: ActionState, f: FormData): Promise<ActionState> {
  const gate = await deskSession()
  if (gate.error !== null) return { error: gate.error }
  const stayId = str(f, 'stay_id')
  if (!UUID.test(stayId)) return { error: 'Unknown stay.' }
  const note = str(f, 'note')
  if (!note) return { error: 'Say why the stay is being cancelled.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_stay', { p_stay_id: stayId, p_note: note })
  if (error) return { error: error.message }
  refresh(str(f, 'room_number') || undefined)
  return { error: null, ok: true }
}

export type ImportResult = {
  error: string | null
  saved?: number
  failed?: number
  errors?: { row: number; message: string }[]
}

export async function importStays(rows: StayImportRow[]): Promise<ImportResult> {
  const gate = await deskSession()
  if (gate.error !== null) return { error: gate.error }
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'The file has no rows to import.' }
  if (rows.length > 2000) return { error: 'Import at most 2,000 rows at a time.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('import_stays', { p_rows: rows })
  if (error) return { error: error.message }
  refresh()
  return { error: null, ...(data as { saved: number; failed: number; errors: { row: number; message: string }[] }) }
}

// --- Housekeeping ---------------------------------------------------------------

export async function markRoomClean(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  const room = str(f, 'room_number')
  const type = str(f, 'check_type') || 'departure'
  if (!['departure', 'recheck', 'deep_clean'].includes(type)) return { error: 'Unknown check type.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('record_room_check', {
    p_room_number: room,
    p_outcome: 'clean',
    p_check_type: type,
    p_note: str(f, 'note') || null,
  })
  if (error) return { error: error.message }
  refresh(room)
  return { error: null, ok: true }
}

// Records the check as "items found", then opens the item form linked to it.
export async function markItemsFound(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  const room = str(f, 'room_number')
  const type = str(f, 'check_type') || 'departure'
  if (!['departure', 'recheck', 'deep_clean'].includes(type)) return { error: 'Unknown check type.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_room_check', {
    p_room_number: room,
    p_outcome: 'items_found',
    p_check_type: type,
    p_note: str(f, 'note') || null,
  })
  if (error) return { error: error.message }
  refresh(room)
  redirect(`/items/new?room=${encodeURIComponent(room)}&check=${data}`)
}
