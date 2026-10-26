'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { MAX_PASSWORD as MAX, MIN_PASSWORD as MIN } from '@/lib/better-auth/rules'
import { initialActionState } from '@/lib/types'
import { changePassword } from './actions'

export default function PasswordForm({ username }: { username: string }) {
  const [state, formAction, pending] = useActionState(changePassword, initialActionState)
  const [show, setShow] = useState(false)
  const form = useRef<HTMLFormElement>(null)

  // Clear the fields after a successful change.
  useEffect(() => {
    if (state.ok) form.current?.reset()
  }, [state])

  const type = show ? 'text' : 'password'
  return (
    <form ref={form} action={formAction} className="space-y-4">
      {/* Lets password managers save the new password against the right username. */}
      <input type="text" name="username" value={username} autoComplete="username" readOnly hidden />
      <div>
        <label htmlFor="current_password" className="label">Current password</label>
        <input id="current_password" name="current_password" type={type} className="field" autoComplete="current-password" required />
      </div>
      <div>
        <label htmlFor="new_password" className="label">New password</label>
        <input id="new_password" name="new_password" type={type} className="field" autoComplete="new-password" minLength={MIN} maxLength={MAX} required />
        <p className="hint mt-1">{MIN}–{MAX} characters. A short sentence is easy to remember and hard to guess.</p>
      </div>
      <div>
        <label htmlFor="confirm_password" className="label">New password again</label>
        <input id="confirm_password" name="confirm_password" type={type} className="field" autoComplete="new-password" minLength={MIN} maxLength={MAX} required />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show passwords
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="rounded-lg bg-teal-soft px-3 py-2 text-sm text-teal-dark">
          Password changed. Any other phones or computers signed in as you have been signed out.
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  )
}
