// Server-side check and clean-up of uploaded photos. The phone already
// re-encodes photos (src/lib/photos.ts), but the server must not trust that:
// a crafted request could send anything. This accepts only a structurally
// valid JPEG and removes every metadata segment that can carry personal data:
// EXIF (incl. GPS location and camera serial number), XMP, IPTC, the other
// application segments APP2–APP15 (ICC colour profiles among them), and
// comments. The image data itself is untouched.
//
// JPEG layout: FFD8, then segments FFxx + 2-byte length + data, until SOS
// (FFDA), whose entropy-coded data runs until FFD9. We copy segments we keep
// and drop APP1–APP15 and COM. APP0 (JFIF) is kept; it holds no personal data.
export class PhotoRejected extends Error {}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // same limit as the old Supabase bucket

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const COM = 0xfe
const isApp = (m: number) => m >= 0xe0 && m <= 0xef

export function cleanJpeg(input: Uint8Array): Uint8Array {
  if (input.byteLength > MAX_PHOTO_BYTES) throw new PhotoRejected('Photo is larger than 5 MB.')
  if (input.byteLength < 4 || input[0] !== 0xff || input[1] !== SOI) throw new PhotoRejected('Only JPEG photos are accepted.')

  const out: Uint8Array[] = [input.subarray(0, 2)]
  let i = 2
  for (;;) {
    if (i + 2 > input.byteLength || input[i] !== 0xff) throw new PhotoRejected('The photo file is damaged.')
    // Skip fill bytes (FF FF ...).
    while (input[i + 1] === 0xff && i + 2 < input.byteLength) i++
    const marker = input[i + 1]
    if (marker === EOI) throw new PhotoRejected('The photo has no image data.')
    if (i + 4 > input.byteLength) throw new PhotoRejected('The photo file is damaged.')
    const len = (input[i + 2] << 8) | input[i + 3]
    if (len < 2 || i + 2 + len > input.byteLength) throw new PhotoRejected('The photo file is damaged.')
    const segment = input.subarray(i, i + 2 + len)

    if (marker === SOS) {
      // Image data follows: keep everything from here to the end marker.
      const end = lastEoi(input)
      if (end < i + 2 + len) throw new PhotoRejected('The photo file is damaged.')
      out.push(input.subarray(i, end + 2))
      break
    }
    const drop = marker === COM || (isApp(marker) && marker !== 0xe0)
    if (!drop) out.push(segment)
    i += 2 + len
  }

  const total = out.reduce((n, p) => n + p.byteLength, 0)
  const result = new Uint8Array(total)
  let at = 0
  for (const p of out) {
    result.set(p, at)
    at += p.byteLength
  }
  return result
}

function lastEoi(b: Uint8Array): number {
  for (let j = b.byteLength - 2; j >= 2; j--) if (b[j] === 0xff && b[j + 1] === EOI) return j
  return -1
}
