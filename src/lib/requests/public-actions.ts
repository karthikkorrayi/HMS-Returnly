'use server'

// Customer-facing API (no sign-in). Every call goes to a database function
// that validates input, rate-limits, and returns only what the customer may
// see. Staff data, item records and matches are never returned here.
// On top of the database's per-booking/per-email/per-hotel limits, each
// visitor is limited per hour (src/lib/rate-limit.ts, migration 015).
//
// Two ways to follow a report:
//   * reference + booking ID (lost reports, as before);
//   * the tracking link: reference + a one-time token (lost and found
//     reports, migration 016). The token travels after '#' in the link, so it
//     is sent here by the page, never in a URL the server logs.

import { headers } from 'next/headers'
import { withAnon } from '@/lib/db'
import { allow, clientIp, rateKey, TOO_MANY, type RateBucket } from '@/lib/rate-limit'
import { isValidEmail, normaliseEmail } from './email'
import { friendly, hotels, type PublicHotelRow, reply, reportReply, reportStatus, requestStatus, submitReport as insertReport } from './public-queries'
import type { CustomerStatusView, FoundWhereabouts, ReportPayload } from './types'

const REF = /^LF-[0-9A-F]{5}-[0-9A-F]{5}$/
const TOKEN = /^[0-9a-f]{64}$/
const WHEREABOUTS: FoundWhereabouts[] = ['handed_in', 'with_finder', 'left_in_place']
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const optional = (v: unknown, max: number) => clean(v, max) || null
const bookingOf = (v: unknown) => clean(v, 40).toUpperCase().replace(/\s+/g, '')

/**
 * One hit for this visitor in its own transaction, BEFORE the action: a lookup
 * that fails (and rolls back) still counts. Returns an error message when the
 * visitor is over the limit, or null to go ahead.
 */
let warnedNoIp = false
async function overLimit(bucket: RateBucket): Promise<string | null> {
  try {
    const ip = clientIp(await headers())
    if (ip === 'unknown' && process.env.RAILWAY_ENVIRONMENT && !warnedNoIp) {
      // On Railway the edge always sets the header; without it every visitor
      // would share one limit. Logged once per server start (no visitor data).
      warnedNoIp = true
      console.warn(`rate limit: no visitor IP in the ${process.env.AUTH_IP_HEADER || 'x-real-ip'} header; all visitors share one limit. Check AUTH_IP_HEADER.`)
    }
    const key = rateKey(bucket, ip)
    return (await withAnon((tx) => allow(tx, bucket, key))) ? null : TOO_MANY[bucket]
  } catch (e) {
    console.error('rate limit check failed', (e as { code?: string })?.code ?? (e as Error)?.message)
    return friendly(e)
  }
}

export type SubmitResult = { ok: true; reference: string; token: string } | { ok: false; error: string }

/** A lost or found report. Checks here give quick messages; the database checks again. */
export async function submitReport(payload: ReportPayload): Promise<SubmitResult> {
  const type = payload.reportType === 'found' ? 'found' : payload.reportType === 'lost' ? 'lost' : null
  const email = normaliseEmail(payload.email)
  const itemName = clean(payload.itemName, 80)
  const description = clean(payload.description, 1000)
  const date = clean(payload.date, 10)

  if (!type) return { ok: false, error: 'Choose whether you lost or found an item.' }
  if (!isValidEmail(email)) return { ok: false, error: 'Enter a valid email address.' }
  if (payload.emailConfirmed !== true) return { ok: false, error: 'Please confirm your email address.' }
  if (itemName.length < 2) return { ok: false, error: 'Say what the item is.' }
  if (type === 'lost' && description.length < 3) return { ok: false, error: 'Describe the item.' }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'The date is not valid.' }

  let customerName: string | null = null
  let bookingRef: string | null = null
  let whereabouts: FoundWhereabouts | null = null
  if (type === 'lost') {
    customerName = clean(payload.customerName, 80)
    bookingRef = bookingOf(payload.bookingRef)
    if (customerName.length < 2) return { ok: false, error: 'Enter your name as it appears on the booking.' }
    if (!/^[A-Z0-9-]{3,32}$/.test(bookingRef)) return { ok: false, error: 'Enter the booking ID from your confirmation email.' }
  } else {
    whereabouts = WHEREABOUTS.includes(payload.whereabouts as FoundWhereabouts) ? (payload.whereabouts as FoundWhereabouts) : null
    if (!whereabouts) return { ok: false, error: 'Say where the item is now.' }
  }

  const limited = await overLimit('submit')
  if (limited) return { ok: false, error: limited }
  try {
    const r = await withAnon((tx) =>
      insertReport(tx, {
        innCode: clean(payload.innCode, 10),
        reportType: type,
        email,
        emailConfirmed: true,
        itemName,
        description,
        category: optional(payload.category, 40),
        colour: type === 'lost' ? optional(payload.colour, 40) : null,
        brand: type === 'lost' ? optional(payload.brand, 60) : null,
        location: optional(payload.location, 80),
        date: date || null,
        customerName,
        bookingRef,
        whereabouts,
      })
    )
    return { ok: true, reference: r.reference, token: r.token }
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
}
export type StatusResult = { ok: true; view: CustomerStatusView } | { ok: false; error: string }

