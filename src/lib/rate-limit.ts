// Rate limits for the public (no sign-in) pages: enquiry, status check, reply.
// The limits themselves are in the database (hit_rate_limit(), migration 015);
// this file works out WHO is asking, without ever storing it:
//   * the visitor's IP comes from the header Railway's edge sets (x-real-ip,
//     or AUTH_IP_HEADER; the same one sign-in uses), never a header the visitor
//     controls;
//   * it is turned into a keyed hash (HMAC-SHA256 with the server secret), so
//     the database holds no IP addresses and a hash can't be reversed.
// No Next.js imports, so tests can run it.
import { createHmac } from 'node:crypto'
import type { Tx } from '@/lib/db/core'

export type RateBucket = 'submit' | 'lookup' | 'reply'

export const TOO_MANY: Record<RateBucket, string> = {
  submit: 'Too many enquiries from your connection in the last hour. Please try again later, or contact the hotel directly.',
  lookup: 'Too many checks from your connection in the last hour. Please wait a while and try again.',
  reply: 'Too many messages from your connection in the last hour. Staff will reply to what you have sent.',
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6 = /^[0-9a-f:.]{2,45}$/i

/** The visitor's IP from the trusted proxy header, or 'unknown' (e.g. local dev). */
export function clientIp(headers: Headers, header = process.env.AUTH_IP_HEADER || 'x-real-ip'): string {
  const raw = (headers.get(header) ?? '').split(',')[0].trim()
  if (IPV4.test(raw) || (raw.includes(':') && IPV6.test(raw))) return raw.toLowerCase()
  return 'unknown'
}

/** Keyed hash of bucket + IP: 64 hex characters, meaningless without the secret. */
export function rateKey(bucket: RateBucket, ip: string, secret: string | undefined = process.env.BETTER_AUTH_SECRET): string {
  if (!secret || secret.length < 16) throw new Error('BETTER_AUTH_SECRET is not set (needed for rate limits).')
  return createHmac('sha256', secret).update(`returnly-rate:${bucket}:${ip}`).digest('hex')
}

/** Counts one hit. Run it in its own transaction (see migration 015). */
export async function allow(tx: Tx, bucket: RateBucket, keyHash: string): Promise<boolean> {
  const r = await tx.rpc<{ hit_rate_limit: boolean }>('hit_rate_limit', { p_bucket: bucket, p_key_hash: keyHash })
  return r.rows[0].hit_rate_limit === true
}
