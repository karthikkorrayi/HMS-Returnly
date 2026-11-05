import SelectHotel from '@/components/foundora/SelectHotel'
import type { Metadata } from 'next'
import GuestHeader from '@/components/foundora/GuestHeader'
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
      {hotels.some((h) => h.inn_code === initialHotel) && <SelectHotel code={initialHotel} />}
      <GuestHeader />
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
