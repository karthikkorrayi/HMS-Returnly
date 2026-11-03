import Link from 'next/link'
import type { Metadata } from 'next'
import Brand from '@/components/foundora/Brand'
import ThemeToggle from '@/components/foundora/Theme'
import TrackEnquiry from '@/components/enquiry/TrackEnquiry'

export const metadata: Metadata = { title: 'Check a report — Foundora' }

// Public: the reference alone shows nothing; it needs the booking ID too, or
// the private tracking link's token (read in the browser from after '#').
export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const ref = (await searchParams).ref
  const initialRef =
    typeof ref === 'string' && /^LF-[0-9A-F]{5}-[0-9A-F]{5}$/i.test(ref)
      ? ref.toUpperCase()
      : ''

  return (
    <div className="overview-shell">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link
            href="/"
            aria-label="Foundora home"
            className="flex items-center gap-3"
          >
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/" className="btn btn-secondary">
              New enquiry
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-3xl font-bold tracking-tight">Check a report</h1>
        <p className="mt-2 max-w-prose text-muted">
          Open the private tracking link you were given, or enter your reference
          and booking ID, to see updates and reply to the hotel team.
        </p>
        <div className="mt-6">
          <TrackEnquiry initialRef={initialRef} />
        </div>
      </main>
    </div>
  )
}
