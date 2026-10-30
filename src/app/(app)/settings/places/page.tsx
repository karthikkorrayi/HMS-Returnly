import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadAreas, loadStorage } from '@/lib/hotel-config'
import InlineAction from '@/components/InlineAction'
import {
  addAreaAction, addStorageAction, renameAreaAction, saveStorageAction, setAreaActiveAction, setStorageActiveAction,
} from '../config-actions'

export default async function PlacesPage() {
  const { staff } = await requireSession(['manager'])
  const { areas, storage } = await withStaff(staff.user_id, async (tx) => ({ areas: await loadAreas(tx), storage: await loadStorage(tx) }))

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/settings" className="text-sm font-semibold text-teal">← Settings</Link>
        <h1 className="mt-2 text-2xl font-bold">Areas and storage places</h1>
        <p className="hint mt-1">Retired entries are kept for history but no longer offered to staff.</p>
      </div>

      <section className="panel space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold">Public areas</h2>
          <p className="hint">Suggested when an item is found outside a guest room. Renaming doesn’t change items already logged.</p>
        </div>
        <ul className="space-y-3">
          {areas.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-end justify-between gap-2 rounded-xl p-3 ${a.active ? 'bg-paper' : 'bg-paper opacity-70'}`}>
              <InlineAction action={renameAreaAction} hidden={{ area_id: a.id }} submitLabel="Rename" okText="Saved">
                <div className="min-w-48">
                  <label htmlFor={`area-${a.id}`} className="label">{a.active ? 'Area' : 'Area (retired)'}</label>
                  <input id={`area-${a.id}`} name="label" className="field" defaultValue={a.label} maxLength={60} required />
                </div>
              </InlineAction>
              <InlineAction action={setAreaActiveAction} hidden={{ area_id: a.id, active: String(!a.active) }}
                submitLabel={a.active ? 'Retire' : 'Bring back'} />
            </li>
          ))}
        </ul>
        <InlineAction action={addAreaAction} submitLabel="Add area" variant="primary" resetOnOk>
          <div className="min-w-48 flex-1">
            <label htmlFor="new-area" className="label">New area</label>
            <input id="new-area" name="label" className="field" maxLength={60} placeholder="e.g. Spa" required />
          </div>
        </InlineAction>
      </section>

      <section className="panel space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold">Where found items are kept</h2>
          <p className="hint">Valuable and sensitive items can only go to a locked place.</p>
        </div>
        <ul className="space-y-3">
          {storage.map((s) => (
            <li key={s.id} className={`space-y-2 rounded-xl p-3 ${s.active ? 'bg-paper' : 'bg-paper opacity-70'}`}>
              <p className="hint">
                {s.active ? 'In use' : 'Retired'} · {s.holding} item{s.holding === 1 ? '' : 's'} stored here{s.valuables ? ` (${s.valuables} valuable)` : ''}
              </p>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <InlineAction action={saveStorageAction} hidden={{ location_id: s.id }} submitLabel="Save" okText="Saved">
                  <div className="min-w-48">
                    <label htmlFor={`store-${s.id}`} className="label">Place</label>
                    <input id={`store-${s.id}`} name="label" className="field" defaultValue={s.label} maxLength={60} required />
                  </div>
                  <div className="w-44">
                    <label htmlFor={`kind-${s.id}`} className="label">Type</label>
                    <select id={`kind-${s.id}`} name="kind" className="field" defaultValue={s.is_secure ? 'secure' : 'normal'}>
                      <option value="normal">Shelf / cupboard</option>
                      <option value="secure">Locked / safe</option>
                    </select>
                  </div>
                </InlineAction>
                <InlineAction action={setStorageActiveAction} hidden={{ location_id: s.id, active: String(!s.active) }}
                  submitLabel={s.active ? 'Retire' : 'Bring back'} />
              </div>
            </li>
          ))}
        </ul>
        <InlineAction action={addStorageAction} submitLabel="Add place" variant="primary" resetOnOk>
          <div className="min-w-48 flex-1">
            <label htmlFor="new-store" className="label">New place</label>
            <input id="new-store" name="label" className="field" maxLength={60} placeholder="e.g. Back office safe" required />
          </div>
          <div className="w-44">
            <label htmlFor="new-kind" className="label">Type</label>
            <select id="new-kind" name="kind" className="field" defaultValue="normal">
              <option value="normal">Shelf / cupboard</option>
              <option value="secure">Locked / safe</option>
            </select>
          </div>
        </InlineAction>
      </section>
    </div>
  )
}
