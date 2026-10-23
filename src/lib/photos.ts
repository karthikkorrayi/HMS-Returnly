// Browser side of photo upload: shrink and re-encode on the phone, then send
// each photo to the app (/api/items/<id>/photos), which checks the staff
// member, cleans the file again and stores it in the private bucket.
export { MAX_PHOTOS } from './photo-rules'
const MAX_EDGE = 1600
const QUALITY = 0.8

// Re-encodes a camera photo as a JPEG no larger than 1600px on its longest
// side. Drawing through a canvas drops all EXIF metadata, including GPS.
export async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process photos')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process photo'))),
      'image/jpeg',
      QUALITY
    )
  )
}

// Uploads photos for an item, one request per photo. Returns how many failed.
export async function uploadItemPhotos(itemId: string, files: File[]): Promise<{ failed: number; lastError: string | null }> {
  let failed = 0
  let lastError: string | null = null

  for (const file of files) {
    try {
      const blob = await compressPhoto(file)
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/photos`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        credentials: 'same-origin',
        body: blob,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error ?? 'Upload failed')
      }
    } catch (e) {
      failed++
      lastError = e instanceof Error ? e.message : 'Upload failed'
    }
  }
  return { failed, lastError }
}
