import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { signInDestination } from '@/lib/sign-in-destination'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import LoginForm from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = signInDestination((await searchParams).next)
  if (await getSession()) redirect(next)

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
        <div className="panel p-5"><LoginForm next={next} /></div>
        <p className="hint mt-4">
          Forgotten your password? A manager can reset it.
        </p>
      </div>
    </main>
  )
}
