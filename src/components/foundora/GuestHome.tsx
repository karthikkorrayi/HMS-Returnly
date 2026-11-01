'use client'

import Link from 'next/link'
import { useState } from 'react'
import Brand from './Brand'
import ThemeToggle from './Theme'
import { HotelContact, useGuestExperience } from './GuestExperience'
import ReturnlyIcon from '@/components/ReturnlyIcon'

export default function GuestHome() {
  const { hotels, hotel, contact, selectHotel, openEnquiry } =
    useGuestExperience()
  const [view, setView] = useState<'start' | 'process' | 'contact'>('start')
  return (
    <div className="guest-shell">
      <a className="skip-link" href="#guest-main">
        Skip to content
      </a>
      <header className="guest-header">
        <Link href="/" aria-label="Foundora home">
          <Brand />
        </Link>
        <div className="guest-header-actions">
          {hotels.length > 1 ? (
            <div className="hotel-picker">
              <label className="sr-only" htmlFor="homepage-hotel">
                Your hotel
              </label>
              <select
                id="homepage-hotel"
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
          ) : (
            <span className="hotel-header-name">
              {hotel?.name ?? 'Hotel lost & found'}
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="guest-main" id="guest-main">
        <section className="guest-introduction" aria-label="Welcome">
          <div>
            <p className="eyebrow">
              {hotel
                ? `Welcome to ${hotel.name}`
                : hotels.length > 1
                  ? 'Choose your hotel above'
                  : 'Your belongings. Our care.'}
            </p>
            <h1>
              Left behind.
              <br className="desktop-break" /> <span>Never forgotten.</span>
            </h1>
            <p className="guest-subtitle">
              Lost & found, with a little more peace of mind.
            </p>
          </div>
          <div className="reunion-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="art-tag">
              <ReturnlyIcon name="tag" />
              <span>
                Found.
                <br />
                Safe.
                <br />
                Home.
              </span>
            </div>
            <span className="art-check">
              <ReturnlyIcon name="check" />
            </span>
          </div>
        </section>
        <section className="guest-workspace" aria-label="Guest services">
          <nav className="guest-actions" aria-label="Guest services">
            <p className="eyebrow">How can we help?</p>
            {(
              [
                { id: 'start', label: 'Lost something?', icon: 'search' },
                { id: 'process', label: 'How it works', icon: 'shield' },
                { id: 'contact', label: 'Contact your hotel', icon: 'chat' },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                className={`guest-action ${view === option.id ? 'guest-action-active' : ''}`}
                aria-pressed={view === option.id}
                aria-controls="guest-action-panel"
                onClick={() => setView(option.id)}
              >
                <ReturnlyIcon name={option.icon} />
                <span>{option.label}</span>
                <ReturnlyIcon name="arrow" className="action-arrow" />
              </button>
            ))}
            <Link href="/track" className="guest-action">
              <ReturnlyIcon name="inbox" />
              <span>Check an enquiry</span>
              <ReturnlyIcon name="arrow" className="action-arrow" />
            </Link>
            <div className="guest-trust">
              <ReturnlyIcon name="shield" />
              <p>
                Handled by your hotel.
                <br />
                Private by design.
              </p>
            </div>
          </nav>
          <section
            id="guest-action-panel"
            className="guest-action-panel"
            aria-labelledby="guest-panel-title"
          >
            <div aria-live="polite" aria-atomic="true">
              <p className="eyebrow">
                {view === 'start'
                  ? '01 / Reconnect'
                  : view === 'process'
                    ? '02 / A thoughtful way back'
                    : '03 / Here to help'}
              </p>
              <h2 id="guest-panel-title">
                {view === 'start'
                  ? 'Let’s bring it back to you.'
                  : view === 'process'
                    ? 'From lost to reunited.'
                    : (hotel?.name ?? 'Your hotel team')}
              </h2>
              {view === 'contact' ? (
                <div className="mt-5">
                  <HotelContact contact={contact} />
                  <p className="panel-intro">
                    Already sent an enquiry? Use your reference and booking ID
                    to check updates or reply to the hotel.
                  </p>
                </div>
              ) : (
                <>
                  <p className="panel-intro">
                    {view === 'start'
                      ? 'Describe what you’ve lost. Our guided enquiry assistant will help gather the details, then your hotel team will check their records.'
                      : 'A clear process, with care at every step. Only hotel staff can confirm a match and arrange a return.'}
                  </p>
                  <ol className="guest-steps">
                    {(view === 'start'
                      ? [
                          'Describe the item, where you last saw it, and when.',
                          'Review your details before sending them to the hotel.',
                          'Keep your reference to follow updates and reply to staff.',
                        ]
                      : [
                          'The hotel receives your enquiry and checks found-item records.',
                          'Staff may ask for more details to verify ownership.',
                          'After confirmation, arrange collection or available delivery options.',
                        ]
                    ).map((step, i) => (
                      <li key={step}>
                        <span aria-hidden="true">0{i + 1}</span>
                        <p>{step}</p>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
            <div className="guest-handoff">
              {view === 'contact' ? (
                <Link href="/track" className="btn btn-primary">
                  Check an enquiry <ReturnlyIcon name="arrow" />
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openEnquiry}
                  disabled={hotels.length === 0}
                >
                  Report a lost item <ReturnlyIcon name="arrow" />
                </button>
              )}
              <p className="hint">
                {hotels.length === 0
                  ? 'Enquiries aren’t available right now. Please contact the hotel.'
                  : 'A submitted enquiry does not mean your item has been found.'}
              </p>
            </div>
          </section>
        </section>
      </main>
      <footer className="guest-footer">
        <span>Foundora / Lost & Found, Made Simple.</span>
        <span className="guest-footer-note">
          Your details are used to handle your enquiry.
        </span>
      </footer>
    </div>
  )
}
