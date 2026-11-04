// Staff sign-in is per hotel: /h/<slug>/login. These helpers are pure (no
// Next.js), so tests can run them.
import { isValidSlug } from './branding-paths'

type HotelRef = { inn_code: string; slug: string }

/** /h/<slug>/login, keeping only the query values the sign-in page uses. */
export function hotelLoginPath(slug: string, params: { next?: string | null; setup?: string | null; u?: string | null } = {}): string {
  const q = new URLSearchParams()
  if (params.next && /^\/[a-z/-]{1,40}$/.test(params.next)) q.set('next', params.next)
  if (params.setup === 'done') q.set('setup', 'done')
  if (params.u && /^[a-z0-9._-]{3,32}$/.test(params.u)) q.set('u', params.u)
  const qs = q.toString()
  return `/h/${encodeURIComponent(slug)}/login${qs ? `?${qs}` : ''}`
}

/** "KK1469", "kk1469" or the hotel's address → that hotel, or null. */
export function findHotel<T extends HotelRef>(hotels: T[], input: string): T | null {
  const v = input.trim()
  if (!v || v.length > 40) return null
  const lower = v.toLowerCase()
  return hotels.find((h) => h.slug === lower) ?? hotels.find((h) => h.inn_code === v.toUpperCase()) ?? null
}

/** Did this person sign in on their own hotel's page? (Checked after the password.) */
export function signedInAtOwnHotel(sessionSlug: string, pageSlug: unknown): boolean {
  return typeof pageSlug === 'string' && isValidSlug(pageSlug) && pageSlug === sessionSlug
}
