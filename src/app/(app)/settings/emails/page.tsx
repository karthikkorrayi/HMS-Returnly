import RecordFilters from '@/components/workspace/RecordFilters'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { staffPath } from '@/lib/staff-paths'
import { withStaff } from '@/lib/db'
import { EMAIL_STATUS_LABEL, EMAIL_TEMPLATE_LABEL, loadEmailLog, maskEmail } from '@/lib/email-log'
import { formatDateTime } from '@/lib/format'

// Managers: what was emailed to customers, and whether it went. The copy shown
// is exactly what the customer received, with the private link blanked out.
export default async function EmailsPage() {
  const { staff, property } = await requireSession(['manager'])
  const rows = await withStaff(staff.user_id, (tx) => loadEmailLog(tx, 50))
  const tone = (s: string) =>
    s === 'sent' ? 'bg-done-soft text-done' : s === 'failed' ? 'bg-danger-soft text-danger' : ['retry', 'queued', 'sending'].includes(s) ? 'bg-attention-soft text-attention' : 'bg-paper text-muted'

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={staffPath(property.slug, '/settings')} className="text-sm font-semibold text-teal">← Settings</Link>
      <div>
        <h1 className="text-2xl font-bold">Customer emails</h1>
        <p className="hint mt-1">The last 50 emails to customers about this hotel’s reports. Sent from Foundora’s address with your hotel’s name. Private links are hidden here.</p>
      </div>
      {rows.length === 0 ? (
        <p className="panel p-5 text-muted">No customer emails yet. They are created when a customer sends a report with their email address.</p>
      ) : (
        <RecordFilters scope="latest 50 customer emails" records={rows.map((e) => ({id:String(e.id),search:`${e.reference} ${maskEmail(e.recipient)} ${e.subject??''}`,status:e.status,kind:e.template,date:e.sent_at??e.created_at}))} statusLabels={EMAIL_STATUS_LABEL} kindLabels={EMAIL_TEMPLATE_LABEL}>
          {rows.map((e) => (
            <div key={e.id} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{EMAIL_TEMPLATE_LABEL[e.template] ?? e.template}</span>
                <span className={`badge ${tone(e.status)}`}>{EMAIL_STATUS_LABEL[e.status] ?? e.status}</span>
              </div>
              <p className="hint mt-1">
                {e.reference} · to {maskEmail(e.recipient)} · {formatDateTime(e.sent_at ?? e.created_at)}
                {e.attempts > 1 ? ` · ${e.attempts} attempts` : ''}
                {e.last_error && e.status !== 'sent' ? ` · ${e.last_error}` : ''}
              </p>
              {e.subject && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-teal">{e.subject}</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-paper p-3 font-sans text-sm">{e.body_text}</pre>
                </details>
              )}
            </div>
          ))}
        </RecordFilters>
      )}
    </div>
  )
}
