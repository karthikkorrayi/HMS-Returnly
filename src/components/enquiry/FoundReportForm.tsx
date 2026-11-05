'use client'

import { notify } from '@/components/foundora/Toast'
import { useGuestExperience } from '@/components/foundora/GuestExperience'
import { useState } from 'react'
import { submitReport } from '@/lib/requests/public-actions'
import { CONFIRM_EMAIL_TEXT, emailTypoHint, isValidEmail, normaliseEmail } from '@/lib/requests/email'
import { WHEREABOUTS_LABEL, type FoundWhereabouts } from '@/lib/requests/types'
import { CATEGORIES } from '@/lib/types'
import EmailConfirm from './EmailConfirm'
import TrackingLinkCard from './TrackingLinkCard'

type Hotel = { inn_code: string; name: string }
const PLACES: FoundWhereabouts[] = ['handed_in', 'with_finder', 'left_in_place']

// "Hand in a found item": the short form for someone who found something at a
// hotel. Only what the hotel needs to find and log the item. The finder is
// asked to take it to reception and is never shown an owner or a match.
export default function FoundReportForm({ hotels, today, initialHotel }: { hotels: Hotel[]; today: string; initialHotel: string }) {
  const { selectHotel } = useGuestExperience()
  const [hotel, setHotel] = useState(
    hotels.some((h) => h.inn_code === initialHotel) ? initialHotel : hotels.length === 1 ? hotels[0].inn_code : ''
  )
  const [item, setItem] = useState('')
  const [category, setCategory] = useState('')
  const [details, setDetails] = useState('')
  const [where, setWhere] = useState('')
  const [date, setDate] = useState(today)
  const [now, setNow] = useState<FoundWhereabouts | ''>('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ reference: string; token: string } | null>(null)
  const hotelName = hotels.find((h) => h.inn_code === hotel)?.name

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!hotel) next.hotel = 'Choose the hotel where you found it.'
    if (item.trim().length < 2) next.item = 'Say what you found.'
    if (!now) next.now = 'Say where the item is now.'
    if (!isValidEmail(email)) next.email = 'Enter a valid email address.'
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(`fnd-${Object.keys(next)[0]}`)?.focus()
      return
    }
    setError(null)
    setConfirming(true)
  }

  async function onConfirmed() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
    const res = await submitReport({
      innCode: hotel,
      reportType: 'found',
      email: normaliseEmail(email),
      emailConfirmed: true,
      itemName: item,
      description: details,
      category: category || null,
      colour: null,
      brand: null,
      location: where || null,
      date: date || null,
      customerName: null,
      bookingRef: null,
      whereabouts: now || null,
    })
    setBusy(false)
    setConfirming(false)
    if (res.ok) { setSent({ reference: res.reference, token: res.token }); notify('success', 'Found-item report sent to the hotel.') }
    else { setError(res.error); notify('error', res.error) }
    } catch { setError('Could not send your report. Check your connection and try again.'); notify('error', 'The report could not be sent.') }
    finally { setBusy(false); setConfirming(false) }
  }

  if (sent) {
    return (
      <TrackingLinkCard reference={sent.reference} token={sent.token} kind="found"
        onAnother={() => { setSent(null); setItem(''); setDetails(''); setWhere(''); setNow(''); setCategory('') }} />
    )
  }

  const err = (k: string) => errors[k] && <p id={`fnd-${k}-err`} className="mt-1 text-sm text-danger">{errors[k]}</p>

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 p-4 sm:p-6" noValidate>
      <div className="rounded-xl bg-attention-soft p-3 text-sm text-attention">
        <p className="font-semibold">Please hand the item in at {hotelName ?? 'the hotel'} reception.</p>
        <p className="mt-1">This form lets the hotel know it’s coming. Don’t photograph or send details of ID, bank cards or documents.</p>
      </div>

      {hotels.length > 1 && (
        <div>
          <label htmlFor="fnd-hotel" className="label">Hotel</label>
          <select id="fnd-hotel" className="field" value={hotel} onChange={(e) => { setHotel(e.target.value); selectHotel(e.target.value) }} aria-invalid={!!errors.hotel}>
            <option value="">Choose…</option>
            {hotels.map((h) => <option key={h.inn_code} value={h.inn_code}>{h.name}</option>)}
          </select>
          {err('hotel')}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fnd-item" className="label">What did you find?</label>
          <input id="fnd-item" className="field" value={item} onChange={(e) => setItem(e.target.value)} maxLength={80}
            placeholder="e.g. Black umbrella" aria-invalid={!!errors.item} />
          {err('item')}
        </div>
        <div>
          <label htmlFor="fnd-category" className="label">Type <span className="font-normal text-muted">(optional)</span></label>
          <select id="fnd-category" className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Not sure</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fnd-where" className="label">Where did you find it? <span className="font-normal text-muted">(optional)</span></label>
          <input id="fnd-where" className="field" value={where} onChange={(e) => setWhere(e.target.value)} maxLength={80}
            placeholder="e.g. Lobby, by the lifts" />
        </div>
        <div>
          <label htmlFor="fnd-date" className="label">When? <span className="font-normal text-muted">(optional)</span></label>
          <input id="fnd-date" type="date" className="field" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div>
        <label htmlFor="fnd-details" className="label">Anything else that helps the hotel recognise it <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="fnd-details" className="field min-h-20" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
      </div>

      <fieldset>
        <legend className="label" id="fnd-now">Where is it now?</legend>
        <div className="mt-1 space-y-2">
          {PLACES.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="radio" name="fnd-now" value={p} checked={now === p} onChange={() => setNow(p)} />
              <span>{WHEREABOUTS_LABEL[p]}</span>
            </label>
          ))}
        </div>
        {err('now')}
      </fieldset>

      <div>
        <label htmlFor="fnd-email" className="label">Your email</label>
        <input id="fnd-email" type="email" inputMode="email" autoComplete="email" className="field" value={email}
          onChange={(e) => { setEmail(e.target.value); setConfirming(false) }} maxLength={254} aria-invalid={!!errors.email} />
        {errors.email ? err('email') : <p className="hint mt-1">For your reference ID and updates on this report only.</p>}
      </div>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {confirming ? (
        <EmailConfirm email={normaliseEmail(email)} question={CONFIRM_EMAIL_TEXT} hint={emailTypoHint(email)} busy={busy}
          onYes={onConfirmed} onChange={() => { setConfirming(false); requestAnimationFrame(() => document.getElementById('fnd-email')?.focus()) }} />
      ) : (
        <button type="submit" className="btn btn-primary">Send report</button>
      )}
      <p className="hint">Your email and these details go to the hotel’s lost property team only, and are deleted after the report is closed.</p>
    </form>
  )
}
