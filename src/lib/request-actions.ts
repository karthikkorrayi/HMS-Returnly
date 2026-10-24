// What Admin and Support do on a customer request (page port, group 4).
// Each runs inside withStaff() as the signed-in staff member; the database
// functions decide who may do what (Admin vs the assigned Support member)
// and which status changes are allowed. No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'
import { REQUEST_STATUSES } from '@/lib/requests/types'
import { ItemActionError } from '@/lib/item-actions'

export { messageFor } from '@/lib/item-actions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function checkRequestId(id: string): string {
  if (!UUID.test(id)) throw new ItemActionError('Unknown request.')
  return id
}

export async function changeStatus(tx: Tx, requestId: string, to: string, note: string | null) {
  if (!(REQUEST_STATUSES as string[]).includes(to)) throw new ItemActionError('Unknown status.')
  await tx.rpc('set_request_status', { p_request_id: checkRequestId(requestId), p_to: to, p_note: note })
}

export async function assign(tx: Tx, requestId: string, staffId: string | null) {
  if (staffId !== null && !UUID.test(staffId)) throw new ItemActionError('Unknown staff member.')
  await tx.rpc('assign_request', { p_request_id: checkRequestId(requestId), p_staff_id: staffId })
}

export async function addNote(tx: Tx, requestId: string, body: string) {
  if (!body.trim()) throw new ItemActionError('Write a note first.')
  await tx.rpc('add_request_note', { p_request_id: checkRequestId(requestId), p_body: body.trim() })
}

export async function messageCustomer(tx: Tx, requestId: string, body: string, ask: boolean) {
  if (!body.trim()) throw new ItemActionError('Write a message first.')
  await tx.rpc('message_customer', { p_request_id: checkRequestId(requestId), p_body: body.trim(), p_ask: ask })
}

/**
 * Approval is always a person choosing a specific item: by its id (from the
 * match list) or by the code on its tag. The code is looked up under RLS, so
 * an item from another hotel is simply "not found".
 */
export async function approve(tx: Tx, requestId: string, input: { itemId: string | null; itemCode: string | null; note: string | null }) {
  checkRequestId(requestId)
  let itemId = input.itemId && UUID.test(input.itemId) ? input.itemId : null
  if (!itemId) {
    const code = (input.itemCode ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{3,10}-\d{6}-\d{4,}$/.test(code)) throw new ItemActionError('Enter the item code from the tag, e.g. DEMO-261013-0042.')
    const found = (await tx.query<{ id: string }>(`select id from public.lost_items where item_code = $1`, [code])).rows[0]
    if (!found) throw new ItemActionError(`No item with code ${code}.`)
    itemId = found.id
  }
  await tx.rpc('approve_request', { p_request_id: requestId, p_item_id: itemId, p_note: input.note })
}
