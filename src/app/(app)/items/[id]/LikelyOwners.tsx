import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/format'
import { CLOSED_STATUSES, type GuestCandidate, type LostItem, type TraceRow } from '@/lib/types'
import ActionForm from '@/components/ActionForm'
import { addCandidateFromStay } from './actions'

// Front office / managers: stays in the item's room, ranked by how likely the
// guest is to own it. The score is a guide with its reasons shown — staff
// decide, and confirm through "Possible owners" as before.
export default async function LikelyOwners({
  item,
  candidates,
  traceWindowDays,
}: {
  item: LostItem
  candidates: GuestCandidate[]
  traceWindowDays: number
}) {
  if (item.found_area_type !== 'room') return null

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('trace_item_owners', { p_item_id: item.id })
  const rows = ((data ?? []) as TraceRow[]).slice(0, 5)
  const added = new Set(candidates.map((c) => c.reservation_ref))
  const closed = CLOSED_STATUSES.includes(item.status)
  const inRoom = rows.find((r) => r.score === 95)

  return (
    <section aria-labelledby="likely" className="panel p-4 sm:p-5">
      <h2 id="likely" className="text-lg font-bold">Likely owners</h2>
      <p className="hint mt-1">
        Stays in room {item.room_number} up to {traceWindowDays} days before it was found, from the stay log. A guide,
        not a decision — check with the guest before returning anything.
      </p>

      {inRoom && (
        <p className="mt-3 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention">
          A guest ({inRoom.reservation_ref}) is checked in to this room. If it’s theirs, it isn’t lost — return it to
          the room or hold it at the desk for them.
        </p>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error.message}</p>}

      {!error && rows.length === 0 && (
        <p className="mt-3 text-muted">
          No stays recorded for this room in that window. Add the stay on the{' '}
          <Link href="/stays" className="font-semibold text-teal underline">Stays</Link> page (or import the PMS
          report), and it will appear here.
        </p>
      )}

      {rows.length > 0 && (
        <ol className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.stay_id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="text-lg font-bold">{r.reservation_ref}</span>{' '}
                  <span className="text-muted">· {formatDate(r.check_in_date)} – {formatDate(r.check_out_date)}</span>
                </p>
                <span className="font-bold tabular-nums" aria-label={`Likelihood ${r.score} out of 100`}>{r.score}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden>
                <div className="h-full rounded-full bg-teal" style={{ width: `${r.score}%` }} />
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                {r.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              {!closed && (
                <div className="mt-3">
                  {added.has(r.reservation_ref) ? (
                    <p className="text-sm font-semibold text-done">Listed under Possible owners</p>
                  ) : (
                    <ActionForm
                      action={addCandidateFromStay}
                      hidden={{ item_id: item.id, stay_id: r.stay_id }}
                      submitLabel="Add as possible owner"
                      variant="secondary"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
