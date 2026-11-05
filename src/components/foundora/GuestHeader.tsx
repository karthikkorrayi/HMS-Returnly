'use client'
import Link from 'next/link'
import Brand from './Brand'
import ThemeToggle from './Theme'
import HotelLogo from './HotelLogo'
import { useGuestExperience } from './GuestExperience'
export default function GuestHeader({ allowHotelSelection = false }: { allowHotelSelection?: boolean }) {
  const { hotels, hotel, selectHotel } = useGuestExperience()
  return (
      <header className="guest-header">
        <div className="guest-hotel-identity">
          {hotel?.has_logo && hotel.slug && <HotelLogo slug={hotel.slug} version={hotel.logo_version ?? 0} name={hotel.name} />}
          <span className="hotel-header-name">{hotel?.name ?? 'Hotel lost & found'}</span>
        </div>
        <div className="guest-header-actions">
          {allowHotelSelection && hotels.length > 1 ? (
            <div className="hotel-picker">
              <label className="sr-only" htmlFor="guest-header-hotel">
                Your hotel
              </label>
              <select
                id="guest-header-hotel"
                className="field"
                value={hotel?.inn_code ?? ''}
                onChange={(e) => selectHotel(e.target.value)}
              >
                <option value="">Choose your hotel</option>
                {hotels.map((h) => (
                  <option key={h.inn_code} value={h.inn_code}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Link href="/" aria-label="FoundOra home"><Brand /></Link>
          <ThemeToggle />
        </div>
      </header>
  )
}
