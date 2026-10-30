import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import { signInDestination } from '@/lib/sign-in-destination'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import LoginForm from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; setup?: string; u?: string }>
}) {
  const params = await searchParams
  const next = signInDestination(params.next)
  // A brand-new installation has no hotel and no staff yet: set it up first.
  // (If the database can't be asked, show sign-in as usual.)
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  if (await getSession()) redirect(next)
  const setupDone = params.setup === 'done'
  const setupUser = typeof params.u === 'string' && /^[a-z0-9._-]{3,32}$/.test(params.u) ? params.u : null

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-teal">
          <ReturnlyIcon name="arrow" className="rotate-180" />
          Back to overview
        </Link>
        <div className="mb-8">
          <span className="tag tag-lg">Returnly</span>
          <h1 className="mt-5 text-2xl font-bold">Lost property</h1>
          <p className="hint mt-1">
            Sign in with the username your manager gave you.
          </p>
        </div>
        {setupDone && (
          <p role="status" className="mb-4 rounded-lg bg-teal-soft px-3 py-2 text-sm text-teal-dark">
            Setup is complete.{setupUser ? <> Sign in as <strong>{setupUser}</strong>, then add your staff from the Staff page.</> : ' Sign in with the administrator account you created.'}
          </p>
        )}
        <div className="panel p-5"><LoginForm next={next} /></div>
        <p className="hint mt-4">
          Forgotten your password? A manager can reset it.
        </p>
      </div>
    </main>
  )
}
