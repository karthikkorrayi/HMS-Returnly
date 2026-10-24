// Shows one photo to signed-in staff of the same hotel (decision A: the app
// serves every photo; there are no shareable links). The database decides
// (row-level security) on every request, so ending a session or deactivating
// someone takes effect on the very next photo.
import { getSession } from '@/lib/auth'
import { withStaff } from '@/lib/db'
import { readPhoto } from '@/lib/item-photos'
import { photoStore } from '@/lib/storage'

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } })

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return notFound() // same answer as "no such photo": reveals nothing
  const { id } = await ctx.params
  try {
    const photo = await readPhoto(withStaff, photoStore(), session.staff.user_id, id)
    if (!photo) return notFound()
    return new Response(photo.body as BodyInit, {
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(photo.body.byteLength),
        // Kept in the browser's memory for this session only; never by shared caches.
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        'cross-origin-resource-policy': 'same-origin',
      },
    })
  } catch (e) {
    console.error('photo read failed', e)
    return new Response('Photo unavailable', { status: 502, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } })
  }
}
