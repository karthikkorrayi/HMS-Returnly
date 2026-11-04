// The pure parts of hotel branding, safe to use in the browser: the rules
// for a hotel's web address (slug) and the public address of its logo.
// Server-side branding (database, storage) is in branding.ts.

const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/
// Same list as public._valid_slug() (migration 019).
export const RESERVED_SLUGS = ['www', 'app', 'api', 'admin', 'notify', 'mail', 'news', 'staging', 'status', 'h',
  'found', 'track', 'login', 'signin', 'setup', 'brand', 'help', 'support', 'foundora']

export function isValidSlug(s: string): boolean {
  return SLUG.test(s) && !s.includes('--') && !RESERVED_SLUGS.includes(s)
}

/** Public address of a hotel's logo (the version makes caches pick up a new one). */
export function logoPath(slug: string, version: number): string {
  return `/brand/${encodeURIComponent(slug)}/logo?v=${version}`
}
