import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_PHOTOS = 3
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

// Uploads photos for an item and records them. Returns how many failed.
export async function uploadItemPhotos(
  supabase: SupabaseClient,
  opts: { propertyId: string; itemId: string; userId: string; files: File[] }
): Promise<{ failed: number; lastError: string | null }> {
  let failed = 0
  let lastError: string | null = null

  for (const file of opts.files) {
    try {
      const blob = await compressPhoto(file)
      const path = `${opts.propertyId}/${opts.itemId}/${crypto.randomUUID()}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('item-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError

      const { error: rowError } = await supabase
        .from('item_photos')
        .insert({ item_id: opts.itemId, storage_path: path, uploaded_by: opts.userId })
      if (rowError) {
        await supabase.storage.from('item-photos').remove([path])
        throw rowError
      }
    } catch (e) {
      failed++
      lastError = e instanceof Error ? e.message : 'Upload failed'
    }
  }
  return { failed, lastError }
}
