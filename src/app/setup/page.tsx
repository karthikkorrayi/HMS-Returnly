import Link from 'next/link'
import { connection } from 'next/server'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import { withAnon } from '@/lib/db'
import { DEFAULT_AREAS, DEFAULT_STORAGE, isSetUp, setupTokenConfigured } from '@/lib/setup'
import SetupForm from './SetupForm'

export const metadata = { title: 'Set up — Returnly' }

// First-time setup. Offered only while this installation's database has no
// hotel; afterwards this page only says so. Protected by SETUP_TOKEN.
export default async function SetupPage() {
  await connection()
  let done: boolean | null
  try {
    done = await isSetUp(withAnon)
  } catch (e) {
    console.error('setup status check failed', e)
    done = null
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <span className="brand-mark"><ReturnlyIcon name="tag" /></span>
        <div>
          <h1 className="text-2xl font-bold">Set up Returnly</h1>
          <p className="hint">First-time setup for this hotel’s installation.</p>
        </div>
      </div>

      {done === null ? (
        <div className="panel p-5">
          <p className="font-semibold">The database can’t be reached right now.</p>
          <p className="hint mt-1">Nothing was changed. Try again in a minute; if it keeps happening, check the server’s health page.</p>
        </div>
      ) : done ? (
        <div className="panel p-5">
          <p className="font-semibold">This hotel is already set up.</p>
          <p className="hint mt-1">Setup only runs once. Administrators change hotel details, rooms, areas and staff from the app.</p>
          <Link href="/login" className="btn btn-primary mt-4">Go to sign-in</Link>
        </div>
      ) : !setupTokenConfigured(process.env.SETUP_TOKEN) ? (
        <div className="panel p-5">
          <p className="font-semibold">Setup is locked.</p>
          <p className="hint mt-1">
            To set up this installation, the server needs a one-time setup key: add a variable named SETUP_TOKEN
            (at least 24 random characters) to the server’s settings, redeploy, and open this page again.
          </p>
        </div>
      ) : (
        <SetupForm defaultAreas={DEFAULT_AREAS} defaultStorage={DEFAULT_STORAGE} />
      )}
    </main>
  )
}
