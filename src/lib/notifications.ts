// In-app notifications for hotel staff (migration 018). Read through row-level
// security: managers see their hotel's notifications, anyone sees the ones
// addressed to them ("assigned to you"). Read/unread is per person.
// Only managers and support staff get notifications. No Next.js imports, so
// tests can run it.
import type { Tx } from '@/lib/db/core'
import type { StaffRole } from '@/lib/types'

export const NOTIFIED_ROLES: StaffRole[] = ['manager', 'support']
/** Notifications older than this are not shown (they stay until the report is deleted). */
export const SHOW_DAYS = 30

export type StaffNotification = {
  id: number
  request_id: string
  kind: 'new_report' | 'customer_replied' | 'assigned'
  message: string
  created_at: string
  read: boolean
}

export async function loadNotifications(tx: Tx, limit = 50): Promise<StaffNotification[]> {
  const { rows } = await tx.query<StaffNotification>(
    `select n.id::float8 as id, n.request_id, n.kind, n.message, n.created_at,
            exists (select 1 from public.staff_notification_reads r where r.notification_id = n.id and r.user_id = auth.uid()) as read
       from public.staff_notifications n
      where n.created_at > now() - make_interval(days => $2)
      order by n.id desc limit $1`,
    [Math.min(Math.max(limit, 1), 200), SHOW_DAYS]
  )
  return rows
}

export async function unreadCount(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from public.staff_notifications n
      where n.created_at > now() - make_interval(days => $1)
        and not exists (select 1 from public.staff_notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())`,
    [SHOW_DAYS]
  )
  return rows[0]?.n ?? 0
}

/** Marks one notification (or all of mine when id is null) as read. Returns how many changed. */
export async function markRead(tx: Tx, id: number | null): Promise<number> {
  if (id !== null && !(Number.isSafeInteger(id) && id > 0)) throw new Error('Unknown notification.')
  const r = await tx.rpc<{ mark_notifications_read: number }>('mark_notifications_read', { p_ids: id === null ? null : String(id) })
  return r.rows[0].mark_notifications_read
}

/** The request a notification points to, if this person can see the notification. */
export async function notificationTarget(tx: Tx, id: number): Promise<string | null> {
  const { rows } = await tx.query<{ request_id: string }>(`select request_id from public.staff_notifications where id = $1`, [id])
  return rows[0]?.request_id ?? null
}