/** Reference + booking ID (lost reports). */
export async function lookupEnquiry(reference: string, bookingRef: string): Promise<StatusResult> {
  const ref = clean(reference, 20).toUpperCase()
  const booking = bookingOf(bookingRef)
  if (!REF.test(ref) || !/^[A-Z0-9-]{3,32}$/.test(booking)) {
    return { ok: false, error: 'Check the reference (like LF-3FA9C-81D2E) and booking ID.' }
  }
  const limited = await overLimit('lookup')
  if (limited) return { ok: false, error: limited }
  return viewByBooking(ref, booking)
}

/** Tracking link: reference + token. Same message for a wrong or expired link. */
export async function lookupByLink(reference: string, token: string): Promise<StatusResult> {
  const ref = clean(reference, 20).toUpperCase()
  const t = clean(token, 64).toLowerCase()
  if (!REF.test(ref) || !TOKEN.test(t)) return { ok: false, error: 'This tracking link is not valid or has expired.' }
  const limited = await overLimit('lookup')
  if (limited) return { ok: false, error: limited }
  return viewByLink(ref, t)
}

async function viewByBooking(ref: string, booking: string): Promise<StatusResult> {
  try {
    return { ok: true, view: await withAnon((tx) => requestStatus(tx, ref, booking)) }
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
}

async function viewByLink(ref: string, token: string): Promise<StatusResult> {
  try {
    return { ok: true, view: await withAnon((tx) => reportStatus(tx, ref, token)) }
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
}

export async function replyToEnquiry(reference: string, bookingRef: string, body: string): Promise<StatusResult> {
  const text = clean(body, 1000)
  if (!text) return { ok: false, error: 'Write a message first.' }
  const ref = clean(reference, 20).toUpperCase()
  const booking = bookingOf(bookingRef)
  const limited = await overLimit('reply')
  if (limited) return { ok: false, error: limited }
  try {
    await withAnon((tx) => reply(tx, ref, booking, text))
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
  // The refreshed view after a reply is not counted as a separate status check.
  return viewByBooking(ref, booking)
}

export async function replyByLink(reference: string, token: string, body: string): Promise<StatusResult> {
  const text = clean(body, 1000)
  if (!text) return { ok: false, error: 'Write a message first.' }
  const ref = clean(reference, 20).toUpperCase()
  const t = clean(token, 64).toLowerCase()
  if (!REF.test(ref) || !TOKEN.test(t)) return { ok: false, error: 'This tracking link is not valid or has expired.' }
  const limited = await overLimit('reply')
  if (limited) return { ok: false, error: limited }
  try {
    await withAnon((tx) => reportReply(tx, ref, t, text))
  } catch (e) {
    return { ok: false, error: logged(e) }
  }
  return viewByLink(ref, t)
}

export async function listHotels(): Promise<PublicHotelRow[]> {
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
