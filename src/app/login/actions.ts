'use server'

import { redirect } from 'next/navigation'
import { signInDestination } from '@/lib/sign-in-destination'
import { currentLogin, endCurrentSession, getSession } from '@/lib/auth'
import type { ActionState } from '@/lib/types'

// Step 2 of signing in. Step 1 is the browser posting the username and
// password to Better Auth (/api/auth/sign-in/username), so its rate limit and
// our cross-site check apply. Here we only check the new session belongs to
// an ACTIVE staff member; if not, the session is ended straight away.
export async function finishSignIn(next: unknown): Promise<ActionState> {
  if (!(await currentLogin())) {
    return { error: 'Sign-in did not complete. Please try again.' }
  }
  if (!(await getSession())) {
    await endCurrentSession()
    return { error: 'This account is not active. Ask a manager.' }
  }
  redirect(signInDestination(next))
}
