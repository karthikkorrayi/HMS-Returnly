'use client'

import Link from 'next/link'
import { useState } from 'react'
import GuestHeader from './GuestHeader'
import { HotelContact, useGuestExperience } from './GuestExperience'
import ReturnlyIcon from '@/components/ReturnlyIcon'

export default function GuestHome() {
  const { hotels, hotel, contact, openEnquiry } =
    useGuestExperience()
  const [view, setView] = useState<'start' | 'process' | 'contact'>('start')
  return (
    <div className="guest-shell">
      <a className="skip-link" href="#guest-main">
        Skip to content
      </a>
      <GuestHeader allowHotelSelection />
      <main className="guest-main" id="guest-main">
        <section className="guest-introduction" aria-label="Welcome">
          <div>
            <p className="eyebrow">
              {hotel
                ? `Welcome to ${hotel.name}`
                : hotels.length > 1
                  ? 'Choose your hotel above'
                  : 'Hotel lost property enquiries'}
            </p>
            <h1>
              Left something behind?
              <br className="desktop-break" /> <span>Let your hotel help.</span>
            </h1>
            <p className="guest-subtitle">
              Tell the hotel what you may have left behind. The team will check its found-item records and contact you about possible matches.
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
                Verified.
                <br />
                Returned.
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
                { id: 'start', label: 'Left an item behind?', icon: 'search' },
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
            <Link href={hotel?.slug ? `/h/${hotel.slug}/found` : hotel ? `/found?hotel=${encodeURIComponent(hotel.inn_code)}` : '/found'} className="guest-action">
              <ReturnlyIcon name="box" />
              <span>Hand in a found item</span>
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
                  ? '01 / Your enquiry'
                  : view === 'process'
                    ? '02 / Verification and return'
                    : '03 / Here to help'}
              </p>
              <h2 id="guest-panel-title">
                {view === 'start'
                  ? 'Tell us about your item.'
                  : view === 'process'
                    ? 'How recovery works.'
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
                      ? 'Describe the belongings you may have left at the hotel. The guided form gathers the details for the hotel team to review.'
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
                  Report an item left behind <ReturnlyIcon name="arrow" />
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
