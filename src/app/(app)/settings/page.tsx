import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadAreas, loadFloors, loadHotelDetails, loadStorage } from '@/lib/hotel-config'
import { cleanupStatus, loadLastCleanup } from '@/lib/daily-cleanup'
import ActionForm from '@/components/ActionForm'
import ReturnlyIcon from '@/components/ReturnlyIcon'
import { saveSettings } from './actions'
import { saveHotelDetailsAction } from './config-actions'

export default async function SettingsPage() {
  const { staff, property } = await requireSession(['manager'])
  const { hotel, floors, areas, storage, lastCleanup } = await withStaff(staff.user_id, async (tx) => ({
    hotel: await loadHotelDetails(tx),
    floors: await loadFloors(tx),
    areas: await loadAreas(tx),
    storage: await loadStorage(tx),
    lastCleanup: await loadLastCleanup(tx),
  }))
  const cleanup = cleanupStatus(lastCleanup)
  const rooms = floors.floors.reduce((n, f) => n + f.rooms.filter((r) => r.active).length, 0) + floors.unassigned.filter((r) => r.active).length

  const retention = [
    {
      name: 'retention_days',
      label: 'Keep unclaimed items (days)',
      value: property.retention_days,
      min: 7,
      max: 730,
      hint: 'Applies to items logged from now on. Agree this with the hotel’s lost property policy.',
    },
    {
      name: 'request_retention_days',
      label: 'Keep closed customer enquiries (days)',
      value: property.request_retention_days,
      min: 30,
      max: 1095,
      hint: 'Rejected or resolved enquiries — with the customer’s name, booking ID and messages — are deleted after this.',
    },
  ]
  const text = [
    { name: 'phone', label: 'Phone', value: hotel.contact_phone, type: 'tel', max: 30 },
    { name: 'email', label: 'Email', value: hotel.contact_email, type: 'email', max: 120 },
    { name: 'support_hours', label: 'Hours', value: hotel.support_hours, type: 'text', max: 120 },
    { name: 'support_note', label: 'Note for guests', value: hotel.support_note, type: 'text', max: 500 },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="hint mt-1">{property.name} ({property.inn_code})</p>
      </div>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-1 text-lg font-semibold">Hotel and guest support</h2>
        <p className="hint mb-4">Guests see the contact details on the lost property page. The hotel code ({hotel.inn_code}) is on every item tag and can’t be changed.</p>
        <ActionForm action={saveHotelDetailsAction} submitLabel="Save hotel details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="label">Hotel name</label>
              <input id="name" name="name" className="field" defaultValue={hotel.name} maxLength={100} required />
            </div>
            <div>
              <label htmlFor="address" className="label">Address</label>
              <input id="address" name="address" className="field" defaultValue={hotel.address ?? ''} maxLength={300} />
            </div>
            {text.map((t) => (
              <div key={t.name}>
                <label htmlFor={t.name} className="label">{t.label}</label>
                <input id={t.name} name={t.name} type={t.type} className="field" defaultValue={t.value ?? ''} maxLength={t.max} />
              </div>
            ))}
          </div>
        </ActionForm>
      </section>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-semibold">Hotel layout</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/settings/rooms" className="flex items-center justify-between rounded-xl bg-paper p-4 hover:bg-teal-soft">
            <span>
              <span className="block font-semibold">Floors and rooms</span>
              <span className="hint">{floors.floors.length} floor{floors.floors.length === 1 ? '' : 's'} · {rooms} room{rooms === 1 ? '' : 's'} in use</span>
            </span>
            <ReturnlyIcon name="arrow" />
          </Link>
          <Link href="/settings/places" className="flex items-center justify-between rounded-xl bg-paper p-4 hover:bg-teal-soft">
            <span>
              <span className="block font-semibold">Areas and storage places</span>
              <span className="hint">
                {areas.filter((a) => a.active).length} areas · {storage.filter((s) => s.active).length} storage places
              </span>
            </span>
            <ReturnlyIcon name="arrow" />
          </Link>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-semibold">How long records are kept</h2>
        <ActionForm action={saveSettings} submitLabel="Save settings">
          {retention.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className="label">{f.label}</label>
              <input id={f.name} name={f.name} type="number" inputMode="numeric" min={f.min} max={f.max}
                defaultValue={f.value} className="field sm:w-40" required />
              <p className="hint mt-1">{f.hint}</p>
            </div>
          ))}
        </ActionForm>
        <div className={`mt-4 rounded-xl p-3 text-sm ${cleanup.state === 'ok' ? 'bg-paper' : 'bg-attention-soft text-attention'}`} role={cleanup.state === 'ok' ? undefined : 'alert'}>
          <p className="font-semibold">Daily clean-up{cleanup.state === 'ok' ? '' : ' needs attention'}</p>
          <p className="mt-0.5">{cleanup.text}</p>
          <p className="hint mt-1">Every night it removes expired guest stays, closed enquiries past the time above, and old sign-in records. Lost items and photos are never removed automatically.</p>
        </div>
      </section>
    </div>
  )
}
