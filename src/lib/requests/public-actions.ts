'use server'

// Customer-facing API (no sign-in). Every call goes to a database function
// that validates input, rate-limits, and returns only what the customer may
// see. Staff data, item records and matches are never returned here.

import { createClient } from '@/lib/supabase/server'
import type { CustomerStatusView, EnquiryPayload } from './types'

const REF = /^LF-[0-9A-F]{5}-[0-9A-F]{5}$/
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const optional = (v: unknown, max: number) => clean(v, max) || null

export type SubmitResult = { ok: true; reference: string } | { ok: false; error: string }

export async function submitEnquiry(payload: EnquiryPayload): Promise<SubmitResult> {
  const name = clean(payload.customerName, 80)
  const booking = clean(payload.bookingRef, 40).toUpperCase().replace(/\s+/g, '')
  const itemName = clean(payload.itemName, 80)
  const description = clean(payload.description, 1000)
  const lostDate = clean(payload.lostDate, 10)

  if (name.length < 2) return { ok: false, error: 'Enter your name as it appears on the booking.' }
  if (!/^[A-Z0-9-]{3,32}$/.test(booking)) return { ok: false, error: 'Enter the booking ID from your confirmation email.' }
  if (itemName.length < 2) return { ok: false, error: 'Say what the item is.' }
  if (description.length < 3) return { ok: false, error: 'Describe the item.' }
  if (lostDate && !/^\d{4}-\d{2}-\d{2}$/.test(lostDate)) return { ok: false, error: 'The date is not valid.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_customer_request', {
    p_inn_code: clean(payload.innCode, 10),
    p_customer_name: name,
    p_booking_ref: booking,
    p_item_name: itemName,
    p_description: description,
    p_category: optional(payload.category, 40),
    p_colour: optional(payload.colour, 40),
    p_brand: optional(payload.brand, 60),
    p_lost_location: optional(payload.lostLocation, 80),
    p_lost_date: lostDate || null,
  })
  if (error) return { ok: false, error: friendly(error) }
  return { ok: true, reference: data as string }
}

export type StatusResult = { ok: true; view: CustomerStatusView } | { ok: false; error: string }

export async function lookupEnquiry(reference: string, bookingRef: string): Promise<StatusResult> {
  const ref = clean(reference, 20).toUpperCase()
  const booking = clean(bookingRef, 40).toUpperCase().replace(/\s+/g, '')
  if (!REF.test(ref) || !/^[A-Z0-9-]{3,32}$/.test(booking)) {
    return { ok: false, error: 'Check the reference (like LF-3FA9C-81D2E) and booking ID.' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('customer_request_status', { p_reference: ref, p_booking_ref: booking })
  if (error) return { ok: false, error: friendly(error) }
  return { ok: true, view: data as CustomerStatusView }
}

export async function replyToEnquiry(reference: string, bookingRef: string, body: string): Promise<StatusResult> {
  const text = clean(body, 1000)
  if (!text) return { ok: false, error: 'Write a message first.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('customer_reply', {
    p_reference: clean(reference, 20).toUpperCase(),
    p_booking_ref: clean(bookingRef, 40).toUpperCase().replace(/\s+/g, ''),
    p_body: text,
  })
  if (error) return { ok: false, error: friendly(error) }
  return lookupEnquiry(reference, bookingRef)
}

export async function listHotels(): Promise<{ inn_code: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('public_properties')
  return (data ?? []) as { inn_code: string; name: string }[]
}

// Only messages our database functions wrote for customers (`raise exception`,
// SQLSTATE P0001) are shown. Anything else — network failures, permission or
// schema errors — becomes a generic message, so nothing technical leaks.
function friendly(error: { code?: string; message: string }) {
  if (error.code === 'P0001' && error.message) return error.message
  return 'Something went wrong on our side. Please try again in a few minutes.'
}
