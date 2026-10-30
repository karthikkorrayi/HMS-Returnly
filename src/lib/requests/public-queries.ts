// The customer-facing database calls (no sign-in), separated from the server
// actions so tests can run them. Each runs inside withAnon(): role anon,
// which may call these four functions (public_properties,
// submit_customer_request, customer_request_status, customer_reply), plus the
// hotel's contact details (public_hotel_contacts, src/lib/hotel-config.ts)
// and the setup status (src/lib/setup.ts). Those
// functions validate input, rate-limit, and return only what the customer may
// see; staff data, item records and matches are never returned here.
import type { Tx } from '@/lib/db/core'
import type { CustomerStatusView } from './types'

export type EnquiryRow = {
  innCode: string
  customerName: string
  bookingRef: string
  itemName: string
  description: string
  category: string | null
  colour: string | null
  brand: string | null
  lostLocation: string | null
  lostDate: string | null
}

export async function submitRequest(tx: Tx, e: EnquiryRow): Promise<string> {
  const r = await tx.rpc<{ submit_customer_request: string }>('submit_customer_request', {
    p_inn_code: e.innCode,
    p_customer_name: e.customerName,
    p_booking_ref: e.bookingRef,
    p_item_name: e.itemName,
    p_description: e.description,
    p_category: e.category,
    p_colour: e.colour,
    p_brand: e.brand,
    p_lost_location: e.lostLocation,
    p_lost_date: e.lostDate,
  })
  return r.rows[0].submit_customer_request
}

export async function requestStatus(tx: Tx, reference: string, bookingRef: string): Promise<CustomerStatusView> {
  const r = await tx.rpc<{ customer_request_status: CustomerStatusView }>('customer_request_status', {
    p_reference: reference,
    p_booking_ref: bookingRef,
  })
  return r.rows[0].customer_request_status
}

export async function reply(tx: Tx, reference: string, bookingRef: string, body: string): Promise<void> {
  await tx.rpc('customer_reply', { p_reference: reference, p_booking_ref: bookingRef, p_body: body })
}

export async function hotels(tx: Tx): Promise<{ inn_code: string; name: string }[]> {
  return (await tx.rpc<{ inn_code: string; name: string }>('public_properties')).rows
}

/**
 * Only messages our database functions wrote for customers (`raise exception`,
 * SQLSTATE P0001) are shown. Anything else (network failures, permission or
 * schema errors) becomes a generic message, so nothing technical leaks.
 */
export function friendly(error: unknown): string {
  const e = error as { code?: string; message?: string }
  if (e?.code === 'P0001' && e.message) return e.message
  return 'Something went wrong on our side. Please try again in a few minutes.'
}
