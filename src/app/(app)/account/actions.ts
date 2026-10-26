'use server'

import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { getAuth } from '@/lib/better-auth/instance'
import { OwnPasswordError, changeOwnPassword } from '@/lib/better-auth/own-password'
import type { ActionState } from '@/lib/types'

// Any active staff member may change their own password. Better Auth checks
// the current password; the new session cookie is set by nextCookies().
export async function changePassword(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  try {
    await changeOwnPassword(await getAuth(), await headers(), {
      current: String(f.get('current_password') ?? ''),
      next: String(f.get('new_password') ?? ''),
      confirm: String(f.get('confirm_password') ?? ''),
    })
  } catch (e) {
    if (e instanceof OwnPasswordError) return { error: e.message }
    console.error('own password change failed', e)
    return { error: 'Could not change the password. Please try again.' }
  }
  return { error: null, ok: true }
}
