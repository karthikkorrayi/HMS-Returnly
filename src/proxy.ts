import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { needsSignIn } from '@/lib/sign-in-gate'
import { signInDestination } from '@/lib/sign-in-destination'

// Sends signed-out visitors to /login. This only checks that a Better Auth
// session cookie is present; it does not touch the database. Pages and server
// actions check the session and the staff member again before doing anything.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (!needsSignIn(pathname) || getSessionCookie(request)) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', signInDestination(pathname))
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    // API routes check the session themselves (and must not have photo uploads
    // buffered by the proxy), so they are left out entirely.
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
