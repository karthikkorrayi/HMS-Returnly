'use server'

import { redirect } from 'next/navigation'
import { endCurrentSession } from '@/lib/auth'

export async function signOut() {
  await endCurrentSession()
  redirect('/login')
}
