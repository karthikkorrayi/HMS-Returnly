import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { needsSignIn } from '@/lib/sign-in-gate'
import { signInDestination } from '@/lib/sign-in-destination'
import { contentSecurityPolicy, makeNonce } from '@/lib/security-headers'
import { hotelRoute, isStaffPath } from '@/lib/staff-paths'
import { hotelLoginPath } from '@/lib/hotel-login'

// Runs before every page:
// 1. Sends signed-out visitors to /login. This only checks that a Better Auth
//    session cookie is present; it does not touch the database. Pages and
//    server actions check the session and the staff member again.
// 2. Sets the Content Security Policy with a fresh nonce, on the request (so
//    Next.js puts the nonce on its own scripts) and on the response (so the
//    browser enforces it). Every page is rendered per request, as nonces need.
// 3. Each hotel has its own address, the first part of the path
//    (src/lib/staff-paths.ts):
//      /<slug>, /<slug>/found, /<slug>/login → the guest pages in src/app/h/[slug];
//      /<slug>/items… → the /items page, with headers telling it which hotel
//      the address named and the original path. requireSession() compares
//      that with the signed-in person's hotel and sends them to their own if
//      it differs. The headers are only ever set here: any copies sent by the
//      browser are removed first.
//    Old addresses (/h/<slug>/…) are permanently redirected to the new ones.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const route = hotelRoute(pathname)
  if (route?.kind === 'legacy') {
    const url = request.nextUrl.clone()
    url.pathname = route.to
    return NextResponse.redirect(url, 308)
  }
  const hotelPath = route?.kind === 'staff' ? route : null
  const signedIn = Boolean(getSessionCookie(request))

  if (hotelPath && !signedIn) {
    const url = request.nextUrl.clone()
    const login = new URL(hotelLoginPath(hotelPath.slug, { next: signInDestination(hotelPath.path) }), url)
    url.pathname = login.pathname
    url.search = login.search
    return NextResponse.redirect(url)
  }
  if (!route && needsSignIn(pathname) && !signedIn) {
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
  requestHeaders.delete('x-foundora-hotel')
  requestHeaders.delete('x-foundora-path')

  let response: NextResponse
  if (route?.kind === 'guest') {
    const url = request.nextUrl.clone()
    url.pathname = route.internal
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else if (hotelPath) {
    requestHeaders.set('x-foundora-hotel', hotelPath.slug)
    requestHeaders.set('x-foundora-path', hotelPath.path + search)
    const url = request.nextUrl.clone()
    url.pathname = hotelPath.path
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else {
    // An old-style address (/items…): the page moves the person to their hotel's.
    if (isStaffPath(pathname)) requestHeaders.set('x-foundora-path', pathname + search)
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }
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
