import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { needsSignIn } from '@/lib/sign-in-gate'
import { signInDestination } from '@/lib/sign-in-destination'
import { contentSecurityPolicy, makeNonce } from '@/lib/security-headers'

// Runs before every page:
// 1. Sends signed-out visitors to /login. This only checks that a Better Auth
//    session cookie is present; it does not touch the database. Pages and
//    server actions check the session and the staff member again.
// 2. Sets the Content Security Policy with a fresh nonce, on the request (so
//    Next.js puts the nonce on its own scripts) and on the response (so the
//    browser enforces it). Every page is rendered per request, as nonces need.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (needsSignIn(pathname) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', signInDestination(pathname))
    return NextResponse.redirect(url)
  }

  const csp = contentSecurityPolicy({
    nonce: makeNonce(),
    dev: process.env.NODE_ENV === 'development',
    https: (process.env.BETTER_AUTH_URL ?? '').startsWith('https://'),
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('content-security-policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    // API routes check the session themselves (and must not have photo uploads
    // buffered by the proxy), so they are left out entirely.
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
