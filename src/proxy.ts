import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  // API routes (Better Auth at /api/auth/*, and any later ones) check the
  // session themselves and must answer 401/403 as JSON, never redirect to /login.
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
