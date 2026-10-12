'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { REQUEST_STATUSES, type RequestStatus } from '@/lib/requests/types'
import type { ActionState } from '@/lib/types'

// Each action re-checks the session; the database functions then enforce who
// may do what (Admin vs assigned Support) and which status moves are allowed.

const UUID = /^[0-9a-f-]{36}$/i
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

async function run(
  f: FormData,
  fn: (supabase: Awaited<ReturnType<typeof createClient>>, id: string) => PromiseLike<{ error: { message: string } | null }>
): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  if (session.staff.role !== 'manager' && session.staff.role !== 'support') {
    return { error: 'Only Admin and Support staff can work on customer requests.' }
  }
  const id = str(f, 'request_id')
  if (!UUID.test(id)) return { error: 'Unknown request.' }

  const supabase = await createClient()
  const { error } = await fn(supabase, id)
  if (error) return { error: error.message }
  revalidatePath(`/requests/${id}`)
  revalidatePath('/requests')
  revalidatePath('/support')
  return { error: null, ok: true }
}

export async function changeRequestStatus(_p: ActionState, f: FormData) {
  const to = str(f, 'to') as RequestStatus
  if (!REQUEST_STATUSES.includes(to)) return { error: 'Unknown status.' }
  return run(f, (s, id) => s.rpc('set_request_status', { p_request_id: id, p_to: to, p_note: str(f, 'note') || null }))
}

export async function assignRequest(_p: ActionState, f: FormData) {
  const staffId = str(f, 'staff_id')
  if (staffId && !UUID.test(staffId)) return { error: 'Unknown staff member.' }
  return run(f, (s, id) => s.rpc('assign_request', { p_request_id: id, p_staff_id: staffId || null }))
}

export async function addRequestNote(_p: ActionState, f: FormData) {
  const body = str(f, 'body')
  if (!body) return { error: 'Write a note first.' }
  return run(f, (s, id) => s.rpc('add_request_note', { p_request_id: id, p_body: body }))
}

export async function messageCustomer(_p: ActionState, f: FormData) {
  const body = str(f, 'body')
  if (!body) return { error: 'Write a message first.' }
  return run(f, (s, id) =>
    s.rpc('message_customer', { p_request_id: id, p_body: body, p_ask: f.get('ask') === 'on' })
  )
}

// Approval is always a person choosing a specific item. By item id (from the
// match list) or by the code on the item's tag.
export async function approveRequest(_p: ActionState, f: FormData) {
  return run(f, async (s, id) => {
    let itemId = str(f, 'item_id')
    const code = str(f, 'item_code').toUpperCase()
    if (!UUID.test(itemId)) {
      if (!/^[A-Z0-9]{3,10}-\d{6}-\d{4,}$/.test(code)) return { error: { message: 'Enter the item code from the tag, e.g. DEMO-261013-0042.' } }
      const { data, error } = await s.from('lost_items').select('id').eq('item_code', code).maybeSingle()
      if (error) return { error }
      if (!data) return { error: { message: `No item with code ${code}.` } }
      itemId = data.id
    }
    return s.rpc('approve_request', { p_request_id: id, p_item_id: itemId, p_note: str(f, 'note') || null })
  })
}
