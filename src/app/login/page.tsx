import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import { signInDestination } from '@/lib/sign-in-destination'
import { hotelLoginPath } from '@/lib/hotel-login'
import { staffPath } from '@/lib/staff-paths'
import { listHotels } from '@/lib/requests/public-actions'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import Brand from '@/components/foundora/Brand'
import ThemeToggle from '@/components/foundora/Theme'
import HotelFinder from './HotelFinder'

// Staff sign-in is on each hotel's own page, /h/<code>/login. This page only
// finds it: with one hotel it goes straight there; otherwise it asks for the
// hotel code. Old bookmarks of /login (and /signin) keep working.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; setup?: string; u?: string }>
}) {
  const params = await searchParams
  const next = signInDestination(params.next)
  // A brand-new installation has no hotel and no staff yet: set it up first.
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  const session = await getSession()
  if (session) redirect(staffPath(session.property.slug, next))
  const hotels = await listHotels()
  if (hotels.length === 1) redirect(hotelLoginPath(hotels[0].slug, { next: params.next ?? null, setup: params.setup ?? null, u: params.u ?? null }))

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-teal">
          <ReturnlyIcon name="arrow" className="rotate-180" />
          Back to overview
        </Link>
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3">
            <Brand />
            <ThemeToggle />
          </div>
          <h1 className="mt-5 text-2xl font-bold">Staff sign in</h1>
          <p className="hint mt-1">Enter your hotel’s code to go to its sign-in page.</p>
        </div>
        <div className="panel p-5">
          <HotelFinder next={next} />
        </div>
      </div>
    </main>
  )
}
