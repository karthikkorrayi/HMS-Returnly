'use server'

// Customer-facing API (no sign-in). Every call goes to a database function
// that validates input, rate-limits, and returns only what the customer may
// see. Staff data, item records and matches are never returned here.

import { withAnon } from '@/lib/db'
import { friendly, hotels, reply, requestStatus, submitRequest } from './public-queries'
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

  try {
    const reference = await withAnon((tx) =>
      submitRequest(tx, {
        innCode: clean(payload.innCode, 10),
        customerName: name,
        bookingRef: booking,
        itemName,
        description,
        category: optional(payload.category, 40),
        colour: optional(payload.colour, 40),
        brand: optional(payload.brand, 60),
        lostLocation: optional(payload.lostLocation, 80),
        lostDate: lostDate || null,
      })
    )
    return { ok: true, reference }
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
}

export type StatusResult = { ok: true; view: CustomerStatusView } | { ok: false; error: string }

export async function lookupEnquiry(reference: string, bookingRef: string): Promise<StatusResult> {
  const ref = clean(reference, 20).toUpperCase()
  const booking = clean(bookingRef, 40).toUpperCase().replace(/\s+/g, '')
  if (!REF.test(ref) || !/^[A-Z0-9-]{3,32}$/.test(booking)) {
    return { ok: false, error: 'Check the reference (like LF-3FA9C-81D2E) and booking ID.' }
  }
  try {
    return { ok: true, view: await withAnon((tx) => requestStatus(tx, ref, booking)) }
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
}

export async function replyToEnquiry(reference: string, bookingRef: string, body: string): Promise<StatusResult> {
  const text = clean(body, 1000)
  if (!text) return { ok: false, error: 'Write a message first.' }
  try {
    await withAnon((tx) =>
      reply(tx, clean(reference, 20).toUpperCase(), clean(bookingRef, 40).toUpperCase().replace(/\s+/g, ''), text)
    )
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
  return lookupEnquiry(reference, bookingRef)
}

export async function listHotels(): Promise<{ inn_code: string; name: string }[]> {
  try {
    return await withAnon(hotels)
  } catch (e) {
    console.error('public hotel list failed', e)
    return []
  }
}

// Customer-safe message; anything unexpected is logged for staff, not shown.
function logged(e: unknown): string {
  if ((e as { code?: string })?.code !== 'P0001') console.error('public enquiry call failed', e)
  return friendly(e)
}
