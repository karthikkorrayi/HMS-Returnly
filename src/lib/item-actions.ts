// The item page's actions (step: page port, group 2). Each runs inside
// withStaff() as the signed-in staff member; the database functions and
// row-level security enforce role, hotel and workflow rules, so a crafted
// request cannot skip them. No Next.js imports, so tests can run them.
import type { Tx } from '@/lib/db/core'
import type { HandoverMethod, ItemStatus, ValueTier } from '@/lib/types'

export class ItemActionError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORWARD: ItemStatus[] = ['guest_contacted', 'awaiting_collection', 'awaiting_shipping']
const TIERS: ValueTier[] = ['standard', 'valuable', 'sensitive']
const METHODS: HandoverMethod[] = ['in_person', 'courier', 'disposed', 'donated']

const uuidOrNull = (v: string | null, what: string) => {
  if (v === null) return null
  if (!UUID.test(v)) throw new ItemActionError(`Unknown ${what}.`)
  return v
}

/**
 * Turns a database error into a message for staff. The workflow functions
 * raise plain-English messages (SQLSTATE P0001, or 42501 / P0002 with their
 * own text); those are shown as they are. Anything else is reported generically
 * and the details only go to the server log.
 */
export function messageFor(e: unknown): string {
  if (e instanceof ItemActionError) return e.message
  const err = e as { code?: string; message?: string }
  if (err?.code === '42501' && /row-level security/.test(err.message ?? '')) return 'You can’t do that for this item.'
  if (err?.code && ['P0001', 'P0002', '42501'].includes(err.code) && err.message) return err.message
  return ''
}

export async function storeItem(tx: Tx, itemId: string, locationId: string | null, note: string | null) {
  await tx.rpc('change_status', {
    p_item_id: itemId,
    p_to: 'stored',
    p_storage_location_id: uuidOrNull(locationId, 'storage location'),
    p_note: note,
  })
}

export async function advanceStatus(tx: Tx, itemId: string, to: string, note: string | null) {
  if (!(FORWARD as string[]).includes(to)) throw new ItemActionError('Unknown step.')
  await tx.rpc('change_status', { p_item_id: itemId, p_to: to, p_note: note })
}

export async function moveItem(tx: Tx, itemId: string, locationId: string | null, note: string | null) {
  await tx.rpc('move_item', { p_item_id: itemId, p_storage_location_id: uuidOrNull(locationId, 'storage location'), p_note: note })
}

export async function setTier(tx: Tx, itemId: string, tier: string, note: string | null) {
  if (!(TIERS as string[]).includes(tier)) throw new ItemActionError('Unknown value tier.')
  await tx.rpc('set_value_tier', { p_item_id: itemId, p_tier: tier, p_note: note })
}

/** Normalises a PMS reservation reference: upper case, no spaces. */
export function cleanReservationRef(raw: string): string {
  const ref = raw.toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9-]{3,32}$/.test(ref)) {
    throw new ItemActionError('Enter the reservation or confirmation number from the PMS (letters, numbers, dashes).')
  }
  return ref
}

export async function addCandidate(
  tx: Tx,
  userId: string,
  itemId: string,
  input: { reservationRef: string; departureDate: string | null; note: string | null }
) {
  const ref = cleanReservationRef(input.reservationRef)
  if (input.departureDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.departureDate)) {
    throw new ItemActionError('Enter the departure date as a date.')
  }
  try {
    await tx.query(
      `insert into public.guest_candidates (item_id, reservation_ref, departure_date, note, added_by)
       values ($1, $2, $3::date, $4, $5)`,
      [itemId, ref, input.departureDate, input.note, userId]
    )
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ItemActionError('That reservation is already listed.')
    throw e
  }
}

export async function removeCandidate(tx: Tx, itemId: string, candidateId: string) {
  uuidOrNull(candidateId, 'reservation')
  // Scoped to this item; RLS only lets front office / managers delete
  // unconfirmed candidates of their own hotel.
  const r = await tx.query(`delete from public.guest_candidates where id = $1 and item_id = $2`, [candidateId, itemId])
  if (!r.rowCount) throw new ItemActionError('That reservation could not be removed (already confirmed, or not allowed).')
}

export async function confirmCandidate(tx: Tx, candidateId: string) {
  await tx.rpc('confirm_candidate', { p_candidate_id: uuidOrNull(candidateId, 'reservation') })
}

export async function unconfirmCandidate(tx: Tx, candidateId: string, note: string | null) {
  await tx.rpc('unconfirm_candidate', { p_candidate_id: uuidOrNull(candidateId, 'reservation'), p_note: note })
}

export async function recordHandover(
  tx: Tx,
  itemId: string,
  input: { method: string; idChecked: boolean; courierTracking: string | null; witness: string | null; note: string | null }
) {
  if (!(METHODS as string[]).includes(input.method)) throw new ItemActionError('Unknown handover.')
  await tx.rpc('record_handover', {
    p_item_id: itemId,
    p_method: input.method,
    p_id_checked: input.idChecked ? true : null,
    p_courier_tracking: input.courierTracking,
    p_witness: uuidOrNull(input.witness, 'witness'),
    p_note: input.note,
  })
}
