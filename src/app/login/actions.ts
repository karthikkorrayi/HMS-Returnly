'use server'

import { redirect } from 'next/navigation'
import { signInDestination } from '@/lib/sign-in-destination'
import { createClient } from '@/lib/supabase/server'
import { USERNAME_PATTERN, usernameToEmail } from '@/lib/auth'
import type { ActionState } from '@/lib/types'

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const username = String(formData.get('username') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')

  if (!USERNAME_PATTERN.test(username) || !password) {
    return { error: 'Enter your username and password.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  })
  if (error || !data.user) {
    return { error: 'Username or password is incorrect.' }
  }

  const { data: staff } = await supabase
    .from('staff')
    .select('active')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (!staff?.active) {
    await supabase.auth.signOut()
    return { error: 'This account is not active. Ask a manager.' }
  }

  redirect(signInDestination(formData.get('next')))
}
