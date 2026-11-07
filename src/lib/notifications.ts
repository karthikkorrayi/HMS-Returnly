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

/**
 * What the live bell needs every poll, and nothing more: my unread count, the
 * newest notification id I can see, and up to 3 that are newer than `since`
 * (for the pop-ups). `since` null = first poll: no pop-ups, just the baseline.
 * A few hundred bytes instead of the full list (loadNotifications).
 */
export type NotificationPulse = { count: number; latest: number; fresh: StaffNotification[] }
export async function notificationPulse(tx: Tx, since: number | null): Promise<NotificationPulse> {
  if (since !== null && !(Number.isSafeInteger(since) && since >= 0)) throw new Error('Unknown notification.')
  const count = await unreadCount(tx)
  const { rows } = await tx.query<{ latest: number }>(
    `select coalesce(max(n.id), 0)::float8 as latest from public.staff_notifications n
      where n.created_at > now() - make_interval(days => $1)`,
    [SHOW_DAYS]
  )
  const latest = rows[0]?.latest ?? 0
  if (since === null || latest <= since) return { count, latest, fresh: [] }
  const fresh = await tx.query<StaffNotification>(
    `select n.id::float8 as id, n.request_id, n.kind, n.message, n.created_at, false as read
       from public.staff_notifications n
      where n.id > $1 and n.created_at > now() - make_interval(days => $2)
        and not exists (select 1 from public.staff_notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
      order by n.id desc limit 3`,
    [since, SHOW_DAYS]
  )
  return { count, latest, fresh: fresh.rows }
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
