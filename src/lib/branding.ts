// Hotel branding (migration 019): web address (slug), email colour, welcome
// line and logo. Managers change it on Settings → Branding; guests see the
// logo and name on the hotel's pages, customers in every email.
// No Next.js imports, so tests can run it.
import { randomUUID } from 'node:crypto'
import type { Tx } from '@/lib/db/core'
import { cleanJpeg, PhotoRejected } from '@/lib/storage/jpeg'
import type { PhotoStore } from '@/lib/storage/s3'
import { isValidSlug } from './branding-paths'

export { isValidSlug, logoPath, RESERVED_SLUGS } from './branding-paths'

export class BrandingError extends Error {}

export const MAX_LOGO_BYTES = 1024 * 1024 // 1 MB (the phone shrinks it to 600 px first)

/** "The Grand Hotel, London" → "the-grand-hotel-london" (a suggestion; the manager decides). */
export function suggestSlug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}

// WCAG contrast of white text on the colour: buttons in emails are white on it.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05)
}
export const MIN_CONTRAST = 4.5

/** Checks a colour; returns it in lower case, or null for "use the default". */
export function cleanColour(raw: string): string | null {
  const c = raw.trim().toLowerCase()
  if (!c) return null
  if (!/^#[0-9a-f]{6}$/.test(c)) throw new BrandingError('Colour: use the form #1A2B3C.')
  if (contrastWithWhite(c) < MIN_CONTRAST) {
    throw new BrandingError('That colour is too light: white button text on it would be hard to read. Choose a darker shade.')
  }
  return c
}

export type Branding = {
  inn_code: string
  name: string
  slug: string
  brand_colour: string | null
  brand_intro: string | null
  logo_key: string | null
  mark_logo_key: string | null
  dark_logo_key: string | null
  logo_version: number
}

export async function loadBranding(tx: Tx): Promise<Branding> {
  const { rows } = await tx.query<Branding>(
    `select inn_code, name, slug, brand_colour, brand_intro, logo_key, dark_logo_key, mark_logo_key, logo_version
       from public.properties where id = public.current_property_id()`
  )
  if (!rows[0]) throw new BrandingError('Hotel not found.')
  return rows[0]
}

export async function saveBranding(tx: Tx, input: { slug: string; colour: string; intro: string }) {
  const slug = input.slug.trim().toLowerCase()
  if (!isValidSlug(slug)) {
    throw new BrandingError('Web address: 3–40 lower-case letters, digits or dashes (not at the start or end), and not a reserved word.')
  }
  const intro = input.intro.trim()
  if (intro.length > 300) throw new BrandingError('Welcome line: up to 300 characters.')
  if (/[<>]/.test(intro)) throw new BrandingError('Welcome line: plain text only (no < or >).')
  await tx.rpc('update_hotel_branding', { p_slug: slug, p_colour: cleanColour(input.colour), p_intro: intro || null })
}

/**
 * Stores a new logo (a JPEG the phone has already shrunk), cleaned like an
 * item photo, and points the hotel at it. Returns the previous key, which the
 * caller deletes after the change is saved.
 */
export async function replaceLogo(tx: Tx, store: PhotoStore, propertyId: string, body: Uint8Array, dark: boolean | 'mark' = false): Promise<string | null> {
  if (body.byteLength > MAX_LOGO_BYTES) throw new BrandingError('The logo is larger than 1 MB.')
  let clean: Uint8Array
  try {
    clean = cleanJpeg(body)
  } catch (e) {
    throw new BrandingError(e instanceof PhotoRejected ? e.message.replace('photo', 'logo').replace('Photo', 'Logo') : 'The logo could not be read.')
  }
  const key = `${propertyId}/brand/${randomUUID()}.jpg`
  await store.put(key, clean, 'image/jpeg')
  try {
    const fn = dark === 'mark' ? 'set_hotel_mark_logo' : dark ? 'set_hotel_dark_logo' : 'set_hotel_logo'
    const r = await tx.rpc(fn, { p_key: key })
    return r.rows[0][fn] as string | null
  } catch (e) {
    await store.delete(key).catch(() => {})
    throw e
  }
}

export async function removeLogo(tx: Tx, dark: boolean | 'mark' = false): Promise<string | null> {
  const fn = dark === 'mark' ? 'set_hotel_mark_logo' : dark ? 'set_hotel_dark_logo' : 'set_hotel_logo'
  const r = await tx.rpc(fn, { p_key: null })
  return r.rows[0][fn] as string | null
}

export type PublicHotel = { inn_code: string; name: string; slug: string; brand_colour: string | null; has_logo: boolean; logo_version: number }

export async function publicHotels(tx: Tx): Promise<PublicHotel[]> {
  return (await tx.rpc<PublicHotel>('public_hotels')).rows
}

export async function publicLogoKey(tx: Tx, slug: string, dark: boolean | 'mark' = false): Promise<string | null> {
  if (!isValidSlug(slug)) return null
  const fn = dark === 'mark' ? 'public_hotel_mark_logo' : dark ? 'public_hotel_dark_logo' : 'public_hotel_logo'
  const r = await tx.rpc(fn, { p_slug: slug })
  return r.rows[0]?.[fn] as string | null ?? null
}
