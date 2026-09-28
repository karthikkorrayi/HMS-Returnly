'use server'

import { revalidatePath } from 'next/cache'
import { getSession, USERNAME_PATTERN, usernameToEmail } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ActionState, StaffRole } from '@/lib/types'

const ROLES: StaffRole[] = ['housekeeping', 'front_office', 'manager']
const MIN_PASSWORD = 10
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

// These actions use the service key, so the manager check here is the only
// gate. Every action re-verifies the caller and scopes to their hotel.
async function requireManager() {
  const session = await getSession()
  if (!session || session.staff.role !== 'manager') return null
  return session
}

// Confirms the target belongs to the manager's hotel (read through RLS).
async function staffInMyHotel(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('staff').select('user_id').eq('user_id', userId).maybeSingle()
  return Boolean(data)
}

export async function createStaff(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can add staff.' }

  const username = str(f, 'username').toLowerCase()
  const displayName = str(f, 'display_name')
  const role = str(f, 'role') as StaffRole
  const password = String(f.get('password') ?? '')

  if (!USERNAME_PATTERN.test(username))
    return { error: 'Username: 3–32 characters, lowercase letters, numbers, dots, dashes or underscores.' }
  if (!displayName || displayName.length > 80) return { error: 'Enter the person’s name as colleagues know it.' }
  if (!ROLES.includes(role)) return { error: 'Choose a role.' }
  if (password.length < MIN_PASSWORD) return { error: `Temporary password must be at least ${MIN_PASSWORD} characters.` }

  const admin = createAdminClient()
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username },
  })
  if (authError || !created.user) {
    const taken = authError?.message.toLowerCase().includes('already')
    return { error: taken ? 'That username is already taken.' : `Could not create login: ${authError?.message}` }
  }

  const { error: staffError } = await admin.from('staff').insert({
    user_id: created.user.id,
    property_id: session.property.id,
    username,
    display_name: displayName,
    role,
  })
  if (staffError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return {
      error: staffError.code === '23505' ? 'That username is already taken.' : `Could not add staff: ${staffError.message}`,
    }
  }

  revalidatePath('/staff')
  return { error: null, ok: true }
}

export async function resetPassword(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can reset passwords.' }
  const userId = str(f, 'user_id')
  const password = String(f.get('password') ?? '')
  if (password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` }
  if (!(await staffInMyHotel(userId))) return { error: 'Staff member not found.' }

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password })
  if (error) return { error: error.message }
  return { error: null, ok: true }
}

export async function setActive(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await requireManager()
  if (!session) return { error: 'Only managers can change access.' }
  const userId = str(f, 'user_id')
  const active = str(f, 'active') === 'true'
  if (userId === session.staff.user_id) return { error: 'You can’t deactivate yourself.' }
  if (!(await staffInMyHotel(userId))) return { error: 'Staff member not found.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('staff')
    .update({ active })
    .eq('user_id', userId)
    .eq('property_id', session.property.id)
  if (error) return { error: error.message }

  // Block sign-in at the auth layer too, not just in the app.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : '876000h',
  })
  if (banError) return { error: `Access updated, but sign-in block failed: ${banError.message}` }

  revalidatePath('/staff')
  return { error: null, ok: true }
}
