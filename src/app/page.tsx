import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import GuestHome from '@/components/foundora/GuestHome'

export default async function Home() {
  await connection()
  // Keep Railway's first-install behavior and fail-safe unavailable state.
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  return <GuestHome />
}
