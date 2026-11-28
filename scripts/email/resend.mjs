// Sends one email through Resend's HTTPS API (Railway blocks outbound SMTP
// below the Pro plan). The API key comes from the caller (an environment
// variable) and is never logged. Returns a classified result so the
// dispatcher knows whether to retry, stop the run, or give up on one email.
//
// Duplicate protection: every call carries an Idempotency-Key that is the
// same for every attempt of the same email (the dispatcher builds it from the
// outbox row). The dispatcher also keeps the email itself identical across
// attempts, so if a timeout hid an accepted email, Resend recognises the
// retry and does not send it twice (keys are kept 24 hours).

export const RESEND_URL = 'https://api.resend.com/emails'

/**
 * "The Grand, London" <notifications@foundora.co.uk>, safely quoted.
 * Line breaks are removed so a hotel name can never add mail headers.
 */
export function formatFrom({ name, email }) {
  const clean = String(name ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  if (!clean) return email
  return `"${clean.replace(/["\\]/g, '\\$&')}" <${email}>`
}

/**
 * Error kinds:
 *   retry      temporary (network, timeout, 5xx, request already in progress)
 *   rate       too many requests per second: wait `retryAfter` seconds
 *   quota      daily/monthly quota reached: stop this run, try later
 *   config     wrong/missing API key, unverified domain, invalid sender: stop this run
 *   permanent  this one email can't be sent (invalid recipient, bad request)
 *
 * @returns {Promise<{ ok: true, messageId: string }
 *   | { ok: false, kind: 'retry'|'rate'|'quota'|'config'|'permanent', code: string, retryAfter?: number }>}
 */
export async function sendViaResend({ apiKey, from, to, subject, html, text, tag, idempotencyKey, fetchImpl = fetch, timeoutMs = 15000 }) {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'foundora-email-dispatch' }
  if (idempotencyKey) headers['idempotency-key'] = String(idempotencyKey).slice(0, 256)
  let res
  try {
    res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: formatFrom(from), to: [to], subject, html, text,
        // Tag values: letters, digits, _ and - only.
        tags: tag ? [{ name: 'template', value: String(tag).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }] : undefined,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    return { ok: false, kind: 'retry', code: e?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 200 || res.status === 201) {
    return { ok: true, messageId: typeof body.id === 'string' ? body.id.slice(0, 200) : '' }
  }
  // Keep only Resend's short error name ("validation_error", …), never the request or the message text.
  const name = typeof body.name === 'string' ? body.name.replace(/[^a-z_]/g, '').slice(0, 60) : ''
  const code = `http_${res.status}${name ? ':' + name : ''}`
  if (res.status === 429) {
    if (/quota/.test(name)) return { ok: false, kind: 'quota', code }
    const after = Number(res.headers.get('retry-after') ?? res.headers.get('ratelimit-reset'))
    return { ok: false, kind: 'rate', code, retryAfter: Number.isFinite(after) && after > 0 ? Math.min(after, 60) : 1 }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: 'config', code }
  if (res.status === 422 && name === 'invalid_from_address') return { ok: false, kind: 'config', code }
  if (res.status === 409 && name === 'concurrent_idempotent_requests') return { ok: false, kind: 'retry', code }
  if (res.status >= 500) return { ok: false, kind: 'retry', code }
  return { ok: false, kind: 'permanent', code }
}
