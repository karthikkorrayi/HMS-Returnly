'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { BrandingError, saveBranding } from '@/lib/branding'
import { configMessage } from '@/lib/hotel-config'
import type { ActionState } from '@/lib/types'

// Managers only; the database checks again (update_hotel_branding, migration 019).
export async function saveBrandingAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  if (session.staff.role !== 'manager') return { error: 'Only managers can change the hotel’s branding.' }
  try {
    await withStaff(session.staff.user_id, (tx) =>
      saveBranding(tx, { slug: String(f.get('slug') ?? ''), colour: String(f.get('colour') ?? ''), intro: String(f.get('intro') ?? '') }))
  } catch (e) {
    const message = e instanceof BrandingError ? e.message : configMessage(e)
    if (!message) console.error('branding change failed', e)
    return { error: message || 'That change could not be saved. Please try again.' }
  }
  revalidatePath('/', 'layout')
  return { error: null, ok: true }
}
