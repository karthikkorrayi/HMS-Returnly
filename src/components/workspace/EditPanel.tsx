'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
const EditContext = createContext<((busy: boolean) => void) | null>(null)
export const useEditBusy = () => useContext(EditContext)
export default function EditPanel({ label, children }: { label: string; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    function result(event: Event) {
      const { ok, pending } = (event as CustomEvent).detail ?? {}
      setBusy(Boolean(pending))
      if (ok) { setEditing(false); setRevision((n) => n + 1) }
    }
    el?.addEventListener('foundora-form-result', result)
    return () => el?.removeEventListener('foundora-form-result', result)
  }, [])
  return <EditContext.Provider value={setBusy}><div ref={root} className={`edit-panel ${editing ? 'is-editing' : 'is-readonly'}`}>
    <div className="edit-panel-toolbar"><span className="hint">{editing ? 'Editing — save changes below, or cancel.' : 'Read-only'}</span>
      {editing ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditing(false); setRevision((n) => n + 1) }}>Cancel</button>
        : <button type="button" className="btn btn-secondary" aria-label={`Edit ${label}`} onClick={() => setEditing(true)}>Edit</button>}
    </div>
    <fieldset key={revision} disabled={!editing || busy} aria-label={label}>{children}</fieldset>
  </div></EditContext.Provider>
}
