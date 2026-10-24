'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { withStaff, type Tx } from '@/lib/db'
import * as act from '@/lib/request-actions'
import type { ActionState } from '@/lib/types'

// Each action re-checks the session, then runs as that staff member in one
// transaction; the database functions enforce who may do what (Admin vs
// assigned Support) and which status moves are allowed.

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

async function run(f: FormData, fn: (tx: Tx, id: string) => Promise<void>): Promise<ActionState> {
  const session = await getSession()
  if (!session) return { error: 'Your session has ended. Sign in again.' }
  if (session.staff.role !== 'manager' && session.staff.role !== 'support') {
    return { error: 'Only Admin and Support staff can work on customer requests.' }
  }
  const id = str(f, 'request_id')
  try {
    act.checkRequestId(id)
    await withStaff(session.staff.user_id, (tx) => fn(tx, id))
  } catch (e) {
    const message = act.messageFor(e)
    if (!message) console.error('request action failed', e)
    return { error: message || 'Something went wrong. Please try again.' }
  }
  revalidatePath(`/requests/${id}`)
  revalidatePath('/requests')
  revalidatePath('/support')
  return { error: null, ok: true }
}

export async function changeRequestStatus(_p: ActionState, f: FormData) {
  return run(f, (tx, id) => act.changeStatus(tx, id, str(f, 'to'), str(f, 'note') || null))
}

export async function assignRequest(_p: ActionState, f: FormData) {
  return run(f, (tx, id) => act.assign(tx, id, str(f, 'staff_id') || null))
}

export async function addRequestNote(_p: ActionState, f: FormData) {
  return run(f, (tx, id) => act.addNote(tx, id, str(f, 'body')))
}

export async function messageCustomer(_p: ActionState, f: FormData) {
  return run(f, (tx, id) => act.messageCustomer(tx, id, str(f, 'body'), f.get('ask') === 'on'))
}

// Approval is always a person choosing a specific item: by id (from the match
// list) or by the code on the item's tag.
export async function approveRequest(_p: ActionState, f: FormData) {
  return run(f, (tx, id) =>
    act.approve(tx, id, { itemId: str(f, 'item_id') || null, itemCode: str(f, 'item_code') || null, note: str(f, 'note') || null })
  )
}
