'use client'

import Typing from '@/components/foundora/Typing'
import { notify } from '@/components/foundora/Toast'
import { useEffect, useId, useRef, useState } from 'react'
import { ruleBasedAssistant, type ConversationState, type CustomerInput } from '@/lib/requests/assistant'
import { submitReport } from '@/lib/requests/public-actions'
import { CONFIRM_EMAIL_TEXT, emailTypoHint, isValidEmail, normaliseEmail } from '@/lib/requests/email'
import { CATEGORIES } from '@/lib/types'
import EmailConfirm from './EmailConfirm'
import TrackingLinkCard from './TrackingLinkCard'

// Swap this for an AI-backed EnquiryAssistant later; the UI stays the same.
const assistant = ruleBasedAssistant

type Hotel = { inn_code: string; name: string }

export default function EnquiryChat({ hotels, today }: { hotels: Hotel[]; today: string }) {
  const uid = useId()
  const fieldId = (name: string) => `${uid}-${name}`
  const [conv, setConv] = useState<ConversationState>(() => assistant.start(today))
  const [text, setText] = useState('')
  const [hotel, setHotel] = useState(hotels.length === 1 ? hotels[0].inn_code : '')
  const [name, setName] = useState('')
  const [booking, setBooking] = useState('')
  const [email, setEmail] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ reference: string; token: string } | null>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [thinking, setThinking] = useState(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkpoints = useRef(new Map<number, { before: ConversationState; input: CustomerInput }>())
  const [editBefore, setEditBefore] = useState<ConversationState | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Keep the newest message visible by scrolling the conversation box only —
  // never the page, and not on first load.
  useEffect(() => {
    const log = logRef.current
    if (log && conv.messages.length > 2) log.scrollTop = log.scrollHeight
  }, [conv.messages.length])

  function send(input: CustomerInput, before = conv) {
    if (pending.current) return
    pending.current = true
    setThinking(true)
    setConfirming(false)
    setSubmitError(null)
    const next = assistant.respond(before, input, today)
    const customer = next.messages[before.messages.length]
    if (customer) {
      for (const id of checkpoints.current.keys()) if (id >= customer.id) checkpoints.current.delete(id)
      checkpoints.current.set(customer.id, { before, input })
    }
    // Show the submitted input immediately; reveal the actual state-machine result afterwards.
    setConv({ ...before, messages: next.messages.slice(0, before.messages.length + 1) })
    setText('')
    setEditing(null)
    timer.current = setTimeout(() => {
      setConv(next)
      pending.current = false
      setThinking(false)
      inputRef.current?.focus()
    }, 2400)
  }

  function saveEdit(id: number) {
    const checkpoint = checkpoints.current.get(id)
    if (!checkpoint || !editText.trim()) return
    const input: CustomerInput = checkpoint.before.input === 'choices'
      ? { kind: 'choice', value: editText, label: checkpoint.before.quickReplies.find((q) => q.value === editText)?.label ?? editText }
      : { kind: 'text', text: editText }
    send(input, checkpoint.before)
  }

  function onSend(e: React.FormEvent) {
    e.preventDefault()
    if (pending.current || editing !== null || (conv.step === 'describe' && text.trim().length === 0)) return
    send({ kind: 'text', text })
  }

  function updateDraft(key: keyof ConversationState['draft'], value: string) {
    setConv((c) => ({ ...c, draft: { ...c.draft, [key]: value || null } }))
  }

  // Step 1: check the form, then ask the customer to confirm their email.
  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pending.current || submitting || editing !== null) return
    const next: Record<string, string> = {}
    if (!hotel) next.hotel = 'Choose the hotel you stayed at.'
    if (name.trim().length < 2) next.name = 'Enter your name as it appears on the booking.'
    if (!/^[A-Za-z0-9-\s]{3,40}$/.test(booking.trim())) next.booking = 'Enter the booking ID from your confirmation email.'
    if (!isValidEmail(email)) next.email = 'Enter a valid email address.'
    if ((conv.draft.itemName ?? '').trim().length < 2) next.itemName = 'Say what the item is.'
    if ((conv.draft.description ?? '').trim().length < 3) next.description = 'Describe the item.'
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(fieldId(`enq-${Object.keys(next)[0]}`))?.focus()
      return
    }
    setSubmitError(null)
    setConfirming(true)
  }

  // Step 2: the customer pressed "Yes, send" on the confirmation.
  async function onConfirmed() {
    if (submitting || pending.current || editing !== null) return
    setSubmitting(true)
    setSubmitError(null)
    try {
    const res = await submitReport({
      innCode: hotel,
      reportType: 'lost',
      email: normaliseEmail(email),
      emailConfirmed: true,
      customerName: name,
      bookingRef: booking,
      itemName: conv.draft.itemName,
      description: conv.draft.description,
      category: conv.draft.category,
      colour: conv.draft.colour,
      brand: conv.draft.brand,
      location: conv.draft.lostLocation,
      date: conv.draft.lostDate,
      whereabouts: null,
    })
    setSubmitting(false)
    setConfirming(false)
    if (res.ok) { setSent({ reference: res.reference, token: res.token }); notify('success', 'Your enquiry has been sent to the hotel.') }
    else { setSubmitError(res.error); notify('error', res.error) }
    } catch { setSubmitError('Could not send your enquiry. Check your connection and try again.'); notify('error', 'Your enquiry could not be sent.') }
    finally { setSubmitting(false); setConfirming(false) }
  }

  function restart() {
    if (timer.current) clearTimeout(timer.current)
    pending.current = false
    setThinking(false)
    setEditing(null)
    checkpoints.current.clear()
    setConv(assistant.start(today))
    setSent(null)
    setConfirming(false)
    setText('')
  }

  if (sent) {
    return (
      <TrackingLinkCard
        reference={sent.reference}
        token={sent.token}
        kind="lost"
        onAnother={restart}
      />
    )
  }

  return (
    <div className="panel overflow-hidden">
      <fieldset disabled={submitting} className={`grid gap-3 border-b border-line bg-paper p-4 sm:p-5 ${hotels.length > 1 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <legend className="sr-only">Your booking</legend>
        {hotels.length > 1 ? (
          <div>
            <label htmlFor={fieldId('enq-hotel')} className="label">Hotel</label>
            <select id={fieldId('enq-hotel')} className="field" value={hotel} onChange={(e) => { setHotel(e.target.value); setConfirming(false) }} aria-invalid={!!errors.hotel} aria-describedby={errors.hotel ? fieldId('enq-hotel-err') : undefined}>
              <option value="">Choose…</option>
              {hotels.map((h) => <option key={h.inn_code} value={h.inn_code}>{h.name}</option>)}
            </select>
            {errors.hotel && <p id={fieldId('enq-hotel-err')} className="mt-1 text-sm text-danger">{errors.hotel}</p>}
          </div>
        ) : null}
        <div>
          <label htmlFor={fieldId('enq-name')} className="label">Your name</label>
          <input id={fieldId('enq-name')} className="field" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setConfirming(false) }} maxLength={80} aria-invalid={!!errors.name} aria-describedby={errors.name ? fieldId('enq-name-err') : undefined} />
          {errors.name && <p id={fieldId('enq-name-err')} className="mt-1 text-sm text-danger">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor={fieldId('enq-booking')} className="label">Booking ID</label>
          <input id={fieldId('enq-booking')} className="field" autoCapitalize="characters" autoComplete="off" value={booking} onChange={(e) => { setBooking(e.target.value); setConfirming(false) }} maxLength={40} aria-invalid={!!errors.booking} aria-describedby={errors.booking ? fieldId('enq-booking-err') : fieldId('enq-booking-hint')} />
          {errors.booking
            ? <p id={fieldId('enq-booking-err')} className="mt-1 text-sm text-danger">{errors.booking}</p>
            : <p id={fieldId('enq-booking-hint')} className="hint mt-1">On your confirmation email.</p>}
        </div>
      </fieldset>

      <ol ref={logRef} className="max-h-[26rem] space-y-3 overflow-y-auto p-4 sm:p-5" aria-label="Conversation" aria-live="polite">
        {conv.messages.map((m) => (
          <li key={m.id} className={`flex ${m.from === 'customer' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed ${
                m.from === 'customer' ? 'rounded-br-md bg-teal text-white' : 'rounded-bl-md bg-paper response-reveal'
              }`}
            >
              <span className="sr-only">{m.from === 'customer' ? 'You: ' : 'Assistant: '}</span>
              {editing === m.id ? <div className="space-y-2">
                <label className="label" htmlFor={fieldId('edit-enquiry')}>Edit your answer</label>
                {editBefore?.input === 'choices'
                  ? <select id={fieldId('edit-enquiry')} className="field" value={editText} onChange={(e) => setEditText(e.target.value)}>{editBefore?.quickReplies.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}</select>
                  : <input id={fieldId('edit-enquiry')} className="field" type={editBefore?.input === 'date' ? 'date' : 'text'} maxLength={1000} value={editText} onChange={(e) => setEditText(e.target.value)} />}
                <p className="text-xs">Updating this answer replaces the following questions and answers. Booking details are kept.</p>
                <button type="button" className="btn btn-secondary" onClick={() => saveEdit(m.id)}>Update answer</button>{' '}
                <button type="button" className="underline" onClick={() => setEditing(null)}>Cancel</button>
              </div> : <>{m.text}{m.from === 'customer' && <button type="button" className="chat-edit" disabled={thinking || submitting} onClick={() => {
                const checkpoint = checkpoints.current.get(m.id)
                if (!checkpoint) return
                setEditBefore(checkpoint.before)
                setEditing(m.id)
                setConfirming(false)
                setEditText(checkpoint.input.kind === 'text' ? checkpoint.input.text : checkpoint.input.value)
              }}>Edit</button>}</>}
            </div>
          </li>
        ))}
        {thinking && <li><Typing /></li>}
      </ol>

      {conv.step !== 'review' && !thinking && editing === null && (
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
              <label htmlFor={fieldId('enq-input')} className="sr-only">
                {conv.input === 'date' ? 'Date you last had it' : 'Your answer'}
              </label>
              <input
                ref={inputRef}
                id={fieldId('enq-input')}
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

      {conv.step === 'review' && !thinking && editing === null && (
        <form onSubmit={onSubmit} className="space-y-4 border-t border-line p-4 sm:p-5" noValidate>
          <h3 className="font-bold">Your enquiry</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={fieldId('enq-itemName')} className="label">Item</label>
              <input id={fieldId('enq-itemName')} className="field" value={conv.draft.itemName} onChange={(e) => updateDraft('itemName', e.target.value)} maxLength={80} aria-invalid={!!errors.itemName} />
              {errors.itemName && <p className="mt-1 text-sm text-danger">{errors.itemName}</p>}
            </div>
            <div>
              <label htmlFor={fieldId('enq-category')} className="label">Type</label>
              <select id={fieldId('enq-category')} className="field" value={conv.draft.category ?? ''} onChange={(e) => updateDraft('category', e.target.value)}>
                <option value="">Not sure</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={fieldId('enq-colour')} className="label">Colour <span className="font-normal text-muted">(optional)</span></label>
              <input id={fieldId('enq-colour')} className="field" value={conv.draft.colour ?? ''} onChange={(e) => updateDraft('colour', e.target.value)} maxLength={40} />
            </div>
            <div>
              <label htmlFor={fieldId('enq-brand')} className="label">Brand <span className="font-normal text-muted">(optional)</span></label>
              <input id={fieldId('enq-brand')} className="field" value={conv.draft.brand ?? ''} onChange={(e) => updateDraft('brand', e.target.value)} maxLength={60} />
            </div>
            <div>
              <label htmlFor={fieldId('enq-where')} className="label">Where <span className="font-normal text-muted">(optional)</span></label>
              <input id={fieldId('enq-where')} className="field" value={conv.draft.lostLocation ?? ''} onChange={(e) => updateDraft('lostLocation', e.target.value)} maxLength={80} />
            </div>
            <div>
              <label htmlFor={fieldId('enq-date')} className="label">When <span className="font-normal text-muted">(optional)</span></label>
              <input id={fieldId('enq-date')} type="date" className="field" max={today} value={conv.draft.lostDate ?? ''} onChange={(e) => updateDraft('lostDate', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor={fieldId('enq-description')} className="label">Description</label>
            <textarea id={fieldId('enq-description')} className="field min-h-24" value={conv.draft.description} onChange={(e) => updateDraft('description', e.target.value)} maxLength={1000} aria-invalid={!!errors.description} />
            <p className="hint mt-1">Include anything only the owner would know — an engraving, what’s inside, a scratch. Don’t include card or passport numbers.</p>
            {errors.description && <p className="mt-1 text-sm text-danger">{errors.description}</p>}
          </div>
          <div>
            <label htmlFor={fieldId('enq-email')} className="label">Your email</label>
            <input id={fieldId('enq-email')} type="email" inputMode="email" autoComplete="email" className="field" value={email}
              onChange={(e) => { setEmail(e.target.value); setConfirming(false) }} maxLength={254}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? fieldId('enq-email-err') : fieldId('enq-email-hint')} />
            {errors.email
              ? <p id={fieldId('enq-email-err')} className="mt-1 text-sm text-danger">{errors.email}</p>
              : <p id={fieldId('enq-email-hint')} className="hint mt-1">For your reference ID and status updates only.</p>}
          </div>
          {submitError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{submitError}</p>}
          {confirming ? (
            <EmailConfirm
              email={normaliseEmail(email)}
              question={CONFIRM_EMAIL_TEXT}
              hint={emailTypoHint(email)}
              busy={submitting}
              onYes={onConfirmed}
              onChange={() => { setConfirming(false); requestAnimationFrame(() => document.getElementById(fieldId('enq-email'))?.focus()) }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                Send enquiry
              </button>
              <button type="button" className="btn btn-secondary" onClick={restart} disabled={submitting}>
                Start again
              </button>
            </div>
          )}
          <p className="hint">
            Your name, booking ID, email and description are shared with the hotel’s lost property team only, and
            deleted after the report is closed.
          </p>
        </form>
      )}
    </div>
  )
}
