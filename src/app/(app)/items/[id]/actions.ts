'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { withStaff, type Tx } from '@/lib/db'
import * as item from '@/lib/item-actions'
import { deletePhoto as removePhoto, PhotoRejected } from '@/lib/item-photos'
import { photoStore } from '@/lib/storage'
import type { ActionState } from '@/lib/types'

// Every action re-checks the session, then runs as that staff member in one
// transaction; the database functions and row-level security enforce role,
// hotel and workflow rules, so a crafted POST can't skip them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const optional = (f: FormData, k: string) => str(f, k) || null

async function withItem(
  formData: FormData,
  fn: (ctx: { tx: Tx; itemId: string; userId: string }) => Promise<void>
): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  const itemId = str(formData, 'item_id')
  if (!UUID.test(itemId)) return { error: 'Unknown item.' }
  const userId = session.staff.user_id

  try {
    await withStaff(userId, (tx) => fn({ tx, itemId, userId }))
  } catch (e) {
    const message = item.messageFor(e)
    if (!message) console.error('item action failed', e)
    return { error: message || 'Something went wrong. Please try again.' }
  }

  revalidatePath(`/items/${itemId}`)
  revalidatePath('/items')
  return { error: null, ok: true }
}

export async function storeItem(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId }) => item.storeItem(tx, itemId, optional(f, 'location_id'), optional(f, 'note')))
}

export async function advanceStatus(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId }) => item.advanceStatus(tx, itemId, str(f, 'to'), optional(f, 'note')))
}

export async function moveItem(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId }) => item.moveItem(tx, itemId, optional(f, 'location_id'), optional(f, 'note')))
}

export async function setTier(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId }) => item.setTier(tx, itemId, str(f, 'tier'), optional(f, 'note')))
}

export async function addCandidate(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId, userId }) =>
    item.addCandidate(tx, userId, itemId, {
      reservationRef: str(f, 'reservation_ref'),
      departureDate: optional(f, 'departure_date'),
      note: optional(f, 'note'),
    })
  )
}

export async function removeCandidate(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId }) => item.removeCandidate(tx, itemId, str(f, 'candidate_id')))
}

export async function confirmCandidate(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx }) => item.confirmCandidate(tx, str(f, 'candidate_id')))
}

export async function unconfirmCandidate(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx }) => item.unconfirmCandidate(tx, str(f, 'candidate_id'), optional(f, 'note')))
}

export async function recordHandover(_p: ActionState, f: FormData) {
  return withItem(f, ({ tx, itemId }) =>
    item.recordHandover(tx, itemId, {
      method: str(f, 'method'),
      idChecked: f.get('id_checked') === 'on',
      courierTracking: optional(f, 'courier_tracking'),
      witness: optional(f, 'witness'),
      note: optional(f, 'note'),
    })
  )
}

export async function deletePhoto(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  const itemId = str(f, 'item_id')
  try {
    await removePhoto(withStaff, photoStore(), session.staff.user_id, itemId, str(f, 'photo_id'))
  } catch (e) {
    if (e instanceof PhotoRejected) return { error: e.message }
    console.error('photo delete failed', e)
    return { error: 'The photo could not be deleted. Please try again.' }
  }
  revalidatePath(`/items/${itemId}`)
  revalidatePath('/items')
  return { error: null, ok: true }
}
