'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/types'

const num = (f: FormData, k: string) => Number(String(f.get(k) ?? '').trim())

export async function saveSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session || session.staff.role !== 'manager') return { error: 'Only managers can change settings.' }

  const items = num(f, 'retention_days')
  const requests = num(f, 'request_retention_days')
  if (!Number.isInteger(items) || items < 7 || items > 730) return { error: 'Keep unclaimed items for 7 to 730 days.' }
  if (!Number.isInteger(requests) || requests < 30 || requests > 1095) {
    return { error: 'Keep closed enquiries for 30 to 1,095 days.' }
  }

  // The stay-log settings (trace window, stay retention, room check deadline)
  // are no longer shown since Rooms and Stays were removed; their stored
  // values are kept as they are.
  const p = session.property
  const supabase = await createClient()
  const { error } = await supabase.rpc('update_property_settings', {
    p_trace_window_days: p.trace_window_days,
    p_stay_retention_days: p.stay_retention_days,
    p_check_due_hours: p.check_due_hours,
    p_retention_days: items,
  })
  if (error) return { error: error.message }
  const { error: reqError } = await supabase.rpc('update_request_settings', { p_request_retention_days: requests })
  if (reqError) return { error: reqError.message }

  revalidatePath('/', 'layout')
  return { error: null, ok: true }
}
