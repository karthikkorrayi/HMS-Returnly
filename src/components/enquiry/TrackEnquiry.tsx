'use client'

import { useState } from 'react'
import { lookupEnquiry, replyToEnquiry } from '@/lib/requests/public-actions'
import { CUSTOMER_STATUS, type CustomerStatusView } from '@/lib/requests/types'

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso))

export default function TrackEnquiry({ initialRef }: { initialRef: string }) {
  const [reference, setReference] = useState(initialRef)
  const [booking, setBooking] = useState('')
  const [view, setView] = useState<CustomerStatusView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onLookup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await lookupEnquiry(reference, booking)
    setBusy(false)
    if (res.ok) setView(res.view)
    else {
      setView(null)
      setError(res.error)
    }
  }

  async function onReply(e: React.FormEvent) {
    e.preventDefault()
    if (!view) return
    setSending(true)
    setReplyError(null)
    const res = await replyToEnquiry(view.reference, booking, reply)
    setSending(false)
    if (res.ok) {
      setView(res.view)
      setReply('')
    } else setReplyError(res.error)
  }

  const status = view ? CUSTOMER_STATUS[view.status] : null

  return (
    <div className="space-y-5">
      <form onSubmit={onLookup} className="panel grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-5">
        <div>
          <label htmlFor="trk-ref" className="label">Enquiry reference</label>
          <input id="trk-ref" className="field" placeholder="LF-XXXXX-XXXXX" autoCapitalize="characters" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="trk-booking" className="label">Booking ID</label>
          <input id="trk-booking" className="field" autoCapitalize="characters" autoComplete="off" value={booking} onChange={(e) => setBooking(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking…' : view ? 'Refresh' : 'Check status'}
        </button>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-3">{error}</p>}
      </form>

      {view && status && (
        <section aria-labelledby="trk-status" className="panel p-4 sm:p-6" aria-live="polite">
          <p className="hint">{view.reference} · {view.item_name} · sent {when(view.created_at)}</p>
          <h2 id="trk-status" className="mt-1 text-2xl font-bold">{status.title}</h2>
          <p className="mt-1 max-w-prose">{status.body}</p>

          <h3 className="mt-6 font-bold">Messages</h3>
          <ol className="mt-3 space-y-3">
            {view.messages.map((m, i) => (
              <li key={i} className={`flex ${m.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.sender === 'customer' ? 'rounded-br-md bg-teal text-white' : m.sender === 'staff' ? 'rounded-bl-md border border-teal bg-teal-soft' : 'rounded-bl-md bg-paper'}`}>
                  <p className="text-xs font-semibold opacity-80">
                    {m.sender === 'customer' ? 'You' : m.sender === 'staff' ? 'Hotel team' : 'Returnly'} · {when(m.created_at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line leading-relaxed">{m.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {view.can_reply ? (
            <form onSubmit={onReply} className="mt-5 space-y-2">
              <label htmlFor="trk-reply" className="label">
                {view.status === 'awaiting_customer' ? 'Your answer' : 'Add a message for the team'}
              </label>
              <textarea id="trk-reply" className="field min-h-24" maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />
              <p className="hint">Don’t send card numbers, passport numbers or passwords.</p>
              {replyError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{replyError}</p>}
              <button type="submit" className="btn btn-primary" disabled={sending || !reply.trim()}>
                {sending ? 'Sending…' : 'Send message'}
              </button>
            </form>
          ) : (
            <p className="mt-5 hint">This enquiry is closed, so new messages can’t be added.</p>
          )}
        </section>
      )}
    </div>
  )
}
