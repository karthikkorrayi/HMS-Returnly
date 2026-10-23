// Photos of found items (Phase 5, decision: the app serves every photo).
// The bucket is private and the app is the only way in: every upload, view
// and delete first checks the database as the signed-in staff member, so
// row-level security decides (same hotel; managers delete; nothing added to
// sensitive or closed items). No Next.js imports, so tests can run it.
import { randomUUID } from 'node:crypto'
import type { Tx } from '@/lib/db/core'
import { MAX_PHOTOS } from '@/lib/photo-rules'
import { cleanJpeg, PhotoRejected } from '@/lib/storage/jpeg'
import type { PhotoStore } from '@/lib/storage/s3'

export { PhotoRejected } from '@/lib/storage/jpeg'

export type WithStaff = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isRls = (e: unknown) => (e as { code?: string })?.code === '42501'

/**
 * Checks and cleans the photo, records it and stores it, in that order inside
 * one transaction: if storing fails, the record is rolled back; if the record
 * fails, nothing is stored. Returns the new photo id.
 */
export async function addPhoto(withStaff: WithStaff, store: PhotoStore, userId: string, itemId: string, raw: Uint8Array): Promise<string> {
  if (!UUID.test(itemId)) throw new PhotoRejected('Unknown item.')
  const jpeg = cleanJpeg(raw)
  let storedKey: string | null = null
  try {
    return await withStaff(userId, async (tx) => {
      // One upload per item at a time, so two phones cannot both add a 3rd photo.
      await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 482207312))`, [itemId])
      const item = (await tx.query<{ property_id: string }>(`select property_id from public.lost_items where id = $1`, [itemId])).rows[0]
      if (!item) throw new PhotoRejected('Unknown item.')
      const count = (await tx.query<{ n: number }>(`select count(*)::int as n from public.item_photos where item_id = $1`, [itemId])).rows[0].n
      if (count >= MAX_PHOTOS) throw new PhotoRejected(`This item already has ${MAX_PHOTOS} photos.`)

      const key = `${item.property_id}/${itemId}/${randomUUID()}.jpg`
      let id: string
      try {
        id = (
          await tx.query<{ id: string }>(
            `insert into public.item_photos (item_id, storage_path, uploaded_by) values ($1, $2, $3) returning id`,
            [itemId, key, userId]
          )
        ).rows[0].id
      } catch (e) {
        if (isRls(e)) throw new PhotoRejected('Photos can’t be added to this item (sensitive or closed).')
        throw e
      }
      await store.put(key, jpeg, 'image/jpeg')
      storedKey = key
      return id
    })
  } catch (e) {
    // The record was rolled back (e.g. the commit failed after the upload):
    // remove the stored file too, so nothing is left without a record.
    if (storedKey) await store.delete(storedKey).catch(() => {})
    throw e
  }
}

/** The photo's bytes if this staff member may see it, else null. */
export async function readPhoto(withStaff: WithStaff, store: PhotoStore, userId: string, photoId: string) {
  if (!UUID.test(photoId)) return null
  const row = await withStaff(userId, (tx) =>
    tx.query<{ storage_path: string }>(`select storage_path from public.item_photos where id = $1`, [photoId])
  )
  const key = row.rows[0]?.storage_path
  if (!key) return null
  return store.get(key)
}

/**
 * Deletes the record and the file together: the file is deleted inside the
 * transaction, so if that fails the record stays and the photo still shows.
 * Only managers (row-level security).
 */
export async function deletePhoto(withStaff: WithStaff, store: PhotoStore, userId: string, itemId: string, photoId: string): Promise<void> {
  if (!UUID.test(photoId) || !UUID.test(itemId)) throw new PhotoRejected('Unknown photo.')
  await withStaff(userId, async (tx) => {
    const removed = await tx.query<{ storage_path: string }>(
      `delete from public.item_photos where id = $1 and item_id = $2 returning storage_path`,
      [photoId, itemId]
    )
    const key = removed.rows[0]?.storage_path
    if (!key) throw new PhotoRejected('Only managers can delete photos.')
    await store.delete(key)
  })
}
