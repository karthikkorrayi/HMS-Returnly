'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MAX_PHOTOS, uploadItemPhotos } from '@/lib/photos'
import { CATEGORIES, PUBLIC_AREAS, TIER_HINT, TIER_LABEL, type ValueTier } from '@/lib/types'
import PhotoPicker from '@/components/PhotoPicker'

function localNowForInput() {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function LogItemForm({
  propertyId,
  userId,
  rooms,
}: {
  propertyId: string
  userId: string
  rooms: string[]
}) {
  const router = useRouter()
  const roomSet = useMemo(() => new Set(rooms.map((r) => r.toUpperCase())), [rooms])
  const maxFoundAt = useMemo(() => localNowForInput(), [])

  const [areaType, setAreaType] = useState<'room' | 'public_area'>('room')
  const [tier, setTier] = useState<ValueTier>('standard')
  const [photos, setPhotos] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
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
    const supabase = createClient()
    const { data: item, error: insertError } = await supabase
      .from('lost_items')
      .insert({
        property_id: propertyId,
        found_area_type: areaType,
        room_number: areaType === 'room' ? rooms.find((r) => r.toUpperCase() === room) : null,
        area_label: areaType === 'public_area' ? area : null,
        found_at: foundAt.toISOString(),
        found_by: userId,
        category: get('category'),
        description: get('description'),
        brand: get('brand') || null,
        colour: get('colour') || null,
        value_tier: tier,
      })
      .select('id')
      .single()

    if (insertError || !item) {
      setBusy(null)
      setError(`Could not save the item: ${insertError?.message ?? 'unknown error'}`)
      return
    }

    let photoNote = ''
    if (tier !== 'sensitive' && photos.length > 0) {
      setBusy(`Uploading ${photos.length} photo${photos.length > 1 ? 's' : ''}…`)
      const { failed } = await uploadItemPhotos(supabase, {
        propertyId,
        itemId: item.id,
        userId,
        files: photos,
      })
      if (failed > 0) photoNote = `&photos_failed=${failed}`
    }

    router.push(`/items/${item.id}?logged=1${photoNote}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-6">
      <fieldset className="panel space-y-4 p-4">
        <legend className="sr-only">Where it was found</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where it was found">
          {(['room', 'public_area'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={areaType === t}
              onClick={() => setAreaType(t)}
              className={`btn ${areaType === t ? 'btn-primary' : 'btn-secondary'}`}
            >
              {t === 'room' ? 'Guest room' : 'Public area'}
            </button>
          ))}
        </div>

        {areaType === 'room' ? (
          <div>
            <label htmlFor="room_number" className="label">Room number</label>
            <input
              id="room_number"
              name="room_number"
              list="room-list"
              className="field"
              inputMode="numeric"
              autoComplete="off"
              required
            />
            <datalist id="room-list">
              {rooms.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        ) : (
          <div>
            <label htmlFor="area_label" className="label">Area</label>
            <input
              id="area_label"
              name="area_label"
              list="area-list"
              className="field"
              maxLength={60}
              autoComplete="off"
              required
            />
            <datalist id="area-list">
              {PUBLIC_AREAS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        )}

        <div>
          <label htmlFor="found_at" className="label">When it was found</label>
          <input
            id="found_at"
            name="found_at"
            type="datetime-local"
            className="field"
            defaultValue={maxFoundAt}
            max={maxFoundAt}
            required
          />
        </div>
      </fieldset>

      <fieldset className="panel space-y-4 p-4">
        <legend className="sr-only">What it is</legend>
        <div>
          <label htmlFor="category" className="label">Type of item</label>
          <select id="category" name="category" className="field" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="description" className="label">Description</label>
          <textarea
            id="description"
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
            <label htmlFor="brand" className="label">Brand <span className="font-normal text-muted">(optional)</span></label>
            <input id="brand" name="brand" className="field" maxLength={60} />
          </div>
          <div>
            <label htmlFor="colour" className="label">Colour <span className="font-normal text-muted">(optional)</span></label>
            <input id="colour" name="colour" className="field" maxLength={40} />
          </div>
        </div>
      </fieldset>

      <fieldset className="panel space-y-3 p-4">
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
