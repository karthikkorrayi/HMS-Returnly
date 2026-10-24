import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadRequestDetail, loadRequestMatches } from '@/lib/queries/requests'
import { formatDate, formatDateTime } from '@/lib/format'
import { CATEGORY_LABEL, STATUS_LABEL, TIER_LABEL, type ItemStatus } from '@/lib/types'
import { OPEN_REQUEST_STATUSES, REQUEST_STATUS_LABEL, type MatchRow } from '@/lib/requests/types'
import ActionForm from '@/components/ActionForm'
import { MatchBandBadge, RequestStatusBadge } from '@/components/RequestBadges'
import { addRequestNote, approveRequest, assignRequest, changeRequestStatus, messageCustomer } from '../actions'

const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted by customer',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  status_changed: 'Status changed',
  note_added: 'Internal note added',
  asked_customer: 'Asked the customer for information',
  messaged_customer: 'Messaged the customer',
  customer_replied: 'Customer replied',
  approved: 'Approved',
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { staff: me } = await requireSession(['manager', 'support'])
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  // Row-level security returns nothing unless you're Admin or the assigned Support member.
  const detail = await withStaff(me.user_id, (tx) => loadRequestDetail(tx, id))
  if (!detail) notFound()
  const { req, messages, notes, events, staff } = detail
  const approvedItem = detail.approvedItem as { id: string; item_code: string; description: string; status: ItemStatus } | null

  // Matches in their own transaction: if the matcher refuses, the page still shows.
  let matches: MatchRow[] = []
  const matchRes: { error: { message: string } | null } = { error: null }
  try {
    matches = await withStaff(me.user_id, (tx) => loadRequestMatches(tx, id))
  } catch (e) {
    console.error('request matches', e)
    matchRes.error = { message: 'Possible matches could not be loaded. Reopen the page to try again.' }
  }
  const names = Object.fromEntries(staff.map((s) => [s.user_id, s.display_name]))

  const admin = me.role === 'manager'
  const open = OPEN_REQUEST_STATUSES.includes(req.status)
  const closed = req.status === 'resolved'
  const hidden = { request_id: req.id }
  const assignable = staff.filter((s) => s.active && (s.role === 'support' || s.role === 'manager'))
  const back = admin ? '/requests' : '/support'

  const facts: [string, string][] = [
    ['Customer', req.customer_name],
    ['Booking ID', req.booking_ref],
    ['Item', req.item_name],
    ['Type', req.category ? CATEGORY_LABEL[req.category] : 'Not given'],
    ['Colour', req.colour ?? '—'],
    ['Brand', req.brand ?? '—'],
    ['Where', req.lost_location ?? '—'],
    ['When', req.lost_date ? formatDate(req.lost_date) : 'Not sure'],
  ]

  return (
    <div className="space-y-5">
      <Link href={back} className="text-sm font-semibold text-teal">← {admin ? 'Customer requests' : 'Support requests'}</Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{req.reference}</h1>
          <RequestStatusBadge status={req.status} />
        </div>
        <p className="hint">
          Received {formatDateTime(req.created_at)} · {req.assigned_to ? `Assigned to ${req.assigned_to === me.user_id ? 'you' : names[req.assigned_to] ?? 'staff'}` : 'Unassigned'}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <section aria-labelledby="report" className="panel p-4 sm:p-5">
            <h2 id="report" className="mb-3 text-lg font-bold">What the customer reported</h2>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 whitespace-pre-line rounded-lg bg-paper p-3">{req.description}</p>
            <p className="hint mt-2">Booking ID and name are as typed by the customer — not verified. Check ID against the PMS before any handover.</p>
          </section>

          <section aria-labelledby="matches" className="panel p-4 sm:p-5">
            <h2 id="matches" className="text-lg font-bold">Possible matches</h2>
            <p className="hint mt-1">Ranked by type, brand, colour, shared words, the booking’s room (from the stay log) and date. A suggestion, not proof of ownership.</p>
            {matchRes.error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{matchRes.error.message}</p>}
            {!matchRes.error && matches.length === 0 && (
              <p className="mt-3 text-muted">No logged items look similar yet. New items are checked when you reopen this page.</p>
            )}
            <ol className="mt-3 space-y-3">
              {matches.map((m) => (
                <li key={m.item_id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/items/${m.item_id}`} className="font-bold text-teal underline">{m.item_code}</Link>
                      <MatchBandBadge band={m.band} />
                      {m.value_tier !== 'standard' && <span className="badge bg-attention-soft text-attention">{TIER_LABEL[m.value_tier]}</span>}
                    </p>
                    <span className="text-sm font-semibold tabular-nums" aria-label={`Score ${m.score} out of 100`}>{m.score}/100</span>
                  </div>
                  <p className="mt-1">{m.description}</p>
                  <p className="hint">
                    {CATEGORY_LABEL[m.category]}
                    {m.colour ? ` · ${m.colour}` : ''}
                    {m.brand ? ` · ${m.brand}` : ''} · {m.room_number ? `Room ${m.room_number}` : m.area_label}
                    {m.found_spot ? ` (${m.found_spot})` : ''} · found {formatDateTime(m.found_at)} · {STATUS_LABEL[m.status]}
                  </p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                    {m.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                  {admin && open && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-teal">Approve with this item</summary>
                      <ActionForm
                        action={approveRequest}
                        hidden={{ ...hidden, item_id: m.item_id }}
                        submitLabel={`Approve — ${m.item_code} is theirs`}
                        confirmText={`Approve ${req.reference} as the owner of ${m.item_code}? The item is not released until the ID check and handover on the item page.`}
                        className="mt-2"
                      >
                        <div>
                          <label htmlFor={`appr-${m.item_id}`} className="label">How you verified it <span className="font-normal text-muted">(optional)</span></label>
                          <input id={`appr-${m.item_id}`} name="note" className="field" maxLength={500} placeholder="e.g. Engraving and charm described correctly" />
                        </div>
                      </ActionForm>
                    </details>
                  )}
                </li>
              ))}
            </ol>
            {admin && open && (
              <details className="mt-4 rounded-lg border border-line p-3">
                <summary className="cursor-pointer font-semibold">Approve with an item not listed</summary>
                <ActionForm action={approveRequest} hidden={hidden} submitLabel="Approve" className="mt-3"
                  confirmText="Approve this request for the item code entered? Release still needs the ID check and handover on the item page.">
                  <div>
                    <label htmlFor="appr-code" className="label">Item code (on the tag)</label>
                    <input id="appr-code" name="item_code" className="field" autoCapitalize="characters" placeholder="DEMO-261013-0042" required />
                  </div>
                  <div>
                    <label htmlFor="appr-note" className="label">How you verified it <span className="font-normal text-muted">(optional)</span></label>
                    <input id="appr-note" name="note" className="field" maxLength={500} />
                  </div>
                </ActionForm>
              </details>
            )}
          </section>

          <section aria-labelledby="conversation" className="panel p-4 sm:p-5">
            <h2 id="conversation" className="text-lg font-bold">Conversation with the customer</h2>
            <p className="hint mt-1">Everything here is visible to the customer on their status page.</p>
            <ol className="mt-3 space-y-3">
              {messages.map((m) => (
                <li key={m.id} className={`flex ${m.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.sender === 'customer' ? 'rounded-bl-md bg-paper' : m.sender === 'staff' ? 'rounded-br-md bg-teal-soft' : 'rounded-br-md border border-line'}`}>
                    <p className="text-xs font-semibold text-muted">
                      {m.sender === 'customer' ? req.customer_name : m.sender === 'staff' ? names[m.author_id ?? ''] ?? 'Staff' : 'Automatic message'} · {formatDateTime(m.created_at)}
                    </p>
                    <p className="mt-0.5 whitespace-pre-line">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {!closed && (
              <ActionForm action={messageCustomer} hidden={hidden} submitLabel="Send to customer" className="mt-4">
                <div>
                  <label htmlFor="msg-body" className="label">Message to the customer</label>
                  <textarea id="msg-body" name="body" className="field min-h-20" maxLength={1000} required placeholder="e.g. Is anything engraved on the clasp?" />
                </div>
                {open && (
                  <label className="flex items-start gap-3">
                    <input type="checkbox" name="ask" className="mt-1 size-4 accent-teal" defaultChecked />
                    <span>This is a question — wait for their reply (status: Awaiting customer information)</span>
                  </label>
                )}
                <p className="hint">Ask about details only the owner would know. Never describe the item you hold — let them describe it.</p>
              </ActionForm>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section aria-labelledby="actions" className="panel p-4 sm:p-5">
            <h2 id="actions" className="mb-3 text-lg font-bold">Actions</h2>
            {closed ? (
              <p className="text-muted">Resolved {req.closed_at ? formatDateTime(req.closed_at) : ''}. No further changes.</p>
            ) : (
              <div className="space-y-3">
                {approvedItem && (
                  <p className="rounded-lg bg-done-soft p-3 text-sm">
                    Approved for{' '}
                    <Link href={`/items/${approvedItem.id}`} className="font-semibold underline">{approvedItem.item_code}</Link>{' '}
                    ({STATUS_LABEL[approvedItem.status]}). Arrange collection or posting and record the handover on the item page.
                  </p>
                )}
                {req.decision_note && <p className="text-sm"><span className="text-muted">Decision note:</span> {req.decision_note}</p>}

                {/* Support */}
                {!admin && ['pending_review', 'awaiting_customer'].includes(req.status) && (
                  <ActionForm action={changeRequestStatus} hidden={{ ...hidden, to: 'under_investigation' }} submitLabel="Start investigating" variant="secondary" />
                )}
                {!admin && open && req.status !== 'awaiting_admin' && (
                  <ActionForm action={changeRequestStatus} hidden={{ ...hidden, to: 'awaiting_admin' }} submitLabel="Ready for admin review">
                    <div>
                      <label htmlFor="ready-note" className="label">Summary for the admin <span className="font-normal text-muted">(optional)</span></label>
                      <input id="ready-note" name="note" className="field" maxLength={500} />
                    </div>
                  </ActionForm>
                )}
                {!admin && req.status === 'awaiting_admin' && <p className="text-sm text-muted">Waiting for an admin decision.</p>}
                {!admin && !open && <p className="text-sm text-muted">An admin has decided this request.</p>}

                {/* Admin */}
                {admin && ['pending_review', 'awaiting_customer', 'awaiting_admin', 'approved', 'rejected'].includes(req.status) && (
                  <ActionForm action={changeRequestStatus} hidden={{ ...hidden, to: 'under_investigation' }} submitLabel={open ? 'Mark under investigation' : 'Reopen for investigation'} variant="secondary" />
                )}
                {admin && (req.status === 'approved' || req.status === 'rejected') && (
                  <ActionForm action={changeRequestStatus} hidden={{ ...hidden, to: 'resolved' }} submitLabel="Resolve and close">
                    <div>
                      <label htmlFor="resolve-note" className="label">Outcome <span className="font-normal text-muted">(optional)</span></label>
                      <input id="resolve-note" name="note" className="field" maxLength={500} placeholder="e.g. Collected with photo ID" />
                    </div>
                  </ActionForm>
                )}
                {admin && (open || req.status === 'approved') && (
                  <details className="rounded-lg border border-line p-3">
                    <summary className="cursor-pointer font-semibold text-danger">Reject</summary>
                    <ActionForm action={changeRequestStatus} hidden={{ ...hidden, to: 'rejected' }} submitLabel="Reject request" variant="danger" className="mt-3"
                      confirmText="Reject this request? Tell the customer why in the conversation.">
                      <div>
                        <label htmlFor="reject-note" className="label">Reason (internal)</label>
                        <input id="reject-note" name="note" className="field" maxLength={500} required />
                      </div>
                    </ActionForm>
                  </details>
                )}
                {admin && open && <p className="hint">To approve, choose the matching item under Possible matches.</p>}
              </div>
            )}

            {admin && !closed && (
              <div className="mt-5 border-t border-line pt-4">
                <ActionForm action={assignRequest} hidden={hidden} submitLabel="Save assignment" variant="secondary">
                  <div>
                    <label htmlFor="assign" className="label">Assigned to</label>
                    <select id="assign" name="staff_id" className="field" defaultValue={req.assigned_to ?? ''}>
                      <option value="">Unassigned</option>
                      {assignable.map((s) => (
                        <option key={s.user_id} value={s.user_id}>
                          {s.display_name} ({s.role === 'manager' ? 'Admin' : 'Support'})
                        </option>
                      ))}
                    </select>
                    {assignable.every((s) => s.role !== 'support') && (
                      <p className="hint mt-1">No Support staff yet — add them on the Staff page.</p>
                    )}
                  </div>
                </ActionForm>
              </div>
            )}
          </section>

          <section aria-labelledby="notes" className="panel border-attention p-4 sm:p-5">
            <h2 id="notes" className="text-lg font-bold">Internal notes</h2>
            <p className="hint mt-1">Staff only — never shown to the customer.</p>
            {!closed && (
              <ActionForm action={addRequestNote} hidden={hidden} submitLabel="Add note" variant="secondary" className="mt-3">
                <div>
                  <label htmlFor="note-body" className="sr-only">Note</label>
                  <textarea id="note-body" name="body" className="field min-h-20" maxLength={2000} required placeholder="What you checked and found" />
                </div>
              </ActionForm>
            )}
            <ol className="mt-4 space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="border-l-2 border-line pl-3">
                  <p className="whitespace-pre-line text-sm">{n.body}</p>
                  <p className="hint text-xs">{names[n.author_id] ?? 'Staff'} · {formatDateTime(n.created_at)}</p>
                </li>
              ))}
              {notes.length === 0 && <li className="hint">No notes yet.</li>}
            </ol>
          </section>

          <section aria-labelledby="audit" className="panel p-4 sm:p-5">
            <h2 id="audit" className="mb-3 text-lg font-bold">History</h2>
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <p className="text-sm font-semibold">
                    {EVENT_LABEL[e.action] ?? e.action}
                    {e.action === 'status_changed' && e.to_status ? `: ${REQUEST_STATUS_LABEL[e.to_status]}` : ''}
                    {e.action === 'assigned' && e.detail ? `: ${e.detail}` : ''}
                  </p>
                  <p className="hint text-xs">
                    {e.actor ? names[e.actor] ?? 'Staff' : 'Customer'} · {formatDateTime(e.created_at)}
                    {e.detail && e.action !== 'assigned' ? ` · ${e.detail}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
