'use server'

import { redirect } from 'next/navigation'
import { endCurrentSession, getSession } from '@/lib/auth'
import { hotelLoginPath } from '@/lib/hotel-login'

// Back to the hotel's own sign-in page.
export async function signOut() {
  const session = await getSession()
  await endCurrentSession()
  redirect(session ? hotelLoginPath(session.property.slug) : '/login')
}
