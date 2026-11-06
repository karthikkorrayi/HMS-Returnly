'use client'
import { useId } from 'react'

// "Is this your correct email address?" — shown before a report is sent. The
// report is only sent after "Yes, send"; "Change it" goes back to the field.
// This in-app confirmation replaces email verification (by decision).
export default function EmailConfirm({
  email,
  question,
  hint,
  busy,
  onYes,
  onChange,
}: {
  email: string
  question: string
  hint: string | null
  busy: boolean
  onYes: () => void
  onChange: () => void
}) {
  const uid = useId()
  return (
    <div role="alertdialog" aria-labelledby={`${uid}-question`} aria-describedby={`${uid}-address`}
      className="rounded-xl border border-teal bg-teal-soft p-4">
      <p id={`${uid}-question`} className="font-semibold">{question}</p>
      <p id={`${uid}-address`} className="mt-2 break-all text-lg font-bold">{email}</p>
      {hint && <p className="mt-1 text-sm text-attention">{hint}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" onClick={onYes} disabled={busy} autoFocus>
          {busy ? 'Sending…' : 'Yes, send'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onChange} disabled={busy}>
          No, change it
        </button>
      </div>
    </div>
  )
}
