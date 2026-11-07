import RecordFilters from '@/components/workspace/RecordFilters'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { CONTACTS_LIMIT, countGuestContacts, loadGuestContacts, logContactsView } from '@/lib/guest-contacts'
import { formatDate } from '@/lib/format'
import { staffPath } from '@/lib/staff-paths'

// Managers: one row per guest email (migration 024). Records only — nothing
// here sends email. Opening this page is written to the access log.
export default async function GuestContactsPage() {
  const { staff, property } = await requireSession(['manager'])
  const { rows, total } = await withStaff(staff.user_id, async (tx) => {
    await logContactsView(tx)
    return { rows: await loadGuestContacts(tx), total: await countGuestContacts(tx) }
  })
  const to = (p: string) => staffPath(property.slug, p)
  const scope = total > CONTACTS_LIMIT ? `the ${CONTACTS_LIMIT} most recently seen of ${total}` : 'all guest contacts'

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={to('/settings')} className="text-sm font-semibold text-teal">← Settings</Link>
      <div>
        <h1 className="text-2xl font-bold">Guest contacts</h1>
        <p className="hint mt-1">
          One entry per email address that sent this hotel a lost or found report — never duplicated. For your records only:
          nothing is emailed from here. An address is removed automatically the night after the hotel no longer holds any report
          from it (see “How long records are kept” in Settings). Opening this page is recorded in the access log.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="panel p-5 text-muted">No guest contacts yet. They appear when a guest sends a report with their email.</p>
      ) : (
        <RecordFilters scope={scope} records={rows.map((c) => ({ id: c.email, search: c.email, date: c.last_seen_at }))}>
          {rows.map((c) => (
            <div key={c.email} className="flex flex-wrap items-baseline justify-between gap-2 p-3">
              <span className="min-w-0 break-all font-semibold">{c.email}</span>
              <span className="hint">
                {c.reports_submitted === 1 ? '1 report' : `${c.reports_submitted} reports`} · {c.reports_on_file} on file ·
                first {formatDate(c.first_seen_at)} · last {formatDate(c.last_seen_at)}
              </span>
            </div>
          ))}
        </RecordFilters>
      )}
    </div>
  )
}
