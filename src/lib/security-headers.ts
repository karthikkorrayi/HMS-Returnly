// Browser security rules (Phase 6, step 3). Pure functions, no Next.js
// imports, so they can be unit tested.
//
// Two kinds:
//   * fixed headers for every response (next.config.ts), and
//   * a Content Security Policy with a fresh random nonce per page request
//     (src/proxy.ts). Next.js reads the nonce from the request's CSP header
//     and puts it on its own scripts, so only scripts we serve can run: an
//     attacker who manages to inject <script> into a page gets it blocked.

export type CspOptions = {
  /** Fresh, unguessable value for this request (base64). */
  nonce: string
  /** next dev: React needs eval for error overlays; styles are injected inline. */
  dev: boolean
  /** Served over https (staging/production): also upgrade any http sub-request. */
  https: boolean
}

export function contentSecurityPolicy({ nonce, dev, https }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic': scripts loaded by our nonce'd scripts may run; nothing else.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Styles: our own files plus Next.js's nonce'd inline styles. Injected
    // styles cannot run code; dev mode injects many unnamed ones.
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // blob: = preview of a photo chosen on the phone before upload.
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ]
  return directives.join('; ')
}

/** 16 random bytes as base64 (Web Crypto: works in the proxy and in Node). */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** Sent with every response, pages and API alike. */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Browsers must treat files as the type we say (a "photo" can't become a script).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Never shown inside another site's frame (clickjacking). CSP says the same
  // for modern browsers; this covers older ones.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Addresses like /track?ref=… are never sent to other sites.
  { key: 'Referrer-Policy', value: 'same-origin' },
  // The app needs none of these browser features. (Taking a photo uses the
  // phone's own camera app through the file picker, which this does not block.)
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Other sites' windows get no handle on ours.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Only from https pages: always use https for a year. Browsers ignore it on
  // plain http (local testing). No includeSubDomains: we don't own every
  // subdomain of the hotel's or Railway's domain.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
]
