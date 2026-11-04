// The hotel's logo, for everyone (guest pages and customer emails show it).
// Public on purpose; only the logo is served here, never item photos: the
// key comes from the hotel's record and must be one of its brand/ files.
import { withAnon } from '@/lib/db'
import { publicLogoKey } from '@/lib/branding'
import { photoStore } from '@/lib/storage'

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300', 'content-type': 'text/plain' } })

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  try {
    const key = await withAnon((tx) => publicLogoKey(tx, decodeURIComponent(slug).toLowerCase()))
    if (!key || !/^[0-9a-f-]{36}\/brand\/[0-9a-f-]{36}\.jpg$/.test(key)) return notFound()
    const file = await photoStore().get(key)
    if (!file) return notFound()
    return new Response(file.body as BodyInit, {
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(file.body.byteLength),
        // The address carries ?v=<version>, so a new logo gets a new address.
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        // Email clients and other sites may show it.
        'cross-origin-resource-policy': 'cross-origin',
      },
    })
  } catch (e) {
    console.error('logo read failed', (e as { code?: string })?.code ?? (e as Error)?.message)
    return new Response('Logo unavailable', { status: 502, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } })
  }
}
