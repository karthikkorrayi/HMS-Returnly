import Link from 'next/link'
import type { Metadata } from 'next'
import Brand from '@/components/foundora/Brand'
import ThemeToggle from '@/components/foundora/Theme'
import FoundReportForm from '@/components/enquiry/FoundReportForm'
import { listHotels } from '@/lib/requests/public-actions'
import { hotelToday } from '@/lib/format'

export const metadata: Metadata = { title: 'Hand in a found item — Foundora' }

// Public: someone who found an item at a hotel tells the hotel it's coming.
export default async function FoundPage({ searchParams }: { searchParams: Promise<{ hotel?: string }> }) {
  const raw = (await searchParams).hotel
  const initialHotel = typeof raw === 'string' && /^[A-Z0-9]{3,10}$/i.test(raw) ? raw.toUpperCase() : ''
  const hotels = await listHotels()
  return (
    <div className="overview-shell">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Foundora home" className="flex items-center gap-3">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/" className="btn btn-secondary">Home</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-3xl font-bold tracking-tight">Hand in a found item</h1>
        <p className="mt-2 max-w-prose text-muted">
          Found something at the hotel? Tell the team what it is and where you found it, then hand it in at reception.
        </p>
        <div className="mt-6">
          {hotels.length === 0
            ? <p className="panel p-5">Reports aren’t available right now. Please hand the item in at reception.</p>
            : <FoundReportForm hotels={hotels} today={hotelToday()} initialHotel={initialHotel} />}
        </div>
      </main>
    </div>
  )
}
