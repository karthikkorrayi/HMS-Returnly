'use client'

import { useEffect, useMemo, useRef } from 'react'

// Two inputs: one opens the camera directly on phones, the other the gallery.
export default function PhotoPicker({
  files,
  onChange,
  max,
}: {
  files: File[]
  onChange: (files: File[]) => void
  max: number
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  function add(list: FileList | null) {
    if (!list) return
    const images = Array.from(list).filter((f) => f.type.startsWith('image/'))
    onChange([...files, ...images].slice(0, max))
  }

  const full = files.length >= max

  return (
    <div className="clear-both space-y-3">
      {files.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {previews.map((src, i) => (
            <li key={src} className="relative aspect-square overflow-hidden rounded-lg bg-paper">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded-full bg-ink/80 px-2 py-0.5 text-sm font-semibold text-white"
                aria-label={`Remove photo ${i + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" disabled={full} onClick={() => cameraRef.current?.click()}>
          Take photo
        </button>
        <button type="button" className="btn btn-secondary" disabled={full} onClick={() => galleryRef.current?.click()}>
          From gallery
        </button>
      </div>
      <p className="hint">
        {full ? `That’s the maximum of ${max}.` : `Up to ${max}. Photograph the item, not documents or cards.`}
      </p>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
