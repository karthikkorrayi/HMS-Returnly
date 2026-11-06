import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getSession, homeFor } from '@/lib/auth'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import { signInDestination } from '@/lib/sign-in-destination'
import { hotelSlugFrom } from '@/lib/hotel-resolve'
import { staffPath } from '@/lib/staff-paths'
import { listHotels } from '@/lib/requests/public-actions'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import AuthFrame from '@/components/workspace/AuthFrame'
import LoginForm from '@/app/login/LoginForm'

// Staff sign-in for one hotel: /h/<slug>/login. Only that hotel's staff can
// sign in here (checked after the password, in finishSignIn); everyone else
// gets "Username or password is incorrect".
async function hotelFor(param: string) {
  const slug = hotelSlugFrom({ pathname: `/h/${param}` })
  return slug ? (await listHotels()).find((h) => h.slug === slug) ?? null : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const hotel = await hotelFor((await params).slug)
  return { title: hotel ? `Staff sign in — ${hotel.name}` : 'Staff sign in — Foundora' }
}

export default async function HotelLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ next?: string; setup?: string; u?: string }>
}) {
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  const hotel = await hotelFor((await params).slug)
  if (!hotel) notFound()
  const q = await searchParams
  const next = signInDestination(q.next)
  const session = await getSession()
  // Already signed in: at this hotel → carry on; at another → their own home.
  if (session) {
    redirect(session.property.slug === hotel.slug ? staffPath(hotel.slug, next) : homeFor(session.staff.role, session.property.slug))
  }
  const setupUser = typeof q.u === 'string' && /^[a-z0-9._-]{3,32}$/.test(q.u) ? q.u : null

  return (
    <AuthFrame hotel={hotel}>
      <div className="w-full max-w-sm">
        <Link href={`/h/${hotel.slug}`} className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-teal">
          <ReturnlyIcon name="arrow" className="rotate-180" />
          {hotel.name} guest page
        </Link>
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Staff sign in</h1>
          <p className="hint mt-2">Sign in with the username your manager gave you.</p>
        </div>
        {q.setup === 'done' && (
          <p role="status" className="mb-4 rounded-lg bg-teal-soft px-3 py-2 text-sm text-teal-dark">
            Setup is complete.
            {setupUser ? <> Sign in as <strong>{setupUser}</strong>, then add your staff from the Staff page.</> : ' Sign in with the administrator account you created.'}
          </p>
        )}
        <div className="panel p-5">
          <LoginForm next={next} hotel={hotel.slug} />
        </div>
        <p className="hint mt-4">Forgotten your password? A manager can reset it.</p>
      </div>
    </AuthFrame>
  )
}
