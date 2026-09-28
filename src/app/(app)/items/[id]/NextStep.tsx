import ActionForm from '@/components/ActionForm'
import { canManageItems } from '@/lib/auth'
import { formatDate, hotelToday } from '@/lib/format'
import { CLOSED_STATUSES, TIER_LABEL, type LostItem, type Staff, type StorageLocation } from '@/lib/types'
import { advanceStatus, moveItem, recordHandover, setTier, storeItem } from './actions'

type Props = {
  item: LostItem
  me: Staff
  staff: Staff[]
  locations: StorageLocation[]
}

function LocationSelect({ locations, item, name = 'location_id' }: { locations: StorageLocation[]; item: LostItem; name?: string }) {
  const allowed = locations.filter(
    (l) => l.active && (item.value_tier === 'standard' || l.is_secure) && l.id !== item.storage_location_id
  )
  return (
    <div>
      <label htmlFor={`${name}-${item.id}`} className="label">Storage location</label>
      <select id={`${name}-${item.id}`} name={name} className="field" required defaultValue="">
        <option value="" disabled>Choose…</option>
        {allowed.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
            {l.is_secure ? ' (secure)' : ''}
          </option>
        ))}
      </select>
      {item.value_tier !== 'standard' && (
        <p className="hint mt-1">{TIER_LABEL[item.value_tier]} items can only go in a secure location.</p>
      )}
    </div>
  )
}

function WitnessSelect({ id, staff, me, required }: { id: string; staff: Staff[]; me: Staff; required: boolean }) {
  const others = staff.filter((s) => s.active && s.user_id !== me.user_id)
  return (
    <div>
      <label htmlFor={id} className="label">
        Witness {!required && <span className="font-normal text-muted">(optional)</span>}
      </label>
      <select id={id} name="witness" className="field" required={required} defaultValue="">
        <option value="">{required ? 'Choose who is with you…' : 'No witness'}</option>
        {others.map((s) => (
          <option key={s.user_id} value={s.user_id}>{s.display_name}</option>
        ))}
      </select>
    </div>
  )
}

function Note({ id, label = 'Note', placeholder }: { id: string; label?: string; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label} <span className="font-normal text-muted">(optional)</span>
      </label>
      <input id={id} name="note" className="field" maxLength={300} placeholder={placeholder} />
    </div>
  )
}

