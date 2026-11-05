'use client'

import { startTransition, useActionState } from 'react'
import { goToHotelLogin } from './actions'
import { initialActionState } from '@/lib/types'

// "Enter your hotel code" → /h/<slug>/login. Submitted by hand so the typed
// code stays if it isn't found.
export default function HotelFinder({ next }: { next: string }) {
  const [state, action, pending] = useActionState(goToHotelLogin, initialActionState)
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="hotel" className="label">Hotel code</label>
        <input id="hotel" name="hotel" className="field" autoCapitalize="characters" autoComplete="organization"
          spellCheck={false} maxLength={40} required placeholder="e.g. GRAND" />
        <p className="hint mt-1">On your item tags and from your manager. Your hotel’s sign-in page is also at /h/&lt;code&gt;/login.</p>
      </div>
      {state.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? 'Finding…' : 'Continue'}</button>
    </form>
  )
}
