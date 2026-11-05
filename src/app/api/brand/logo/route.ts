// Managers: upload (POST, JPEG body) or remove (DELETE) the hotel's logo.
// Same-site only, signed-in managers only; the database checks again
// (set_hotel_logo, migration 019). The old file is deleted after the change
// is saved. See src/lib/branding.ts.
import { getSession } from '@/lib/auth'
import { authBaseURL } from '@/lib/better-auth/instance'
import { fromOurSite } from '@/lib/better-auth/origin'
import { withStaff } from '@/lib/db'
import { BrandingError, MAX_LOGO_BYTES, removeLogo, replaceLogo } from '@/lib/branding'
import { photoStore } from '@/lib/storage'

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

async function manager(req: Request) {
  if (!fromOurSite(req, authBaseURL())) return { error: json(403, { error: 'Cross-site request refused.' }) }
  const session = await getSession()
  if (!session) return { error: json(401, { error: 'Your session has ended. Sign in again.' }) }
  if (session.staff.role !== 'manager') return { error: json(403, { error: 'Only managers can change the logo.' }) }
  return { session }
}

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

export async function POST(req: Request) {
  const m = await manager(req)
  if (m.error) return m.error
  if (req.headers.get('content-type') !== 'image/jpeg') return json(415, { error: 'Only JPEG images are accepted.' })
  if (Number(req.headers.get('content-length') ?? '0') > MAX_LOGO_BYTES) return json(413, { error: 'The logo is larger than 1 MB.' })
  const body = await readLimited(req, MAX_LOGO_BYTES)
  if (!body) return json(413, { error: 'The logo is larger than 1 MB.' })
  const store = photoStore()
  try {
    const old = await withStaff(m.session.staff.user_id, (tx) => replaceLogo(tx, store, m.session.staff.property_id, body, new URL(req.url).searchParams.get('theme') === 'dark'))
    if (old) await store.delete(old).catch((e) => console.error('old logo delete failed', e?.code ?? e?.message))
    return json(201, { ok: true })
  } catch (e) {
    if (e instanceof BrandingError) return json(400, { error: e.message })
    console.error('logo upload failed', (e as { code?: string })?.code ?? (e as Error)?.message)
    return json(500, { error: 'The logo could not be saved. Please try again.' })
  }
}

export async function DELETE(req: Request) {
  const m = await manager(req)
  if (m.error) return m.error
  const store = photoStore()
  try {
    const old = await withStaff(m.session.staff.user_id, (tx) => removeLogo(tx, new URL(req.url).searchParams.get('theme') === 'dark'))
    if (old) await store.delete(old).catch((e) => console.error('old logo delete failed', e?.code ?? e?.message))
    return json(200, { ok: true })
  } catch (e) {
    console.error('logo remove failed', (e as { code?: string })?.code ?? (e as Error)?.message)
    return json(500, { error: 'The logo could not be removed. Please try again.' })
  }
}
