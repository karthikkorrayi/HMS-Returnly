'use client'

import { useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MAX_PHOTOS, uploadItemPhotos } from '@/lib/photos'
import { saveItem } from './actions'
import { CATEGORIES, TIER_HINT, TIER_LABEL, type ValueTier } from '@/lib/types'
import PhotoPicker from '@/components/PhotoPicker'
import { useStaffPath } from '@/components/StaffHotel'

function localNowForInput() {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function LogItemForm({
  rooms,
  areas,
  initialRoom,
  roomCheckId,
}: {
  rooms: string[]
  /** The hotel's public areas (suggestions; any wording is accepted). */
  areas: string[]
  initialRoom?: string
  roomCheckId?: string
}) {
  const uid = useId()
  const fieldId = (name: string) => `${uid}-${name}`
  const [completion, setCompletion] = useState({location:Boolean(initialRoom),details:false})
  const router = useRouter()
  const to = useStaffPath()
  const roomSet = useMemo(() => new Set(rooms.map((r) => r.toUpperCase())), [rooms])
  const maxFoundAt = useMemo(() => localNowForInput(), [])

  const [areaType, setAreaType] = useState<'room' | 'public_area'>('room')
  const [tier, setTier] = useState<ValueTier>('standard')
  const [photos, setPhotos] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const form = new FormData(e.currentTarget)
    const get = (k: string) => String(form.get(k) ?? '').trim()

    const room = get('room_number').toUpperCase()
    const area = get('area_label')
    if (areaType === 'room' && !roomSet.has(room)) {
      setError(`Room “${room || '—'}” is not on this hotel’s room list.`)
      return
    }
    if (areaType === 'public_area' && !area) {
      setError('Say where in the hotel it was found.')
      return
    }
    const foundAt = new Date(get('found_at'))
    if (Number.isNaN(foundAt.getTime()) || foundAt.getTime() > Date.now() + 60_000) {
      setError('The time found can’t be in the future.')
      return
    }

    setBusy('Saving item…')
    try {
    const saved = await saveItem({
      areaType,
      roomNumber: areaType === 'room' ? rooms.find((r) => r.toUpperCase() === room) ?? null : null,
      areaLabel: areaType === 'public_area' ? area : null,
      foundAt: foundAt.toISOString(),
      category: get('category'),
      description: get('description'),
      brand: get('brand') || null,
      colour: get('colour') || null,
      valueTier: tier,
      roomCheckId: areaType === 'room' && roomCheckId ? roomCheckId : null,
      foundSpot: areaType === 'room' ? get('found_spot') || null : null,
      spotHidden: areaType === 'room' && form.get('spot_hidden') === 'on',
    })

    if ('error' in saved) {
      setBusy(null)
      setError(`Could not save the item: ${saved.error}`)
      return
    }
    const item = { id: saved.id }

    let photoNote = ''
    if (tier !== 'sensitive' && photos.length > 0) {
      setBusy(`Uploading ${photos.length} photo${photos.length > 1 ? 's' : ''}…`)
      const { failed } = await uploadItemPhotos(item.id, photos)
      if (failed > 0) photoNote = `&photos_failed=${failed}`
    }

    router.push(to(`/items/${item.id}?logged=1${photoNote}`))
    router.refresh()
    } catch { setBusy(null); setError('The save could not be confirmed. Check the dashboard before trying again. Your entered details are kept here.') }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-6 interactive-item-form" onChange={(e)=>{
      const f=new FormData(e.currentTarget)
      const room=String(f.get('room_number')??'').toUpperCase().trim()
      setCompletion({location:areaType==='room'?roomSet.has(room):Boolean(String(f.get('area_label')??'').trim()),details:Boolean(f.get('category'))&&String(f.get('description')??'').trim().length>=3})
    }}>
      <nav className="form-step-navigation" aria-label="Item form sections">{[{id:'location',label:'1. Location',done:completion.location},{id:'details',label:'2. Item details',done:completion.details}].map((step)=><button type="button" key={step.id} className={step.done?'is-complete':''} onClick={()=>{
        const section=document.getElementById(fieldId(step.id));section?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});section?.querySelector<HTMLElement>('input,select,textarea')?.focus({preventScroll:true})
      }}>{step.label}<span>{step.done?'Ready':'Required'}</span></button>)}</nav>
      <fieldset id={fieldId('location')} disabled={Boolean(busy)} className="panel space-y-4 p-4">
        <legend className="sr-only">Where it was found</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where it was found">
          {(['room', 'public_area'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={areaType === t}
              onClick={() => {setAreaType(t);setCompletion((old)=>({...old,location:false}))}}
              disabled={Boolean(roomCheckId) && t !== 'room'}
              className={`btn ${areaType === t ? 'btn-primary' : 'btn-secondary'}`}
            >
              {t === 'room' ? 'Guest room' : 'Public area'}
            </button>
          ))}
        </div>

        {areaType === 'room' ? (
          <div>
            <label htmlFor={fieldId('room_number')} className="label">Room number</label>
            <input
              id={fieldId('room_number')}
              name="room_number"
              list={fieldId('room-list')}
              className="field"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={initialRoom}
              readOnly={Boolean(roomCheckId)}
              required
            />
            <datalist id={fieldId('room-list')}>
              {rooms.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <label htmlFor={fieldId('found_spot')} className="label mt-4">
              Where in the room <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={fieldId('found_spot')}
              name="found_spot"
              list={fieldId('spot-list')}
              className="field"
              maxLength={80}
              autoComplete="off"
              placeholder="e.g. Behind the bedside table"
            />
            <datalist id={fieldId('spot-list')}>
              {['Bedside table', 'Behind the bedside table', 'Under the bed', 'In the bed / sheets', 'Wardrobe', 'Drawers', 'Room safe', 'Desk', 'Bathroom', 'Behind the door'].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <label className="mt-3 flex items-start gap-3">
              <input type="checkbox" name="spot_hidden" className="mt-1 size-4 accent-teal" />
              <span>
                <span className="font-semibold">Hard to see</span>
                <span className="hint block">Under or behind furniture, in bedding — somewhere a quick check could miss.</span>
              </span>
            </label>
          </div>
        ) : (
          <div>
            <label htmlFor={fieldId('area_label')} className="label">Area</label>
            <input
              id={fieldId('area_label')}
              name="area_label"
              list={fieldId('area-list')}
              className="field"
              maxLength={60}
              autoComplete="off"
              required
            />
            <datalist id={fieldId('area-list')}>
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        )}

        <div>
          <label htmlFor={fieldId('found_at')} className="label">When it was found</label>
          <input
            id={fieldId('found_at')}
            name="found_at"
            type="datetime-local"
            className="field"
            defaultValue={maxFoundAt}
            max={maxFoundAt}
            required
          />
        </div>
      </fieldset>

      <fieldset id={fieldId('details')} disabled={Boolean(busy)} className="panel space-y-4 p-4">
        <legend className="sr-only">What it is</legend>
        <div>
          <label htmlFor={fieldId('category')} className="label">Type of item</label>
          <select id={fieldId('category')} name="category" className="field" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fieldId('description')} className="label">Description</label>
          <textarea
            id={fieldId('description')}
            name="description"
            className="field min-h-24"
            minLength={3}
            maxLength={500}
            placeholder="e.g. Black phone charger with white USB-C cable"
            required
          />
          <p className="hint mt-1">Don’t write card numbers, passport numbers or anything written inside.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={fieldId('brand')} className="label">Brand <span className="font-normal text-muted">(optional)</span></label>
            <input id={fieldId('brand')} name="brand" className="field" maxLength={60} />
          </div>
          <div>
            <label htmlFor={fieldId('colour')} className="label">Colour <span className="font-normal text-muted">(optional)</span></label>
            <input id={fieldId('colour')} name="colour" className="field" maxLength={40} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={Boolean(busy)} className="panel space-y-3 p-4">
        <legend className="label float-left mb-2 w-full">How valuable is it?</legend>
        {(['standard', 'valuable', 'sensitive'] as const).map((t) => (
          <label
            key={t}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
              tier === t ? 'border-teal bg-teal-soft' : 'border-line'
            }`}
          >
            <input
              type="radio"
              name="value_tier"
              value={t}
              checked={tier === t}
              onChange={() => setTier(t)}
              className="mt-1 size-4 accent-teal"
            />
            <span>
              <span className="block font-semibold">{TIER_LABEL[t]}</span>
              <span className="hint">{TIER_HINT[t]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="panel p-4">
        <legend className="label float-left mb-2 w-full">Photos</legend>
        {tier === 'sensitive' ? (
          <p className="hint clear-both">
            No photos for sensitive items. Hand it to the front desk for the safe.
          </p>
        ) : (
          <PhotoPicker files={photos} onChange={setPhotos} max={MAX_PHOTOS} />
        )}
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full text-base" disabled={busy !== null}>
        {busy ?? 'Save item'}
      </button>
    </form>
  )
}
