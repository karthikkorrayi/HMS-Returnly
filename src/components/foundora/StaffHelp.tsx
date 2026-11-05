'use client'
import { useRef } from 'react'
export default function StaffHelp() {
  const dialog = useRef<HTMLDialogElement>(null)
  return <div className="staff-help">
    <button className="btn btn-secondary" type="button" onClick={() => dialog.current?.showModal()}>Help</button>
    <dialog ref={dialog} className="staff-help-dialog" aria-labelledby="staff-help-title">
      <h2 id="staff-help-title">Workspace guidance</h2>
      <p>Log found items with their location and secure storage details. Never photograph identity documents, bank cards or medication.</p>
      <p>Match belongings to a reservation and verify ownership before arranging a return. Record each handover and obtain a witness when required.</p>
      <p>Managers approve disposal after the retention period. Use Requests for guest enquiries and Notifications for report activity.</p>
      <button className="btn btn-primary" type="button" onClick={() => dialog.current?.close()}>Close guidance</button>
    </dialog>
  </div>
}
