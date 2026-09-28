'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadItemPhotos } from '@/lib/photos'
import PhotoPicker from '@/components/PhotoPicker'

export default function AddPhotos({
  propertyId,
  itemId,
  userId,
  remaining,
}: {
  propertyId: string
  itemId: string
  userId: string
  remaining: number
}) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    setBusy(true)
    setError(null)
    const { failed, lastError } = await uploadItemPhotos(createClient(), {
      propertyId,
      itemId,
      userId,
      files,
    })
    setBusy(false)
    if (failed > 0) {
      setError(`${failed} photo${failed > 1 ? 's' : ''} did not upload: ${lastError}`)
    } else {
      setFiles([])
    }
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <PhotoPicker files={files} onChange={setFiles} max={remaining} />
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={upload}>
          {busy ? 'Uploading…' : `Upload ${files.length} photo${files.length > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}
