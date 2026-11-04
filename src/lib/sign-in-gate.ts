// Which paths a signed-out visitor may open. Used by src/proxy.ts.
// The proxy only looks for a session cookie (a quick, optimistic check);
// pages and server actions verify the session and staff member properly.

// Public: the customer home page, a hotel's own page (/h/<slug>), its logo
// (/brand/<slug>/logo), report status (/track), the found-item form
// (/found), staff sign-in, the first-time setup page (protected by its own key, and refused by the
// database once setup is done), and API routes (they answer 401/403 as JSON
// themselves, never redirect).
const PUBLIC_PREFIXES = ['/signin', '/login', '/track', '/found', '/h', '/brand', '/setup', '/api']

export function needsSignIn(pathname: string): boolean {
  if (pathname === '/') return false
  return !PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}
