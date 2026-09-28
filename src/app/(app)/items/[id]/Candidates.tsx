import ActionForm from '@/components/ActionForm'
import { formatDate, formatDateTime } from '@/lib/format'
import { CLOSED_STATUSES, type GuestCandidate, type LostItem } from '@/lib/types'
import { addCandidate, confirmCandidate, removeCandidate, unconfirmCandidate } from './actions'

// "Possible owners": reservation numbers from the PMS. No guest names here —
// the front desk looks the reservation up in the PMS to contact the guest.
export default function Candidates({
  item,
  candidates,
  names,
}: {
  item: LostItem
  candidates: GuestCandidate[]
  names: Record<string, string>
}) {
  const hidden = { item_id: item.id }
  const closed = CLOSED_STATUSES.includes(item.status)
  const canConfirm = item.status === 'stored' || item.status === 'matched'
  const canUndo = ['matched', 'guest_contacted', 'awaiting_collection', 'awaiting_shipping'].includes(item.status)

  return (
    <section id="reservations" aria-labelledby="owners" className="panel p-4 sm:p-5">
      <h2 id="owners" className="text-lg font-bold">Possible owners</h2>
      <p className="hint mt-1">
        Reservation numbers only — never names or contact details. Contact guests through the PMS.
      </p>

      {candidates.length > 0 && (
        <ul className="mt-4 space-y-2">
          {candidates.map((c) => (
            <li
              key={c.id}
              className={`rounded-lg border p-3 ${c.confirmed ? 'border-teal bg-teal-soft' : 'border-line'}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-lg font-bold">{c.reservation_ref}</p>
                {c.confirmed && <span className="badge bg-teal text-white">Confirmed owner</span>}
              </div>
              <p className="hint">
                {c.departure_date ? `Departed ${formatDate(c.departure_date)} · ` : ''}
                Added by {names[c.added_by] ?? 'staff'}
                {c.confirmed && c.confirmed_by
                  ? ` · Confirmed by ${names[c.confirmed_by] ?? 'staff'} ${formatDateTime(c.confirmed_at!)}`
                  : ''}
              </p>
              {c.note && <p className="mt-1 text-sm">{c.note}</p>}

              {!closed && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!c.confirmed && canConfirm && (
                    <ActionForm
                      action={confirmCandidate}
                      hidden={{ ...hidden, candidate_id: c.id }}
                      submitLabel="Confirm as owner"
                      variant="secondary"
                    />
                  )}
                  {!c.confirmed && (
                    <ActionForm
                      action={removeCandidate}
                      hidden={{ ...hidden, candidate_id: c.id }}
                      submitLabel="Remove"
                      variant="secondary"
                    />
                  )}
                  {c.confirmed && canUndo && (
                    <ActionForm
                      action={unconfirmCandidate}
                      hidden={{ ...hidden, candidate_id: c.id }}
                      submitLabel="Undo match"
                      variant="secondary"
                      confirmText="This moves the item back to stored. Continue?"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!closed && item.status === 'logged' && (
        <p className="mt-4 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention">
          Store the item before matching it to a reservation.
        </p>
      )}

      {!closed && (
        <details className="mt-4 rounded-lg border border-line p-3" open={candidates.length === 0}>
          <summary className="cursor-pointer font-semibold">Add a reservation</summary>
          <ActionForm action={addCandidate} hidden={hidden} submitLabel="Add reservation" className="mt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="reservation_ref" className="label">Confirmation number</label>
                <input
                  id="reservation_ref"
                  name="reservation_ref"
                  className="field"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={32}
                  required
                />
              </div>
              <div>
                <label htmlFor="departure_date" className="label">
                  Departure date <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="departure_date" name="departure_date" type="date" className="field" />
              </div>
            </div>
            <div>
              <label htmlFor="cand-note" className="label">
                Note <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="cand-note"
                name="note"
                className="field"
                maxLength={300}
                placeholder="e.g. Checked out same morning; next guest arrived 3pm"
              />
            </div>
          </ActionForm>
        </details>
      )}
    </section>
  )
}
