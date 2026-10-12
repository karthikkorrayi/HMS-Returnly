'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ruleBasedAssistant, type ConversationState, type CustomerInput } from '@/lib/requests/assistant'
import { submitEnquiry } from '@/lib/requests/public-actions'
import { CATEGORIES } from '@/lib/types'

// Swap this for an AI-backed EnquiryAssistant later; the UI stays the same.
const assistant = ruleBasedAssistant

type Hotel = { inn_code: string; name: string }

export default function EnquiryChat({ hotels, today }: { hotels: Hotel[]; today: string }) {
  const [conv, setConv] = useState<ConversationState>(() => assistant.start(today))
  const [text, setText] = useState('')
  const [hotel, setHotel] = useState(hotels.length === 1 ? hotels[0].inn_code : '')
  const [name, setName] = useState('')
  const [booking, setBooking] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the newest message visible by scrolling the conversation box only —
  // never the page, and not on first load.
  useEffect(() => {
    const log = logRef.current
    if (log && conv.messages.length > 2) log.scrollTop = log.scrollHeight
  }, [conv.messages.length])

  function send(input: CustomerInput) {
    setConv((c) => assistant.respond(c, input, today))
    setText('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function onSend(e: React.FormEvent) {
    e.preventDefault()
    if (conv.step === 'describe' && text.trim().length === 0) return
    send({ kind: 'text', text })
  }

  function updateDraft(key: keyof ConversationState['draft'], value: string) {
    setConv((c) => ({ ...c, draft: { ...c.draft, [key]: value || null } }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!hotel) next.hotel = 'Choose the hotel you stayed at.'
    if (name.trim().length < 2) next.name = 'Enter your name as it appears on the booking.'
    if (!/^[A-Za-z0-9-\s]{3,40}$/.test(booking.trim())) next.booking = 'Enter the booking ID from your confirmation email.'
    if ((conv.draft.itemName ?? '').trim().length < 2) next.itemName = 'Say what the item is.'
    if ((conv.draft.description ?? '').trim().length < 3) next.description = 'Describe the item.'
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(`enq-${Object.keys(next)[0]}`)?.focus()
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    const res = await submitEnquiry({
      innCode: hotel,
      customerName: name,
      bookingRef: booking,
      itemName: conv.draft.itemName,
      description: conv.draft.description,
      category: conv.draft.category,
      colour: conv.draft.colour,
      brand: conv.draft.brand,
      lostLocation: conv.draft.lostLocation,
      lostDate: conv.draft.lostDate,
    })
    setSubmitting(false)
    if (res.ok) setReference(res.reference)
    else setSubmitError(res.error)
  }

  function restart() {
    setConv(assistant.start(today))
    setReference(null)
    setText('')
    setCopied(false)
  }

  if (reference) {
    return (
      <div className="panel p-5 sm:p-7" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-done">Enquiry sent</p>
        <h3 className="mt-1 text-2xl font-bold">Your reference</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="tag tag-lg select-all">{reference}</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(reference)
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-4 max-w-prose">
          Keep this reference with your booking ID. A member of staff will check your enquiry against the items
          we hold — <strong>this doesn’t mean your item has been found yet</strong>. Check back to see updates or
          answer questions from the team.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/track?ref=${encodeURIComponent(reference)}`} className="btn btn-primary">
            Check status
          </Link>
          <button type="button" className="btn btn-secondary" onClick={restart}>
            Report another item
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel overflow-hidden">
      <fieldset className={`grid gap-3 border-b border-line bg-paper p-4 sm:p-5 ${hotels.length > 1 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <legend className="sr-only">Your booking</legend>
        {hotels.length > 1 ? (
          <div>
            <label htmlFor="enq-hotel" className="label">Hotel</label>
            <select id="enq-hotel" className="field" value={hotel} onChange={(e) => setHotel(e.target.value)} aria-invalid={!!errors.hotel} aria-describedby={errors.hotel ? 'enq-hotel-err' : undefined}>
              <option value="">Choose…</option>
              {hotels.map((h) => <option key={h.inn_code} value={h.inn_code}>{h.name}</option>)}
            </select>
            {errors.hotel && <p id="enq-hotel-err" className="mt-1 text-sm text-danger">{errors.hotel}</p>}
          </div>
        ) : null}
        <div>
          <label htmlFor="enq-name" className="label">Your name</label>
          <input id="enq-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'enq-name-err' : undefined} />
          {errors.name && <p id="enq-name-err" className="mt-1 text-sm text-danger">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="enq-booking" className="label">Booking ID</label>
          <input id="enq-booking" className="field" autoCapitalize="characters" autoComplete="off" value={booking} onChange={(e) => setBooking(e.target.value)} maxLength={40} aria-invalid={!!errors.booking} aria-describedby={errors.booking ? 'enq-booking-err' : 'enq-booking-hint'} />
          {errors.booking
            ? <p id="enq-booking-err" className="mt-1 text-sm text-danger">{errors.booking}</p>
            : <p id="enq-booking-hint" className="hint mt-1">On your confirmation email.</p>}
        </div>
      </fieldset>

      <ol ref={logRef} className="max-h-[26rem] space-y-3 overflow-y-auto p-4 sm:p-5" aria-label="Conversation" aria-live="polite">
        {conv.messages.map((m) => (
          <li key={m.id} className={`flex ${m.from === 'customer' ? 'justify-end' : 'justify-start'}`}>
            <p
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed ${
                m.from === 'customer' ? 'rounded-br-md bg-teal text-white' : 'rounded-bl-md bg-paper'
              }`}
            >
              <span className="sr-only">{m.from === 'customer' ? 'You: ' : 'Assistant: '}</span>
              {m.text}
            </p>
          </li>
        ))}
      </ol>

      {conv.step !== 'review' && (
        <div className="border-t border-line p-4 sm:p-5">
          {conv.quickReplies.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Suggested answers">
              {conv.quickReplies.map((q) => (
                <button key={q.label} type="button" className="rounded-full border border-teal px-3.5 py-1.5 text-sm font-semibold text-teal-dark hover:bg-teal-soft" onClick={() => send({ kind: 'choice', value: q.value, label: q.label })}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          {conv.input !== 'choices' && (
            <form onSubmit={onSend} className="flex gap-2">
              <label htmlFor="enq-input" className="sr-only">
                {conv.input === 'date' ? 'Date you last had it' : 'Your answer'}
              </label>
              <input
                ref={inputRef}
                id="enq-input"
                className="field"
                type={conv.input === 'date' ? 'date' : 'text'}
                max={conv.input === 'date' ? today : undefined}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
                placeholder={conv.step === 'describe' ? 'e.g. A gold Pandora bracelet with a heart charm' : conv.step === 'location' ? 'e.g. On the bedside table' : undefined}
                autoComplete="off"
              />
              <button type="submit" className="btn btn-primary shrink-0" disabled={conv.step === 'describe' && !text.trim()}>
                Send
              </button>
            </form>
          )}
        </div>
      )}

      {conv.step === 'review' && (
        <form onSubmit={onSubmit} className="space-y-4 border-t border-line p-4 sm:p-5" noValidate>
          <h3 className="font-bold">Your enquiry</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="enq-itemName" className="label">Item</label>
              <input id="enq-itemName" className="field" value={conv.draft.itemName} onChange={(e) => updateDraft('itemName', e.target.value)} maxLength={80} aria-invalid={!!errors.itemName} />
              {errors.itemName && <p className="mt-1 text-sm text-danger">{errors.itemName}</p>}
            </div>
            <div>
              <label htmlFor="enq-category" className="label">Type</label>
              <select id="enq-category" className="field" value={conv.draft.category ?? ''} onChange={(e) => updateDraft('category', e.target.value)}>
                <option value="">Not sure</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="enq-colour" className="label">Colour <span className="font-normal text-muted">(optional)</span></label>
              <input id="enq-colour" className="field" value={conv.draft.colour ?? ''} onChange={(e) => updateDraft('colour', e.target.value)} maxLength={40} />
            </div>
            <div>
              <label htmlFor="enq-brand" className="label">Brand <span className="font-normal text-muted">(optional)</span></label>
              <input id="enq-brand" className="field" value={conv.draft.brand ?? ''} onChange={(e) => updateDraft('brand', e.target.value)} maxLength={60} />
            </div>
            <div>
              <label htmlFor="enq-where" className="label">Where <span className="font-normal text-muted">(optional)</span></label>
              <input id="enq-where" className="field" value={conv.draft.lostLocation ?? ''} onChange={(e) => updateDraft('lostLocation', e.target.value)} maxLength={80} />
            </div>
            <div>
              <label htmlFor="enq-date" className="label">When <span className="font-normal text-muted">(optional)</span></label>
              <input id="enq-date" type="date" className="field" max={today} value={conv.draft.lostDate ?? ''} onChange={(e) => updateDraft('lostDate', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="enq-description" className="label">Description</label>
            <textarea id="enq-description" className="field min-h-24" value={conv.draft.description} onChange={(e) => updateDraft('description', e.target.value)} maxLength={1000} aria-invalid={!!errors.description} />
            <p className="hint mt-1">Include anything only the owner would know — an engraving, what’s inside, a scratch. Don’t include card or passport numbers.</p>
            {errors.description && <p className="mt-1 text-sm text-danger">{errors.description}</p>}
          </div>
          {submitError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{submitError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send enquiry'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={restart} disabled={submitting}>
              Start again
            </button>
          </div>
          <p className="hint">
            Your name, booking ID and description are shared with the hotel’s lost property team only, and deleted
            after the enquiry is closed.
          </p>
        </form>
      )}
    </div>
  )
}
