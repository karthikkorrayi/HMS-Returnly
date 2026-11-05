'use server'

import { redirect } from 'next/navigation'
import { signInDestination } from '@/lib/sign-in-destination'
import { currentLogin, endCurrentSession, getSession } from '@/lib/auth'
import { findHotel, hotelLoginPath, signedInAtOwnHotel } from '@/lib/hotel-login'
import { staffPath } from '@/lib/staff-paths'
import { listHotels } from '@/lib/requests/public-actions'
import type { ActionState } from '@/lib/types'

// Step 2 of signing in. Step 1 is the browser posting the username and
// password to Better Auth (/api/auth/sign-in/username), so its rate limit and
// our cross-site check apply. Here we only check the new session belongs to
// an ACTIVE staff member; if not, the session is ended straight away.
//
// Staff sign in on their hotel's own page (/h/<slug>/login). An account of
// another hotel is refused with the same message as a wrong password, so the
// page can't be used to find out which hotel an account belongs to, and the
// session that was just opened is ended at once.
export async function finishSignIn(next: unknown, hotel: unknown): Promise<ActionState> {
  if (!(await currentLogin())) {
    return { error: 'Sign-in did not complete. Please try again.' }
  }
  const session = await getSession()
  if (!session) {
    await endCurrentSession()
    return { error: 'This account is not active. Ask a manager.' }
  }
  if (!signedInAtOwnHotel(session.property.slug, hotel)) {
    await endCurrentSession()
    return { error: 'Username or password is incorrect.' }
  }
  redirect(staffPath(session.property.slug, signInDestination(next)))
}

// The root /login page: "Enter your hotel code" → that hotel's sign-in page.
export async function goToHotelLogin(_p: ActionState, f: FormData): Promise<ActionState> {
  const hotel = findHotel(await listHotels(), String(f.get('hotel') ?? ''))
  if (!hotel) return { error: 'No hotel has that code. Check the code your manager gave you.' }
  redirect(hotelLoginPath(hotel.slug, { next: String(f.get('next') ?? '') || null }))
}
