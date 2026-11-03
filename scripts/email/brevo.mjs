// Sends one email through Brevo's transactional API over HTTPS (Railway blocks
// outbound SMTP below the Pro plan). The API key comes from the caller (an
// environment variable) and is never logged. Returns a classified result so
// the dispatcher can retry only what is worth retrying.

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

/**
 * @returns {Promise<{ ok: true, messageId: string } | { ok: false, permanent: boolean, code: string }>}
 */
export async function sendViaBrevo({ apiKey, from, to, subject, html, text, tag, fetchImpl = fetch, timeoutMs = 15000 }) {
  let res
  try {
    res = await fetchImpl(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html, textContent: text, tags: [tag] }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    return { ok: false, permanent: false, code: e?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
  if (res.status === 201 || res.status === 200) {
    const body = await res.json().catch(() => ({}))
    return { ok: true, messageId: typeof body.messageId === 'string' ? body.messageId.slice(0, 200) : '' }
  }
  // Brevo's error body has a short code ("unauthorized", "invalid_parameter"…);
  // keep only that, never the request.
  const body = await res.json().catch(() => ({}))
  const code = `http_${res.status}${typeof body.code === 'string' ? ':' + body.code.slice(0, 60) : ''}`
  const transient = res.status === 429 || res.status >= 500
  return { ok: false, permanent: !transient, code }
}
