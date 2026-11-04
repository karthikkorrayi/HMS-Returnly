// Staff pages live at /h/<slug>/<module>…, e.g. /h/grand/items/123. The pages
// themselves are the existing ones (/items, /requests, …): src/proxy.ts maps
// the hotel address onto them and tells the page which hotel the address
// named, and requireSession() checks it is the signed-in person's hotel.
// The address only chooses the page; access is decided by the session and
// the database. Pure (no Next.js), so the browser and tests can use it.
import { isValidSlug } from './branding-paths'

/** The staff modules (top-level folders of src/app/(app)). */
export const STAFF_MODULES = ['items', 'requests', 'staff', 'settings', 'support', 'account', 'notifications'] as const

const MODULE = new RegExp(`^/(${STAFF_MODULES.join('|')})(/|$)`)

/** Is this an internal staff path (/items, /requests/123, …)? */
export function isStaffPath(path: string): boolean {
  return MODULE.test(path)
}

/** /items/123?x=1 → /h/<slug>/items/123?x=1. Anything else is returned unchanged. */
export function staffPath(slug: string, path: string): string {
  if (!isValidSlug(slug) || !isStaffPath(path)) return path
  return `/h/${slug}${path}`
}

/** /h/<slug>/items/123 → { slug, path: '/items/123' }; null for any other address. */
export function splitHotelPath(pathname: string): { slug: string; path: string } | null {
  const m = /^\/h\/([^/]+)(\/.*)$/.exec(pathname)
  if (!m || !isValidSlug(m[1]) || !isStaffPath(m[2])) return null
  return { slug: m[1], path: m[2] }
}

/** The page path without the hotel part, for "which menu item is active". */
export function withoutHotel(pathname: string): string {
  return splitHotelPath(pathname)?.path ?? pathname
}

/** Staff pages and staff sign-in: no guest support button there. */
export function isStaffPage(path: string): boolean {
  return /^\/(items|staff|settings|requests|support|account|notifications|login|signin|setup)(\/|$)/.test(path)
    || /^\/h\/[^/]+\/(login|items|staff|settings|requests|support|account|notifications)(\/|$)/.test(path)
}
