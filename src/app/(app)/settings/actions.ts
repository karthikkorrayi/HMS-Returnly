'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { saveHotelSettings } from '@/lib/hotel-settings'
import { messageFor } from '@/lib/item-actions'
import type { ActionState } from '@/lib/types'

const num = (f: FormData, k: string) => Number(String(f.get(k) ?? '').trim())

export async function saveSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session || session.staff.role !== 'manager') return { error: 'Only managers can change settings.' }
  try {
    await withStaff(session.staff.user_id, (tx) =>
      saveHotelSettings(tx, session.property, num(f, 'retention_days'), num(f, 'request_retention_days'))
    )
  } catch (e) {
    const message = messageFor(e)
    if (!message) console.error('settings save failed', e)
    return { error: message || 'The settings could not be saved. Please try again.' }
  }
  revalidatePath('/', 'layout')
  return { error: null, ok: true }
}
