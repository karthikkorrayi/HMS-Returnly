'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ActionState, HandoverMethod, ItemStatus, ValueTier } from '@/lib/types'

// Every action re-checks the session; the database functions then enforce
// role, property and workflow rules, so a crafted POST can't skip them.

const UUID = /^[0-9a-f-]{36}$/i
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const optional = (f: FormData, k: string) => str(f, k) || null

async function withItem(
  formData: FormData,
  fn: (ctx: { supabase: Awaited<ReturnType<typeof createClient>>; itemId: string; userId: string }) => PromiseLike<{ error: { message: string } | null }>
): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  const itemId = str(formData, 'item_id')
  if (!UUID.test(itemId)) return { error: 'Unknown item.' }

  const supabase = await createClient()
  const { error } = await fn({ supabase, itemId, userId: session.staff.user_id })
  if (error) return { error: error.message }

  revalidatePath(`/items/${itemId}`)
  revalidatePath('/items')
  return { error: null, ok: true }
}

export async function storeItem(_p: ActionState, f: FormData) {
  return withItem(f, ({ supabase, itemId }) =>
    supabase.rpc('change_status', {
      p_item_id: itemId,
      p_to: 'stored',
      p_storage_location_id: optional(f, 'location_id'),
      p_note: optional(f, 'note'),
    })
  )
}

const FORWARD: ItemStatus[] = ['guest_contacted', 'awaiting_collection', 'awaiting_shipping']

export async function advanceStatus(_p: ActionState, f: FormData) {
  const to = str(f, 'to') as ItemStatus
  if (!FORWARD.includes(to)) return { error: 'Unknown step.' }
  return withItem(f, ({ supabase, itemId }) =>
    supabase.rpc('change_status', { p_item_id: itemId, p_to: to, p_note: optional(f, 'note') })
  )
}

export async function moveItem(_p: ActionState, f: FormData) {
  return withItem(f, ({ supabase, itemId }) =>
    supabase.rpc('move_item', {
      p_item_id: itemId,
      p_storage_location_id: optional(f, 'location_id'),
      p_note: optional(f, 'note'),
    })
  )
}

export async function setTier(_p: ActionState, f: FormData) {
  const tier = str(f, 'tier') as ValueTier
  if (!['standard', 'valuable', 'sensitive'].includes(tier)) return { error: 'Unknown value tier.' }
  return withItem(f, ({ supabase, itemId }) =>
    supabase.rpc('set_value_tier', { p_item_id: itemId, p_tier: tier, p_note: optional(f, 'note') })
  )
}

export async function addCandidate(_p: ActionState, f: FormData) {
  const ref = str(f, 'reservation_ref').toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9-]{3,32}$/.test(ref)) {
    return { error: 'Enter the reservation or confirmation number from the PMS (letters, numbers, dashes).' }
  }
  return withItem(f, async ({ supabase, itemId, userId }) => {
    const { error } = await supabase.from('guest_candidates').insert({
      item_id: itemId,
      reservation_ref: ref,
      departure_date: optional(f, 'departure_date'),
      note: optional(f, 'note'),
      added_by: userId,
    })
    if (error?.code === '23505') return { error: { message: 'That reservation is already listed.' } }
    return { error }
  })
}

export async function removeCandidate(_p: ActionState, f: FormData) {
  const id = str(f, 'candidate_id')
  if (!UUID.test(id)) return { error: 'Unknown reservation.' }
  return withItem(f, ({ supabase }) => supabase.from('guest_candidates').delete().eq('id', id))
}

export async function confirmCandidate(_p: ActionState, f: FormData) {
  const id = str(f, 'candidate_id')
  if (!UUID.test(id)) return { error: 'Unknown reservation.' }
  return withItem(f, ({ supabase }) => supabase.rpc('confirm_candidate', { p_candidate_id: id }))
}

export async function unconfirmCandidate(_p: ActionState, f: FormData) {
  const id = str(f, 'candidate_id')
  if (!UUID.test(id)) return { error: 'Unknown reservation.' }
  return withItem(f, ({ supabase }) =>
    supabase.rpc('unconfirm_candidate', { p_candidate_id: id, p_note: optional(f, 'note') })
  )
}

export async function recordHandover(_p: ActionState, f: FormData) {
  const method = str(f, 'method') as HandoverMethod
  if (!['in_person', 'courier', 'disposed', 'donated'].includes(method)) return { error: 'Unknown handover.' }
  const witness = optional(f, 'witness')
  if (witness && !UUID.test(witness)) return { error: 'Unknown witness.' }
  return withItem(f, ({ supabase, itemId }) =>
    supabase.rpc('record_handover', {
      p_item_id: itemId,
      p_method: method,
      p_id_checked: f.get('id_checked') === 'on' ? true : null,
      p_courier_tracking: optional(f, 'courier_tracking'),
      p_witness: witness,
      p_note: optional(f, 'note'),
    })
  )
}

export async function deletePhoto(_p: ActionState, f: FormData) {
  const photoId = str(f, 'photo_id')
  if (!UUID.test(photoId)) return { error: 'Unknown photo.' }
  return withItem(f, async ({ supabase, itemId }) => {
    const { data: photo, error: readError } = await supabase
      .from('item_photos')
      .select('storage_path')
      .eq('id', photoId)
      .eq('item_id', itemId)
      .single()
    if (readError || !photo) return { error: readError ?? { message: 'Photo not found.' } }

    // Storage first: if the row went first and this failed, the file would be orphaned.
    const { data: removed, error: storageError } = await supabase.storage
      .from('item-photos')
      .remove([photo.storage_path])
    if (storageError) return { error: storageError }
    if (!removed?.length) return { error: { message: 'Only managers can delete photos.' } }

    const { error } = await supabase.from('item_photos').delete().eq('id', photoId)
    return { error }
  })
}
