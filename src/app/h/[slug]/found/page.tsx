import { notFound, redirect } from 'next/navigation'
import { listHotels } from '@/lib/requests/public-actions'
import { hotelSlugFrom } from '@/lib/hotel-resolve'

// foundora.co.uk/h/<slug>/found → the found-item form with the hotel chosen.
export default async function HotelFound({ params }: { params: Promise<{ slug: string }> }) {
  const slug = hotelSlugFrom({ pathname: `/h/${(await params).slug}` })
  const hotel = slug ? (await listHotels()).find((h) => h.slug === slug) : null
  if (!hotel) notFound()
  redirect(`/found?hotel=${encodeURIComponent(hotel.inn_code)}`)
}
