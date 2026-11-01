// Which paths a signed-out visitor may open. Used by src/proxy.ts.
// The proxy only looks for a session cookie (a quick, optimistic check);
// pages and server actions verify the session and staff member properly.

// Public: the customer home page, customer enquiry status, staff sign-in, the
// first-time setup page (protected by its own key, and refused by the
// database once setup is done), and API routes (they answer 401/403 as JSON
// themselves, never redirect).
const PUBLIC_PREFIXES = ['/signin', '/login', '/track', '/setup', '/api']

export function needsSignIn(pathname: string): boolean {
  if (pathname === '/') return false
  return !PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}
