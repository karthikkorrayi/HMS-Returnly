'use server'

import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/better-auth/instance'
import { withAnon } from '@/lib/db'
import { buildSetup, runInitialSetup, setupTokenConfigured, setupTokenMatches, SetupError } from '@/lib/setup'
import type { ActionState } from '@/lib/types'

const str = (f: FormData, k: string) => String(f.get(k) ?? '')
const all = (f: FormData, k: string) => f.getAll(k).map((v) => String(v))

// The one-time setup. Order: setup key → form checks → database (which also
// refuses if setup already happened). A wrong key waits a second before
// answering, on top of the key being long and random.
export async function completeSetup(_p: ActionState, f: FormData): Promise<ActionState> {
  const expected = process.env.SETUP_TOKEN
  if (!setupTokenConfigured(expected)) {
    return { error: 'Setup is locked: SETUP_TOKEN is not set (or is shorter than 24 characters) on the server.' }
  }
  if (!setupTokenMatches(str(f, 'setup_token').trim(), expected)) {
    await new Promise((r) => setTimeout(r, 1000))
    return { error: 'The setup key is not correct.' }
  }
  let username: string
  try {
    const input = buildSetup({
      code: str(f, 'code'), name: str(f, 'name'), address: str(f, 'address'), phone: str(f, 'phone'), email: str(f, 'email'),
      supportHours: str(f, 'support_hours'), supportNote: str(f, 'support_note'),
      floorNames: all(f, 'floor_name'), floorRooms: all(f, 'floor_rooms'),
      areas: str(f, 'areas'),
      storageLabels: all(f, 'storage_label'), storageKinds: all(f, 'storage_kind'),
      adminName: str(f, 'admin_name'), adminUsername: str(f, 'admin_username'),
      adminPassword: str(f, 'admin_password'), adminPassword2: str(f, 'admin_password2'),
    })
    username = input.admin.username
    await runInitialSetup({ auth: await getAuth(), withAnon }, input)
  } catch (e) {
    if (e instanceof SetupError) return { error: e.message }
    console.error('initial setup failed', e)
    return { error: 'Setup could not be completed. Nothing was saved. Please try again.' }
  }
  redirect(`/login?setup=done&u=${encodeURIComponent(username)}`)
}
