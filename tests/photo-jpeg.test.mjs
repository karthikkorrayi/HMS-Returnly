// Photo checks that need no database or bucket: the server-side JPEG
// clean-up (src/lib/storage/jpeg.ts) and the photo store's own guards
// (src/lib/storage/s3.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanJpeg, PhotoRejected, MAX_PHOTO_BYTES } from '../src/lib/storage/jpeg.ts'
import { makeStore, storeConfigFromEnv, StorageError } from '../src/lib/storage/s3.ts'

// An 8×8 red JPEG (made with Pillow), as a phone would send after re-encoding.
export const SMALL_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z', 'base64')

const segment = (marker, payload) => {
  const p = Buffer.from(payload)
  return Buffer.concat([Buffer.from([0xff, marker, (p.length + 2) >> 8, (p.length + 2) & 0xff]), p])
}
// The same photo with an EXIF block (incl. a fake GPS position and serial
// number), an XMP block and a comment inserted after the start marker.
export function withMetadata(jpeg = SMALL_JPEG) {
  return Buffer.concat([
    jpeg.subarray(0, 2),
    segment(0xe1, 'Exif\0\0GPSLatitude=51.5072 GPSLongitude=-0.1276 BodySerialNumber=SN-PRIVATE-123'),
    segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Owner: Jane Guest</x:xmpmeta>'),
    segment(0xfe, 'Taken in room 214'),
    jpeg.subarray(2),
  ])
}
const has = (buf, text) => Buffer.from(buf).includes(Buffer.from(text))

test('metadata is removed and the image data kept exactly', () => {
  const dirty = withMetadata()
  assert.ok(has(dirty, 'GPSLatitude') && has(dirty, 'Jane Guest') && has(dirty, 'room 214'))
  const clean = Buffer.from(cleanJpeg(dirty))
  for (const t of ['Exif', 'GPSLatitude', 'SN-PRIVATE', 'xmpmeta', 'Jane Guest', 'room 214']) assert.ok(!has(clean, t), t)
  assert.deepEqual(clean, SMALL_JPEG, 'cleaning the dirty copy gives back the original photo byte for byte')
  assert.deepEqual(Buffer.from(cleanJpeg(SMALL_JPEG)), SMALL_JPEG, 'a clean photo passes unchanged')
})

test('anything that is not a complete JPEG is refused', () => {
  const refuses = (bytes, re) => assert.throws(() => cleanJpeg(bytes), (e) => e instanceof PhotoRejected && re.test(e.message))
  refuses(Buffer.from('89504e470d0a1a0a0000', 'hex'), /Only JPEG/)                 // PNG
  refuses(Buffer.from('<svg onload=alert(1)>'), /Only JPEG/)                        // script disguised as an image
  refuses(Buffer.alloc(0), /Only JPEG/)
  refuses(SMALL_JPEG.subarray(0, 300), /damaged/)                                   // cut off before the image data
  refuses(Buffer.concat([SMALL_JPEG.subarray(0, 2), Buffer.from([0xff, 0xd9])]), /no image data/)
  refuses(Buffer.concat([SMALL_JPEG.subarray(0, 2), Buffer.from([0xff, 0xe1, 0xff, 0xff])]), /damaged/) // length past the end
  refuses(new Uint8Array(MAX_PHOTO_BYTES + 1), /larger than 5 MB/)
})

test('the photo store only addresses well-formed photo keys', async () => {
  const store = makeStore({ endpoint: 'http://127.0.0.1:9', bucket: 'item-photos', accessKeyId: 'x', secretAccessKey: 'y' })
  for (const key of ['../secrets', 'a/b/c.jpg', '00000000-0000-0000-0000-000000000000/../x.jpg', '']) {
    await assert.rejects(store.get(key), (e) => e instanceof StorageError && /Invalid photo key/.test(e.message), key)
  }
  assert.throws(() => makeStore({ endpoint: 'http://x', bucket: 'Bad Bucket!', accessKeyId: 'x', secretAccessKey: 'y' }), /Invalid bucket/)
})

test('store settings come from the environment and missing ones are named', () => {
  assert.throws(() => storeConfigFromEnv({}), /S3_ENDPOINT is not set/)
  const cfg = storeConfigFromEnv({ S3_ENDPOINT: 'http://127.0.0.1:7070', S3_BUCKET: 'item-photos', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b' })
  assert.equal(cfg.pathStyle, true)
  assert.equal(cfg.region, 'us-east-1')
  assert.equal(storeConfigFromEnv({ ...cfg, S3_ENDPOINT: 'x', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b', S3_PATH_STYLE: 'false' }).pathStyle, false)
})
