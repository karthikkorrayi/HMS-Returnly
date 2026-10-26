'use client'

import { useActionState, useState } from 'react'
import { finishSignIn } from './actions'
import { initialActionState, type ActionState } from '@/lib/types'
import { USERNAME_PATTERN } from '@/lib/better-auth/rules'
import ReturnlyIcon from '@/components/ReturnlyIcon'

// Signing in is two steps:
//   1. the browser sends the username and password to Better Auth, which
//      checks them, applies the sign-in rate limit and sets the session cookie;
//   2. the server action finishSignIn checks the login belongs to an active
//      staff member, then opens their page.
async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const username = String(formData.get('username') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!USERNAME_PATTERN.test(username) || !password) {
    return { error: 'Enter your username and password.' }
  }

  let res: Response
  try {
    res = await fetch('/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    })
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null
    // A username locked after too many wrong passwords, or a deactivated
    // account (only reported once the password was right).
    if ((body?.code === 'USERNAME_LOCKED' || body?.code === 'ACCOUNT_DISABLED') && body.message) return { error: body.message }
    if (res.status === 429) return { error: 'Too many attempts. Wait a minute, then try again.' }
    return { error: 'Username or password is incorrect.' }
  }

  return finishSignIn(formData.get('next'))
}

export default function LoginForm({ next = '/items' }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialActionState)
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
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
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            className="field pr-14"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            aria-controls="password"
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-muted hover:text-teal"
          >
            <ReturnlyIcon name={showPassword ? 'eye-off' : 'eye'} />
          </button>
        </div>
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
