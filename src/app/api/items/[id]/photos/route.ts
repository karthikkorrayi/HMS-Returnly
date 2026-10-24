// Upload one photo of a found item: POST the JPEG as the request body.
// Same-site only (cross-site check), signed-in staff only; the database then
// decides (row-level security) whether this person may add a photo to this
// item. See src/lib/item-photos.ts.
import { getSession } from '@/lib/auth'
import { authBaseURL } from '@/lib/better-auth/instance'
import { fromOurSite } from '@/lib/better-auth/origin'
import { withStaff } from '@/lib/db'
import { addPhoto, PhotoRejected } from '@/lib/item-photos'
import { MAX_PHOTO_BYTES } from '@/lib/storage/jpeg'
import { photoStore } from '@/lib/storage'

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

// Reads at most `limit` bytes; null if the body is larger.
async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!fromOurSite(req, authBaseURL())) return json(403, { error: 'Cross-site request refused.' })
  const session = await getSession()
  if (!session) return json(401, { error: 'Your session has ended. Sign in again.' })
  if (session.staff.role === 'support') return json(403, { error: 'Support staff cannot add photos.' })
  if (req.headers.get('content-type') !== 'image/jpeg') return json(415, { error: 'Only JPEG photos are accepted.' })
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_PHOTO_BYTES) return json(413, { error: 'Photo is larger than 5 MB.' })

  const body = await readLimited(req, MAX_PHOTO_BYTES)
  if (!body) return json(413, { error: 'Photo is larger than 5 MB.' })

  const { id } = await ctx.params
  try {
    const photoId = await addPhoto(withStaff, photoStore(), session.staff.user_id, id, body)
    return json(201, { id: photoId })
  } catch (e) {
    if (e instanceof PhotoRejected) return json(400, { error: e.message })
    console.error('photo upload failed', e)
    return json(500, { error: 'The photo could not be saved. Please try again.' })
  }
}
