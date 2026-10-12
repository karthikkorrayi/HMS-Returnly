import Link from 'next/link'
import type { Metadata } from 'next'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import TrackEnquiry from '@/components/enquiry/TrackEnquiry'

export const metadata: Metadata = { title: 'Check an enquiry — Returnly' }

// Public: the reference alone shows nothing; the booking ID must match too.
export default async function TrackPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const ref = (await searchParams).ref
  const initialRef = typeof ref === 'string' && /^LF-[0-9A-F]{5}-[0-9A-F]{5}$/i.test(ref) ? ref.toUpperCase() : ''

  return (
    <div className="overview-shell">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Returnly home" className="flex items-center gap-3">
            <span className="brand-mark"><ReturnlyIcon name="tag" /></span>
            <span className="text-xl font-bold tracking-tight">Returnly</span>
          </Link>
          <Link href="/" className="btn btn-secondary">New enquiry</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-3xl font-bold tracking-tight">Check an enquiry</h1>
        <p className="mt-2 max-w-prose text-muted">
          Enter the reference you were given and your booking ID to see updates and reply to the hotel team.
        </p>
        <div className="mt-6">
          <TrackEnquiry initialRef={initialRef} />
        </div>
      </main>
    </div>
  )
}
