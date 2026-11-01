'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import EnquiryChat from '@/components/enquiry/EnquiryChat'
import type { PublicContact } from '@/lib/hotel-config'
import {
  detectSupportTopic,
  supportMessage,
  supportTopics,
  type SupportTopic,
} from '@/lib/guest-support'
import ThemeToggle from './Theme'

type Hotel = { inn_code: string; name: string }
type Experience = {
  hotels: Hotel[]
  hotel: Hotel | null
  contact: PublicContact | null
  selectHotel: (code: string) => void
  openEnquiry: () => void
}
const GuestContext = createContext<Experience | null>(null)
export function useGuestExperience() {
  const value = useContext(GuestContext)
  if (!value) throw new Error('Guest experience provider is missing.')
  return value
}
export function HotelContact({ contact }: { contact: PublicContact | null }) {
  if (
    !contact ||
    !(
      contact.contact_phone ||
      contact.contact_email ||
      contact.support_hours ||
      contact.support_note
    )
  )
    return (
      <p className="hint">
        Use the hotel’s official contact details on your booking confirmation.
      </p>
    )
  return (
    <div className="hotel-contact">
      {contact.contact_phone && (
        <p>
          <a href={`tel:${contact.contact_phone.replace(/[^0-9+]/g, '')}`}>
            {contact.contact_phone}
          </a>
        </p>
      )}
      {contact.contact_email && (
        <p>
          <a href={`mailto:${contact.contact_email}`}>
            {contact.contact_email}
          </a>
        </p>
      )}
      {contact.support_hours && <p className="hint">{contact.support_hours}</p>}
      {contact.support_note && <p className="hint">{contact.support_note}</p>}
    </div>
  )
}
export default function GuestExperience({
  hotels,
  contacts,
  today,
  children,
}: {
  hotels: Hotel[]
  contacts: PublicContact[]
  today: string
  children: React.ReactNode
}) {
  const [selected, setSelected] = useState(
    hotels.length === 1 ? hotels[0].inn_code : '',
  )
  const hotel = hotels.find((h) => h.inn_code === selected) ?? null
  const contact = contacts.find((c) => c.inn_code === hotel?.inn_code) ?? null
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'guide' | 'enquiry'>('guide')
  const [topic, setTopic] = useState<SupportTopic>('start')
  const [history, setHistory] = useState<
    { from: 'you' | 'assistant'; text: string }[]
  >([])
  const [text, setText] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const path = usePathname()
  const previous = useRef(path)
  const message = supportMessage(topic, hotel?.name ?? 'your hotel')
  const greeting = supportMessage('start', hotel?.name ?? 'your hotel').text
  function launch(next: 'guide' | 'enquiry') {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setMode(next)
    setOpen(true)
  }
  function choose(next: SupportTopic) {
    setTopic(next)
    setHistory((current) => [
      ...current.slice(-36),
      { from: 'you', text: supportTopics[next] },
      {
        from: 'assistant',
        text: supportMessage(next, hotel?.name ?? 'your hotel').text,
      },
    ])
    setText('')
  }
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [history, open])
  useEffect(() => {
    if (path !== previous.current) {
      dialog.current?.close()
      previous.current = path
    }
  }, [path])
  return (
    <GuestContext.Provider
      value={{
        hotels,
        hotel,
        contact,
        selectHotel: (code) => {
          if (hotels.some((h) => h.inn_code === code) || code === '') {
            setSelected(code)
            setHistory([])
            setTopic('start')
          }
        },
        openEnquiry: () => launch('enquiry'),
      }}
    >
      {children}
      <button
        ref={launcher}
        type="button"
        className={`support-launcher ${/^\/(items|staff|settings|requests|support|account)(\/|$)/.test(path) ? 'support-staff' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="foundora-support"
        onClick={() => launch('guide')}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M21 11a9 9 0 0 1-9 9H5l-4 2 2-7a9 9 0 1 1 18-4Z" />
          <path d="M7 9h9M7 13h6" />
        </svg>
        <span>Support</span>
      </button>
      <dialog
        ref={dialog}
        className={`support-dialog ${mode === 'enquiry' ? 'enquiry-dialog' : ''}`}
        id="foundora-support"
        aria-labelledby="support-title"
        aria-describedby="support-description"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false)
          const target = restoreFocus.current?.isConnected
            ? restoreFocus.current
            : launcher.current
          target?.focus()
        }}
      >
        <header className="support-heading">
          <div>
            <h2 id="support-title">
              {mode === 'enquiry' ? 'Report a lost item' : 'Foundora support'}
            </h2>
            <p id="support-description">
              {hotel?.name ?? 'Select your hotel'} · Guided assistant
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close support"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="support-mode" role="group" aria-label="Support service">
          <button
            type="button"
            aria-pressed={mode === 'guide'}
            onClick={() => setMode('guide')}
          >
            Guidance
          </button>
          <button
            type="button"
            aria-pressed={mode === 'enquiry'}
            onClick={() => setMode('enquiry')}
          >
            Report a lost item
          </button>
          <Link href="/track" onClick={() => setOpen(false)}>
            Check an enquiry
          </Link>
          <ThemeToggle />
        </div>
        {hotels.length > 1 && (
          <div className="support-hotel">
            <label htmlFor="support-hotel" className="label">
              Hotel
            </label>
            <select
              id="support-hotel"
              className="field"
              value={selected}
              onChange={(event) => {
                if (
                  mode === 'enquiry' &&
                  !confirm(
                    'Changing hotels starts a new enquiry form. Continue?',
                  )
                )
                  return
                setSelected(event.target.value)
                setHistory([])
                setTopic('start')
              }}
            >
              <option value="">Choose your hotel</option>
              {hotels.map((h) => (
                <option key={h.inn_code} value={h.inn_code}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="guide-pane" hidden={mode !== 'guide'}>
          <div
            ref={log}
            className="support-conversation"
            role="log"
            aria-live="polite"
            aria-label="Support conversation"
          >
            <div className="chat-message">{greeting}</div>
            {history.map((m, i) => (
              <div
                key={i}
                className={`chat-message ${m.from === 'you' ? 'chat-you' : ''}`}
              >
                <span className="sr-only">{m.from}: </span>
                {m.text}
              </div>
            ))}
          </div>
          <div className="support-options">
            {topic === 'contact' && <HotelContact contact={contact} />}
            <div className="chat-choices">
              {message.next.map((next) => (
                <button type="button" key={next} onClick={() => choose(next)}>
                  {supportTopics[next]}
                </button>
              ))}
            </div>
          </div>
          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault()
              if (!text.trim()) return
              const next = detectSupportTopic(text)
              if (next) choose(next)
              else {
                setHistory((current) => [
                  ...current.slice(-36),
                  {
                    from: 'assistant',
                    text: 'I can help with a lost item, collection, delivery or contacting the hotel. Choose an option, or open the report form to send an enquiry. Please keep personal details out of guidance chat.',
                  },
                ])
                setText('')
              }
            }}
          >
            <label htmlFor="support-message" className="sr-only">
              Ask about lost items, collection or delivery
            </label>
            <input
              id="support-message"
              className="field"
              placeholder="Ask about collection or delivery…"
              value={text}
              maxLength={250}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
            />
            <button className="btn btn-primary" disabled={!text.trim()}>
              Send
            </button>
          </form>
          <p className="support-privacy">
            Guidance stays in this tab. Only the report form submits an enquiry.
          </p>
        </div>
        <div className="enquiry-pane" hidden={mode !== 'enquiry'}>
          {hotels.length === 0 ? (
            <div role="alert" className="panel p-5">
              <p>Enquiries aren’t available right now.</p>
              <p className="hint mt-2">Please contact the hotel directly.</p>
            </div>
          ) : (
            <EnquiryChat
              key={hotel?.inn_code ?? 'choose'}
              hotels={hotel ? [hotel] : hotels}
              today={today}
            />
          )}
        </div>
      </dialog>
    </GuestContext.Provider>
  )
}
