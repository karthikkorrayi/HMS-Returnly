'use client'

import { useActionState } from 'react'
import { signIn } from './actions'
import { initialActionState } from '@/lib/types'

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialActionState)

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="username" className="label">Username</label>
        <input
          id="username"
          name="username"
          className="field"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