export default function NextStep({ item, me, staff, locations }: Props) {
  const hidden = { item_id: item.id }
  const manage = canManageItems(me.role)
  const needsWitness = item.value_tier !== 'standard'
  const pastRetention = item.dispose_after < hotelToday()
  const canDispose =
    me.role === 'manager' && pastRetention && ['stored', 'matched', 'guest_contacted'].includes(item.status)

  if (CLOSED_STATUSES.includes(item.status)) return null

  let step: React.ReactNode
  switch (item.status) {
    case 'logged':
      step = (
        <ActionForm action={storeItem} hidden={hidden} submitLabel="Mark as stored">
          <p>Put the item away and record where it is.</p>
          <LocationSelect locations={locations} item={item} />
        </ActionForm>
      )
      break

    case 'stored':
      step = manage ? (
        <p>
          Look up who stayed in {item.room_number ? `room ${item.room_number}` : 'the area'} around{' '}
          {formatDate(item.found_at)} in the PMS, then add their reservation numbers under{' '}
          <a href="#reservations" className="font-semibold text-teal underline">Possible owners</a> and confirm the right one.
        </p>
      ) : (
        <p>Stored. The front desk will match it to a guest.</p>
      )
      break

    case 'matched':
      step = manage ? (
        <ActionForm
          action={advanceStatus}
          hidden={{ ...hidden, to: 'guest_contacted' }}
          submitLabel="Guest has been contacted"
        >
          <p>Contact the guest through the PMS, then record it here.</p>
          <Note id="note-1" label="How they were contacted" placeholder="e.g. Emailed via PMS" />
        </ActionForm>
      ) : (
        <p>Matched to a stay. The front desk will contact the guest.</p>
      )
      break

    case 'guest_contacted':
      step = manage ? (
        <div className="space-y-4">
          <p>What did the guest ask for?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionForm action={advanceStatus} hidden={{ ...hidden, to: 'awaiting_collection' }} submitLabel="They’ll collect it" variant="secondary" />
            <ActionForm action={advanceStatus} hidden={{ ...hidden, to: 'awaiting_shipping' }} submitLabel="Post it to them" variant="secondary" />
          </div>
        </div>
      ) : (
        <p>Waiting to hear from the guest.</p>
      )
      break

    case 'awaiting_collection':
      step = manage ? (
        <div className="space-y-5">
          <ActionForm action={recordHandover} hidden={{ ...hidden, method: 'in_person' }} submitLabel="Hand over to guest">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="id_checked" required className="mt-1 size-4 accent-teal" />
              <span>I checked the guest’s photo ID matches the reservation name in the PMS</span>
            </label>
            <WitnessSelect id="witness-1" staff={staff} me={me} required={needsWitness} />
            <Note id="note-2" />
          </ActionForm>
          <ActionForm action={advanceStatus} hidden={{ ...hidden, to: 'awaiting_shipping' }} submitLabel="Switch to posting" variant="secondary" />
        </div>
      ) : (
        <p>Waiting for the guest to collect it from the front desk.</p>
      )
      break

    case 'awaiting_shipping':
      step = manage ? (
        <div className="space-y-5">
          <ActionForm action={recordHandover} hidden={{ ...hidden, method: 'courier' }} submitLabel="Mark as posted">
            <div>
              <label htmlFor="courier_tracking" className="label">Tracking number</label>
              <input id="courier_tracking" name="courier_tracking" className="field" maxLength={64} required />
            </div>
            <WitnessSelect id="witness-2" staff={staff} me={me} required={needsWitness} />
            <Note id="note-3" placeholder="e.g. Royal Mail Special Delivery, paid by guest" />
          </ActionForm>
          <ActionForm action={advanceStatus} hidden={{ ...hidden, to: 'awaiting_collection' }} submitLabel="Switch to collection" variant="secondary" />
        </div>
      ) : (
        <p>Waiting to be posted by the front desk.</p>
      )
      break
  }

  return (
    <section aria-labelledby="next-step" className="panel p-4 sm:p-5">
      <h2 id="next-step" className="mb-3 text-lg font-bold">Next step</h2>
      {step}

      {canDispose && (
        <details className="mt-6 border-t border-line pt-4">
          <summary className="cursor-pointer font-semibold text-attention">
            Past retention (kept until {formatDate(item.dispose_after)}) — dispose or donate
          </summary>
          <ActionForm
            action={recordHandover}
            hidden={hidden}
            submitLabel="Record disposal"
            variant="danger"
            confirmText="This closes the item permanently. Continue?"
            className="mt-3"
          >
            <div>
              <label htmlFor="dispose-method" className="label">What happened to it</label>
              <select id="dispose-method" name="method" className="field" required defaultValue="disposed">
                <option value="disposed">Disposed of</option>
                <option value="donated">Donated</option>
              </select>
            </div>
            <WitnessSelect id="witness-3" staff={staff} me={me} required />
            <Note id="note-4" placeholder="e.g. Passport sent to the issuing embassy" />
          </ActionForm>
        </details>
      )}
    </section>
  )
}

export function ItemTools({ item, me, locations }: { item: LostItem; me: Staff; locations: StorageLocation[] }) {
  const closed = CLOSED_STATUSES.includes(item.status)
  const canMove = !closed && item.status !== 'logged'
  const canTier = !closed && canManageItems(me.role)
  if (!canMove && !canTier) return null
  const hidden = { item_id: item.id }

  return (
    <section aria-labelledby="tools" className="panel p-4 sm:p-5">
      <h2 id="tools" className="mb-3 text-lg font-bold">Other changes</h2>
      <div className="space-y-2">
        {canMove && (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-semibold">Move to another location</summary>
            <ActionForm action={moveItem} hidden={hidden} submitLabel="Record move" className="mt-3">
              <LocationSelect locations={locations} item={item} />
              <Note id="note-5" />
            </ActionForm>
          </details>
        )}
        {canTier && (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-semibold">Change how valuable it is</summary>
            <ActionForm action={setTier} hidden={hidden} submitLabel="Save" className="mt-3">
              <div>
                <label htmlFor="tier-select" className="label">Value</label>
                <select id="tier-select" name="tier" className="field" defaultValue={item.value_tier}>
                  <option value="standard">Standard</option>
                  <option value="valuable">Valuable</option>
                  <option value="sensitive">Sensitive</option>
                </select>
                <p className="hint mt-1">Valuable and sensitive items must already be in a secure location.</p>
              </div>
              <Note id="note-6" label="Reason" />
            </ActionForm>
          </details>
        )}
      </div>
    </section>
  )
}
