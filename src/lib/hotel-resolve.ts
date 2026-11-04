// Which hotel a guest page is for. Today: the path, foundora.co.uk/h/<slug>.
// Prepared for later: the host, <slug>.foundora.co.uk, once HOTEL_SUBDOMAIN_BASE
// is set (with the wildcard DNS and Railway domain in place). Pages only ever
// call hotelSlugFrom(), so switching to subdomains needs no page changes.
// No Next.js imports, so tests can run it.
import { isValidSlug } from './branding-paths'

export function hotelSlugFrom(input: { host?: string | null; pathname?: string | null; subdomainBase?: string | null }): string | null {
  const base = (input.subdomainBase ?? '').trim().toLowerCase().replace(/^\.+/, '')
  const host = (input.host ?? '').trim().toLowerCase().replace(/:\d+$/, '')
  if (base && host.endsWith('.' + base)) {
    const sub = host.slice(0, -(base.length + 1))
    if (!sub.includes('.') && isValidSlug(sub)) return sub
  }
  const m = /^\/h\/([^/?#]+)/.exec(input.pathname ?? '')
  if (m) {
    const s = decodeURIComponent(m[1]).toLowerCase()
    if (isValidSlug(s)) return s
  }
  return null
}
