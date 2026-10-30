'use client'

import { startTransition, useActionState, useMemo, useState } from 'react'
import { initialActionState } from '@/lib/types'
import { MAX_PASSWORD, MIN_PASSWORD } from '@/lib/better-auth/rules'
import { completeSetup } from './actions'

type Floor = { key: number; name: string; rooms: string }
type Store = { key: number; label: string; kind: 'normal' | 'secure' }

// Rough count for the summary only; the server checks the real list.
function countRooms(text: string): number {
  let n = 0
  for (const part of text.split(/[\s,;]+/)) {
    const m = part.match(/^(\d+)-(\d+)$/)
    if (m && m[1].length === m[2].length && Number(m[2]) >= Number(m[1])) n += Number(m[2]) - Number(m[1]) + 1
    else if (part.trim()) n += 1
  }
  return n
}

function Section({ step, title, hint, children }: { step: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="panel space-y-4 p-4 sm:p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">Step {step}</p>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="hint mt-1">{hint}</p>
      </div>
      {children}
    </section>
  )
}

export default function SetupForm({ defaultAreas, defaultStorage }: {
  defaultAreas: string[]
  defaultStorage: { label: string; secure: boolean }[]
}) {
  const [state, formAction, pending] = useActionState(completeSetup, initialActionState)
  const [floors, setFloors] = useState<Floor[]>([{ key: 1, name: '1', rooms: '' }])
  const [stores, setStores] = useState<Store[]>(
    defaultStorage.map((s, i) => ({ key: i + 1, label: s.label, kind: s.secure ? 'secure' : 'normal' }))
  )
  const [showPw, setShowPw] = useState(false)
  const nextKey = () => Date.now() + Math.random()
  const totalRooms = useMemo(() => floors.reduce((n, f) => n + countRooms(f.rooms), 0), [floors])

  return (
    // Submitted by hand rather than <form action>: React clears a form after a
    // form action, and a long setup form must keep what was typed when the
    // server finds a mistake.
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => formAction(data))
      }}
    >
      <Section step={1} title="Setup key" hint="The one-time key set as SETUP_TOKEN in the server's settings. It stops anyone else from setting up this installation.">
        <div>
          <label htmlFor="setup_token" className="label">Setup key</label>
          <input id="setup_token" name="setup_token" type="password" className="field" autoComplete="off" required />
        </div>
      </Section>

      <Section step={2} title="Hotel" hint="Shown to guests on the enquiry page and to staff in the app.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="label">Hotel name</label>
            <input id="name" name="name" className="field" maxLength={100} required />
          </div>
          <div>
            <label htmlFor="code" className="label">Hotel code</label>
            <input id="code" name="code" className="field uppercase" pattern="[A-Za-z0-9]{3,10}" maxLength={10} autoCapitalize="characters" required />
            <p className="hint mt-1">3–10 letters or digits, e.g. GRAND. Printed on every item tag (GRAND-261030-0001). <strong>Can’t be changed later.</strong></p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="address" className="label">Address <span className="hint">(optional)</span></label>
            <input id="address" name="address" className="field" maxLength={300} />
          </div>
        </div>
      </Section>

      <Section step={3} title="Floors and rooms" hint="One row per floor. Separate room numbers with commas; a range like 101-120 adds every room in between.">
        <div className="space-y-3">
          {floors.map((f, i) => (
            <div key={f.key} className="grid gap-3 rounded-xl bg-paper p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
              <div>
                <label htmlFor={`floor_name_${f.key}`} className="label">Floor</label>
                <input id={`floor_name_${f.key}`} name="floor_name" className="field" value={f.name} maxLength={20} placeholder="e.g. Ground"
                  onChange={(e) => setFloors(floors.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)))} />
              </div>
              <div>
                <label htmlFor={`floor_rooms_${f.key}`} className="label">Rooms <span className="hint">({countRooms(f.rooms)})</span></label>
                <input id={`floor_rooms_${f.key}`} name="floor_rooms" className="field" value={f.rooms} placeholder="e.g. 101-120, 122"
                  onChange={(e) => setFloors(floors.map((x) => (x.key === f.key ? { ...x, rooms: e.target.value } : x)))} />
              </div>
              <button type="button" className="btn btn-secondary" disabled={floors.length === 1}
                onClick={() => setFloors(floors.filter((x) => x.key !== f.key))} aria-label={`Remove floor ${i + 1}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="btn btn-secondary"
            onClick={() => setFloors([...floors, { key: nextKey(), name: String(floors.length + 1), rooms: '' }])}>
            Add a floor
          </button>
          <p className="hint">{floors.length} floor{floors.length === 1 ? '' : 's'} · {totalRooms} room{totalRooms === 1 ? '' : 's'}</p>
        </div>
      </Section>

      <Section step={4} title="Public areas" hint="Where items can be found outside guest rooms. One per line or separated by commas. You can change these later.">
        <textarea name="areas" className="field min-h-32" defaultValue={defaultAreas.join('\n')} />
      </Section>

      <Section step={5} title="Where found items are kept" hint="Shelves, cupboards and safes. Mark the ones that lock: valuable items must go there.">
        <div className="space-y-3">
          {stores.map((s, i) => (
            <div key={s.key} className="grid gap-3 rounded-xl bg-paper p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <div>
                <label htmlFor={`storage_label_${s.key}`} className="label">Place</label>
                <input id={`storage_label_${s.key}`} name="storage_label" className="field" value={s.label} maxLength={60}
                  onChange={(e) => setStores(stores.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))} />
              </div>
              <div>
                <label htmlFor={`storage_kind_${s.key}`} className="label">Type</label>
                <select id={`storage_kind_${s.key}`} name="storage_kind" className="field" value={s.kind}
                  onChange={(e) => setStores(stores.map((x) => (x.key === s.key ? { ...x, kind: e.target.value as Store['kind'] } : x)))}>
                  <option value="normal">Shelf / cupboard</option>
                  <option value="secure">Locked / safe</option>
                </select>
              </div>
              <button type="button" className="btn btn-secondary" disabled={stores.length === 1}
                onClick={() => setStores(stores.filter((x) => x.key !== s.key))} aria-label={`Remove storage place ${i + 1}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setStores([...stores, { key: nextKey(), label: '', kind: 'normal' }])}>
          Add a place
        </button>
      </Section>

      <Section step={6} title="Guest support" hint="Shown to guests who need to reach the hotel about lost property. All optional.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="phone" className="label">Phone</label>
            <input id="phone" name="phone" type="tel" className="field" maxLength={30} placeholder="+44 20 7946 0000" />
          </div>
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" className="field" maxLength={120} placeholder="frontdesk@hotel.example" />
          </div>
          <div>
            <label htmlFor="support_hours" className="label">Hours</label>
            <input id="support_hours" name="support_hours" className="field" maxLength={120} placeholder="Every day, 08:00–20:00" />
          </div>
          <div>
            <label htmlFor="support_note" className="label">Note for guests</label>
            <input id="support_note" name="support_note" className="field" maxLength={500} placeholder="Ask for the duty manager" />
          </div>
        </div>
      </Section>

      <Section step={7} title="First administrator" hint="This person signs in first and adds the rest of the staff from the Staff page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="admin_name" className="label">Name</label>
            <input id="admin_name" name="admin_name" className="field" maxLength={80} autoComplete="name" required />
          </div>
          <div>
            <label htmlFor="admin_username" className="label">Username</label>
            <input id="admin_username" name="admin_username" className="field" pattern="[a-z0-9._\-]{3,32}" maxLength={32}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" placeholder="e.g. grace.m" required />
            <p className="hint mt-1">3–32 lower-case letters, digits, dot, dash or underscore.</p>
          </div>
          <div>
            <label htmlFor="admin_password" className="label">Password</label>
            <input id="admin_password" name="admin_password" type={showPw ? 'text' : 'password'} className="field"
              minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} autoComplete="new-password" required />
            <p className="hint mt-1">{MIN_PASSWORD}–{MAX_PASSWORD} characters. A short sentence is easy to remember.</p>
          </div>
          <div>
            <label htmlFor="admin_password2" className="label">Password again</label>
            <input id="admin_password2" name="admin_password2" type={showPw ? 'text' : 'password'} className="field"
              minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} autoComplete="new-password" required />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
          Show passwords
        </label>
      </Section>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="hint">Setup runs once. Everything can be changed later by an administrator, except the hotel code.</p>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Setting up…' : 'Complete setup'}</button>
      </div>
    </form>
  )
}
