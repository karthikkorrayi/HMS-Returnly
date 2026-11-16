// Each hotel has its own address: the first part of the path.
//
//   /<slug>                 the hotel's guest page
//   /<slug>/found           its "hand in a found item" form
//   /<slug>/login           its staff sign-in
//   /<slug>/<module>/…      its staff pages, e.g. /grand/items/123
//
// The pages themselves are the existing ones: the guest pages live in
// src/app/h/[slug]/… and the staff pages in src/app/(app)/<module>. src/proxy.ts
// maps the hotel address onto them (hotelRoute below) and tells staff pages
// which hotel the address named; requireSession() checks it is the signed-in
// person's hotel. The address only chooses the page; access is decided by the
// session and the database.
//
// Addresses from before (/h/<slug>/…, in sent emails, QR codes, bookmarks)
// are permanently redirected to the new ones.
//
// A slug can never be a word the app uses itself (RESERVED_SLUGS, enforced
// in the database too), so /login, /track, /items … are never read as hotels.
// Pure (no Next.js), so the browser and tests can use it.
import { isValidSlug } from './branding-paths'

/** The staff modules (top-level folders of src/app/(app)). */
export const STAFF_MODULES = ['items', 'requests', 'staff', 'settings', 'support', 'account', 'notifications'] as const

const MODULE = new RegExp(`^/(${STAFF_MODULES.join('|')})(/|$)`)

/** The hotel's guest pages, after the slug ('' is the hotel's home page). */
export const HOTEL_GUEST_PAGES = ['', '/found', '/login'] as const
export type HotelGuestPage = (typeof HOTEL_GUEST_PAGES)[number]

/** Is this an internal staff path (/items, /requests/123, …)? */
export function isStaffPath(path: string): boolean {
  return MODULE.test(path)
}

/** /items/123?x=1 → /<slug>/items/123?x=1. Anything else is returned unchanged. */
export function staffPath(slug: string, path: string): string {
  if (!isValidSlug(slug) || !isStaffPath(path)) return path
  return `/${slug}${path}`
}

/** The hotel's guest pages: /<slug>, /<slug>/found, /<slug>/login. */
export function hotelPagePath(slug: string, page: HotelGuestPage = ''): string {
  return `/${encodeURIComponent(slug)}${page}`
}

/** /<slug>/rest → { slug, rest } when the first part is a valid hotel address. */
export function splitHotelAddress(pathname: string): { slug: string; rest: string } | null {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!m || !isValidSlug(m[1])) return null
  return { slug: m[1], rest: m[2] ?? '' }
}

/** /<slug>/items/123 → { slug, path: '/items/123' }; null for any other address. */
export function splitHotelPath(pathname: string): { slug: string; path: string } | null {
  const a = splitHotelAddress(pathname)
  if (!a || !isStaffPath(a.rest)) return null
  return { slug: a.slug, path: a.rest }
}

/** An address from before (/h/<slug>/…) → the same page's address now; null otherwise. */
export function legacyHotelAddress(pathname: string): string | null {
  const m = /^\/h\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!m || !isValidSlug(m[1])) return null
  const rest = m[2] ?? ''
  return `/${m[1]}${rest === '/' ? '' : rest}`
}

/**
 * What src/proxy.ts does with an address:
 *   legacy  → redirect the browser to `to` (old /h/ address);
 *   staff   → staff page `path` of hotel `slug` (needs sign-in);
 *   guest   → show the internal page `internal` (/h/<slug>, …/found, …/login);
 *   null    → not a hotel address: everything else as before.
 */
export type HotelRoute =
  | { kind: 'legacy'; to: string }
  | { kind: 'staff'; slug: string; path: string }
  | { kind: 'guest'; slug: string; internal: string }
  | null

export function hotelRoute(pathname: string): HotelRoute {
  const legacy = legacyHotelAddress(pathname)
  if (legacy) return { kind: 'legacy', to: legacy }
  const a = splitHotelAddress(pathname)
  if (!a) return null
  if (isStaffPath(a.rest)) return { kind: 'staff', slug: a.slug, path: a.rest }
  const page = a.rest === '/' ? '' : a.rest
  if ((HOTEL_GUEST_PAGES as readonly string[]).includes(page)) return { kind: 'guest', slug: a.slug, internal: `/h/${a.slug}${page}` }
  return null
}

/** The page path without the hotel part, for "which menu item is active". */
export function withoutHotel(pathname: string): string {
  return splitHotelPath(pathname)?.path ?? pathname
}

/** Staff pages and staff sign-in: no guest support button there. */
export function isStaffPage(path: string): boolean {
  if (/^\/(items|staff|settings|requests|support|account|notifications|login|signin|setup)(\/|$)/.test(path)) return true
  const a = splitHotelAddress(path)
  return Boolean(a && (isStaffPath(a.rest) || a.rest === '/login' || a.rest.startsWith('/login?')))
}
