import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { loadFloors, type RoomRow } from '@/lib/hotel-config'
import InlineAction from '@/components/InlineAction'
import {
  addFloorAction, addRoomsAction, changeRoomAction, deleteFloorAction, renameFloorAction,
} from '../config-actions'

function Rooms({ rooms }: { rooms: RoomRow[] }) {
  if (rooms.length === 0) return <p className="hint">No rooms on this floor yet.</p>
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Rooms">
      {rooms.map((r) => (
        <li key={r.room_number}
          title={r.active ? (r.used ? 'In use · has items recorded' : 'In use') : 'Retired: not offered when logging items'}
          className={`rounded-md px-2 py-1 text-sm font-semibold ${r.active ? 'bg-teal-soft text-teal-dark' : 'bg-paper text-muted line-through'}`}>
          {r.room_number}
        </li>
      ))}
    </ul>
  )
}

export default async function RoomsPage() {
  const { staff } = await requireSession(['manager'])
  const { floors, unassigned } = await withStaff(staff.user_id, loadFloors)
  const total = floors.reduce((n, f) => n + f.rooms.length, 0) + unassigned.length
  const retired = [...floors.flatMap((f) => f.rooms), ...unassigned].filter((r) => !r.active).length

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/settings" className="text-sm font-semibold text-teal">← Settings</Link>
        <h1 className="mt-2 text-2xl font-bold">Floors and rooms</h1>
        <p className="hint mt-1">
          {floors.length} floor{floors.length === 1 ? '' : 's'} · {total} room{total === 1 ? '' : 's'}{retired ? ` (${retired} retired)` : ''}.
          Retired rooms are no longer offered when logging items; items already logged keep their room.
        </p>
      </div>

      <section className="panel space-y-3 p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Change a room</h2>
        <p className="hint">Type a room number and choose what to do. A room with items recorded can be retired but not deleted.</p>
        <InlineAction action={changeRoomAction} submitLabel="Apply" variant="primary" okText="Done" resetOnOk>
          <div className="w-28">
            <label htmlFor="room" className="label">Room</label>
            <input id="room" name="room" className="field" maxLength={10} autoCapitalize="characters" required />
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="what" className="label">Action</label>
            <select id="what" name="what" className="field" defaultValue="retire">
              <option value="retire">Retire (keep history)</option>
              <option value="restore">Bring back into use</option>
              <option value="delete">Delete (only if never used)</option>
              {floors.map((f) => <option key={f.id} value={`move:${f.id}`}>Move to floor {f.name}</option>)}
            </select>
          </div>
        </InlineAction>
      </section>

      {floors.map((f) => (
        <section key={f.id} className="panel space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">Floor {f.name}</h2>
            {f.rooms.length === 0 && (
              <InlineAction action={deleteFloorAction} hidden={{ floor_id: f.id }} submitLabel="Remove floor" variant="danger"
                confirmText={`Remove floor ${f.name}?`} />
            )}
          </div>
          <Rooms rooms={f.rooms} />
          <div className="grid gap-4 sm:grid-cols-2">
            <InlineAction action={addRoomsAction} hidden={{ floor_id: f.id }} submitLabel="Add rooms" okText="Added" resetOnOk>
              <div className="min-w-40 flex-1">
                <label htmlFor={`rooms-${f.id}`} className="label">Add rooms</label>
                <input id={`rooms-${f.id}`} name="rooms" className="field" placeholder="e.g. 115, 120-125" required />
              </div>
            </InlineAction>
            <InlineAction action={renameFloorAction} hidden={{ floor_id: f.id }} submitLabel="Rename" okText="Saved">
              <div className="min-w-32 flex-1">
                <label htmlFor={`floor-${f.id}`} className="label">Floor name</label>
                <input id={`floor-${f.id}`} name="name" className="field" defaultValue={f.name} maxLength={20} required />
              </div>
            </InlineAction>
          </div>
        </section>
      ))}

      {unassigned.length > 0 && (
        <section className="panel space-y-3 p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Rooms without a floor</h2>
          <p className="hint">Use “Change a room → Move to floor …” above to place them.</p>
          <Rooms rooms={unassigned} />
        </section>
      )}

      <section className="panel space-y-3 p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Add a floor</h2>
        <InlineAction action={addFloorAction} submitLabel="Add floor" variant="primary" resetOnOk>
          <div className="w-40">
            <label htmlFor="new-floor" className="label">Floor name</label>
            <input id="new-floor" name="name" className="field" maxLength={20} placeholder="e.g. 5 or Roof" required />
          </div>
        </InlineAction>
      </section>
    </div>
  )
}
