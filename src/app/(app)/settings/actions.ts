'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/types'

const num = (f: FormData, k: string) => Number(String(f.get(k) ?? '').trim())

export async function saveSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  const session = await getSession()
  if (!session || session.staff.role !== 'manager') return { error: 'Only managers can change settings.' }

  const v = {
    trace: num(f, 'trace_window_days'),
    stays: num(f, 'stay_retention_days'),
    check: num(f, 'check_due_hours'),
    items: num(f, 'retention_days'),
  }
  if (!Number.isInteger(v.trace) || v.trace < 7 || v.trace > 120) return { error: 'Trace window: 7 to 120 days.' }
  if (!Number.isInteger(v.stays) || v.stays < 30 || v.stays > 730) return { error: 'Keep stays for 30 to 730 days.' }
  if (v.stays < v.trace) return { error: 'Stays must be kept at least as long as the trace window.' }
  if (!Number.isInteger(v.check) || v.check < 1 || v.check > 48) return { error: 'Room check deadline: 1 to 48 hours.' }
  if (!Number.isInteger(v.items) || v.items < 7 || v.items > 730) return { error: 'Keep unclaimed items for 7 to 730 days.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_property_settings', {
    p_trace_window_days: v.trace,
    p_stay_retention_days: v.stays,
    p_check_due_hours: v.check,
    p_retention_days: v.items,
  })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
  return { error: null, ok: true }
}
