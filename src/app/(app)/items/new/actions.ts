'use server'

import { revalidatePath } from 'next/cache'
import { ITEM_ROLES, getSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { LogItemError, logItem, type LogItemInput } from '@/lib/log-item'

// Saves the item (photos are uploaded afterwards, one by one, to
// /api/items/<id>/photos). Re-checks the session; the database checks the
// rest (own hotel, own name, room on the list).
export async function saveItem(input: LogItemInput): Promise<{ id: string } | { error: string }> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  if (!ITEM_ROLES.includes(session.staff.role)) return { error: 'Your role can’t log items.' }
  try {
    const id = await withStaff(session.staff.user_id, (tx) => logItem(tx, session.staff.user_id, session.property.id, input))
    revalidatePath('/items')
    return { id }
  } catch (e) {
    if (e instanceof LogItemError) return { error: e.message }
    console.error('log item failed', e)
    return { error: 'The item could not be saved. Please try again.' }
  }
}
