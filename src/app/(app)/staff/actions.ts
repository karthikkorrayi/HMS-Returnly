'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { getAuth } from '@/lib/better-auth/instance'
import { withStaff } from '@/lib/db'
import { StaffAdminError, addStaff, setStaffActive, setStaffPassword, updateStaff } from '@/lib/staff-admin'
import type { ActionState } from '@/lib/types'

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

// Every action re-checks the caller here, and the database checks again
// (only an active manager can write staff rows, and only for their hotel).
async function requireManager() {
  const session = await getSession()
  if (!session || session.staff.role !== 'manager') return null
  return session
}

async function attempt(fn: () => Promise<void>, failure: string): Promise<ActionState> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof StaffAdminError) return { error: e.message }
    console.error(failure, e)
    return { error: `${failure} Please try again.` }
  }
  revalidatePath('/staff')
  return { error: null, ok: true }
}

export async function createStaff(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can add staff.' }
  return attempt(async () => {
    await addStaff(await getAuth(), withStaff, session.staff.user_id, {
      username: str(f, 'username'),
      displayName: str(f, 'display_name'),
      role: str(f, 'role'),
      password: String(f.get('password') ?? ''),
    })
  }, 'Could not add the staff member.')
}

export async function resetPassword(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can reset passwords.' }
  return attempt(
    async () => setStaffPassword(await getAuth(), withStaff, session.staff.user_id, str(f, 'user_id'), String(f.get('password') ?? '')),
    'Could not set the new password.'
  )
}

export async function setActive(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can change access.' }
  const userId = str(f, 'user_id')
  if (userId === session.staff.user_id) return { error: 'You can’t deactivate yourself.' }
  return attempt(
    async () => setStaffActive(await getAuth(), withStaff, session.staff.user_id, userId, str(f, 'active') === 'true'),
    'Could not change access.'
  )
}

export async function editStaff(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can change staff.' }
  return attempt(
    () => updateStaff(withStaff, session.staff.user_id, str(f, 'user_id'), { displayName: str(f, 'display_name'), role: str(f, 'role') }),
    'Could not save the change.'
  )
}
