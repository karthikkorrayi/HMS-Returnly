// Which paths a signed-out visitor may open. Used by src/proxy.ts.
// The proxy only looks for a session cookie (a quick, optimistic check);
// pages and server actions verify the session and staff member properly.

// Public: the customer home page, customer enquiry status, staff sign-in, and
// API routes (they answer 401/403 as JSON themselves, never redirect).
const PUBLIC_PREFIXES = ['/login', '/track', '/api']

export function needsSignIn(pathname: string): boolean {
  if (pathname === '/') return false
  return !PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}
