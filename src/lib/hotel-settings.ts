// Hotel settings a manager can change (page port, group 4). Both values are
// saved in ONE transaction as the manager: either both change or neither.
// The database functions check that the caller is a manager and enforce the
// allowed ranges.
// No Next.js imports, so tests can run it.
import type { Tx } from '@/lib/db/core'
import type { Property } from '@/lib/types'
import { ItemActionError } from '@/lib/item-actions'

export function checkSettings(itemDays: number, requestDays: number) {
  if (!Number.isInteger(itemDays) || itemDays < 7 || itemDays > 730) throw new ItemActionError('Keep unclaimed items for 7 to 730 days.')
  if (!Number.isInteger(requestDays) || requestDays < 30 || requestDays > 1095) {
    throw new ItemActionError('Keep closed enquiries for 30 to 1,095 days.')
  }
}

export async function saveHotelSettings(
  tx: Tx,
  current: Pick<Property, 'trace_window_days' | 'stay_retention_days' | 'check_due_hours'>,
  itemDays: number,
  requestDays: number
) {
  checkSettings(itemDays, requestDays)
  // The stay-log settings (trace window, stay retention, room check deadline)
  // are no longer shown since Rooms and Stays were removed; their stored
  // values are passed back unchanged.
  await tx.rpc('update_property_settings', {
    p_trace_window_days: current.trace_window_days,
    p_stay_retention_days: current.stay_retention_days,
    p_check_due_hours: current.check_due_hours,
    p_retention_days: itemDays,
  })
  await tx.rpc('update_request_settings', { p_request_retention_days: requestDays })
}
