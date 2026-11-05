import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadAccessLog } from '@/lib/access-log'
import { formatDateTime } from '@/lib/format'
import { staffPath } from '@/lib/staff-paths'

// Managers: who opened which customer report, and when (the last 100).
export default async function AccessLogPage() {
  const { staff, property } = await requireSession(['manager'])
  const rows = await withStaff(staff.user_id, (tx) => loadAccessLog(tx, 100))
  const to = (p: string) => staffPath(property.slug, p)

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={to('/settings')} className="text-sm font-semibold text-teal">← Settings</Link>
      <div>
        <h1 className="text-2xl font-bold">Access log</h1>
        <p className="hint mt-1">Every time a staff member opens a customer’s report (which shows their name, email and booking ID). Kept for a year; it can’t be changed or deleted.</p>
      </div>
      {rows.length === 0 ? (
        <p className="panel p-5 text-muted">No reports opened yet.</p>
      ) : (
        <ul className="panel divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 p-3">
              <span>
                <span className="font-semibold">{r.staff_name}</span> opened{' '}
                {r.request_id ? <Link href={to(`/requests/${r.request_id}`)} className="font-semibold text-teal underline">{r.reference}</Link> : <span className="font-semibold">{r.reference}</span>}
                {!r.request_id && <span className="hint"> (report since deleted)</span>}
              </span>
              <span className="hint">{formatDateTime(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
