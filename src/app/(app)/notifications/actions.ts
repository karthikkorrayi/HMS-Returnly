'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { markRead, notificationTarget, notificationPulse, NOTIFIED_ROLES, unreadCount, loadNotifications, type NotificationPulse } from '@/lib/notifications'
import { staffPath } from '@/lib/staff-paths'

// Each action re-checks the session; the database decides which
// notifications this person may see or mark.

async function staff() {
  const session = await getSession()
  return session && NOTIFIED_ROLES.includes(session.staff.role) ? { ...session.staff, slug: session.property.slug } : null
}

/** For the bell: polled while the page is open. 0 when signed out or not notified. */
export async function unreadNotificationCount(): Promise<number> {
  const me = await staff()
  if (!me) return 0
  try {
    return await withStaff(me.user_id, unreadCount)
  } catch {
    return 0
  }
}

/** Open a notification: mark it read and go to its report. */
export async function openNotification(formData: FormData): Promise<void> {
  const me = await staff()
  if (!me) redirect('/login')
  const id = Number(formData.get('id'))
  if (!Number.isSafeInteger(id) || id <= 0) redirect(staffPath(me.slug, '/notifications'))
  const target = await withStaff(me.user_id, async (tx) => {
    const requestId = await notificationTarget(tx, id)
    if (requestId) await markRead(tx, id)
    return requestId
  })
  redirect(staffPath(me.slug, target ? `/requests/${target}` : '/notifications'))
}

export async function markAllNotificationsRead(): Promise<void> {
  const me = await staff()
  if (!me) redirect('/login')
  await withStaff(me.user_id, (tx) => markRead(tx, null))
  revalidatePath('/', 'layout')
}

/** Authorised snapshot; errors are propagated so the client can distinguish an outage. */
export async function notificationSnapshot() {
  const me = await staff()
  if (!me) return null
  return withStaff(me.user_id, async (tx) => ({
    count: await unreadCount(tx), items: await loadNotifications(tx, 200),
  }))
}

/**
 * For the live bell (NotificationLive), every 30 seconds: unread count, newest
 * id and at most 3 new ones. Null when signed out or not notified; errors are
 * propagated so the client can tell an outage from "nothing new".
 */
export async function notificationPulseNow(since: number | null): Promise<NotificationPulse | null> {
  const me = await staff()
  if (!me) return null
  const s = since === null ? null : Number(since)
  return withStaff(me.user_id, (tx) => notificationPulse(tx, s))
}
