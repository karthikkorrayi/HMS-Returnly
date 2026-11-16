import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import type { Metadata } from 'next'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import Brand from '@/components/foundora/Brand'
import ThemeToggle from '@/components/foundora/Theme'
import ReturnlyIcon from '@/components/ReturnlyIcon'

export const metadata: Metadata = { title: 'Foundora — Hotel lost & found' }

// The root address is a short guidance page only: it lists no hotels and
// sends nothing. Each hotel has its own address (/<hotel>), which guests get
// from the hotel (link, QR code, email). Foundora's own website lives
// elsewhere. A new installation still opens the setup screen from here.
export default async function Home() {
  await connection()
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  return (
    <div className="overview-shell">
      <header className="guest-header">
        <div className="guest-hotel-identity"><Brand /></div>
        <div className="guest-header-actions"><ThemeToggle /></div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight">Hotel lost &amp; found</h1>
        <p className="mt-3 max-w-prose text-muted">
          Foundora helps hotels look after lost property and keep guests informed. Every hotel has its own page on this site.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <section className="panel p-5" aria-labelledby="guide-guests">
            <h2 id="guide-guests" className="text-lg font-semibold">Lost something?</h2>
            <p className="hint mt-2">
              Use the link or QR code from your hotel — its address looks like <span className="font-semibold">/your-hotel</span>. There you can report a lost item or hand in a found one.
            </p>
          </section>
          <section className="panel p-5" aria-labelledby="guide-track">
            <h2 id="guide-track" className="text-lg font-semibold">Already reported?</h2>
            <p className="hint mt-2">Open the tracking link in your email, or check with your reference and booking ID.</p>
            <Link href="/track" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-teal">
              Track a report <ReturnlyIcon name="arrow" />
            </Link>
          </section>
          <section className="panel p-5" aria-labelledby="guide-staff">
            <h2 id="guide-staff" className="text-lg font-semibold">Hotel staff</h2>
            <p className="hint mt-2">Sign in on your hotel’s page. Your manager can give you the address or the hotel code.</p>
            <Link href="/login" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-teal">
              Staff sign in <ReturnlyIcon name="arrow" />
            </Link>
          </section>
        </div>
        <p className="hint mt-10">Foundora · Lost &amp; Found, Made Simple. Personal details are only ever shared with the hotel you contact.</p>
      </main>
    </div>
  )
}
