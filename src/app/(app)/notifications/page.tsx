import RecordFilters from '@/components/workspace/RecordFilters'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadNotifications, SHOW_DAYS } from '@/lib/notifications'
import { formatDateTime } from '@/lib/format'
import { markAllNotificationsRead, openNotification } from './actions'

// Managers and support staff: new reports, guest replies, assignments.
export default async function NotificationsPage() {
  const { staff } = await requireSession(['manager', 'support'])
  const items = await withStaff(staff.user_id, (tx) => loadNotifications(tx, 50))
  const unread = items.filter((n) => !n.read).length

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="hint mt-1">
            {unread ? `${unread} unread` : 'All read'} · the last {SHOW_DAYS} days
          </p>
        </div>
        {unread > 0 && (
          <form action={markAllNotificationsRead}>
            <button className="btn btn-secondary">Mark all as read</button>
          </form>
        )}
      </div>
      {items.length === 0 ? (
        <p className="panel p-5 text-muted">Nothing yet. New reports, guest replies and reports assigned to you appear here.</p>
      ) : (
        <RecordFilters scope={`latest 50 notifications in the last ${SHOW_DAYS} days`} records={items.map((n) => ({id:String(n.id),search:n.message,status:n.read?'read':'unread',kind:n.kind,date:n.created_at}))} statusLabels={{read:'Read',unread:'Unread'}} kindLabels={{new_report:'New report',customer_replied:'Guest reply',assigned:'Assignment'}}>
          {items.map((n) => (
            <div key={n.id} className="panel overflow-hidden">
              <form action={openNotification}>
                <input type="hidden" name="id" value={n.id} />
                <button className={`flex w-full items-start gap-3 p-4 text-left hover:bg-teal-soft ${n.read ? '' : 'bg-paper'}`}>
                  <span aria-hidden="true" className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-teal'}`} />
                  <span className="min-w-0">
                    <span className={`block ${n.read ? '' : 'font-semibold'}`}>
                      <span className="sr-only">{n.read ? 'Read: ' : 'Unread: '}</span>
                      {n.message}
                    </span>
                    <span className="hint block">{formatDateTime(n.created_at)}</span>
                  </span>
                </button>
              </form>
            </div>
          ))}
        </RecordFilters>
      )}
    </div>
  )
}
