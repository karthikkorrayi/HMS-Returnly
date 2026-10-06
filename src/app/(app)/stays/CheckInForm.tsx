import ActionForm from '@/components/ActionForm'
import { hotelToday } from '@/lib/format'
import { checkInGuest } from './actions'

// Used on the Stays page (room chosen) and on a room's page (room fixed).
export default function CheckInForm({ room, rooms }: { room?: string; rooms?: string[] }) {
  const today = hotelToday()
  const id = room ? `-${room}` : ''

  return (
    <ActionForm
      action={checkInGuest}
      hidden={room ? { room_number: room } : {}}
      submitLabel="Check in"
      pendingLabel="Checking in…"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!room && (
          <div>
            <label htmlFor="ci-room" className="label">Room</label>
            <input id="ci-room" name="room_number" list="ci-room-list" className="field" inputMode="numeric" autoComplete="off" required />
            <datalist id="ci-room-list">
              {(rooms ?? []).map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
        )}
        <div>
          <label htmlFor={`ci-ref${id}`} className="label">Confirmation number</label>
          <input id={`ci-ref${id}`} name="reservation_ref" className="field" autoCapitalize="characters" autoComplete="off" maxLength={32} required />
        </div>
        <div>
          <label htmlFor={`ci-surname${id}`} className="label">Guest surname</label>
          <input id={`ci-surname${id}`} name="guest_surname" className="field" autoComplete="off" maxLength={80} required />
          <p className="hint mt-1">As on the booking. Only used to confirm a guest’s booking later; staff can’t view it here.</p>
        </div>
        <div>
          <label htmlFor={`ci-in${id}`} className="label">Check-in date</label>
          <input id={`ci-in${id}`} name="check_in_date" type="date" className="field" defaultValue={today} max={today} required />
        </div>
        <div>
          <label htmlFor={`ci-out${id}`} className="label">Check-out date</label>
          <input id={`ci-out${id}`} name="check_out_date" type="date" className="field" required />
        </div>
      </div>
    </ActionForm>
  )
}
