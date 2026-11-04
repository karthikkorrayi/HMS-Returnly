import { notFound, redirect } from 'next/navigation'
import { connection } from 'next/server'
import type { Metadata } from 'next'
import { withAnon } from '@/lib/db'
import { isSetUp } from '@/lib/setup'
import { listHotels } from '@/lib/requests/public-actions'
import { hotelSlugFrom } from '@/lib/hotel-resolve'
import GuestHome from '@/components/foundora/GuestHome'
import SelectHotel from '@/components/foundora/SelectHotel'

// A hotel's own address: foundora.co.uk/h/<slug>. Same guest page as the home
// page, with the hotel already chosen. (Later <slug>.foundora.co.uk can show
// this page too; hotelSlugFrom() already understands both.)
async function hotelFor(slugParam: string) {
  const slug = hotelSlugFrom({ pathname: `/h/${slugParam}` })
  if (!slug) return null
  return (await listHotels()).find((h) => h.slug === slug) ?? null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const hotel = await hotelFor((await params).slug)
  return { title: hotel ? `${hotel.name} — Lost & found` : 'Foundora' }
}

export default async function HotelHome({ params }: { params: Promise<{ slug: string }> }) {
  await connection()
  if ((await isSetUp(withAnon).catch(() => true)) === false) redirect('/setup')
  const hotel = await hotelFor((await params).slug)
  if (!hotel) notFound()
  return (
    <>
      <SelectHotel code={hotel.inn_code} />
      <GuestHome />
    </>
  )
}
