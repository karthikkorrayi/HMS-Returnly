// Without a database: the email templates, the Resend client's handling
// of every kind of answer (with a fake fetch; nothing is sent), the job's
// configuration checks, the allowlist and the retry timing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderEmail, TEMPLATES } from '../scripts/email/templates.mjs'
import { sendViaResend, RESEND_URL, formatFrom } from '../scripts/email/resend.mjs'
import { allowlistFrom, backoffMinutes, MAX_ATTEMPTS, emailToken, idempotencyKey } from '../scripts/email/dispatch.mjs'
import { readConfig } from '../scripts/email-dispatch.mjs'
import { maskEmail } from '../src/lib/email-log.ts'

const base = {
  reportType: 'lost', reference: 'LF-12345-ABCDE', itemName: 'Blue scarf', createdAt: '2026-11-03T10:00:00Z',
  trackUrl: 'https://staging.example/track?ref=LF-12345-ABCDE#t=' + 'a'.repeat(64),
  hotel: { name: 'The Grand', contactEmail: 'desk@grand.example', contactPhone: '+44 20 0000 0000', supportHours: '24 hours' },
}

test('every template renders a subject, HTML and plain text with the reference and link', () => {
  for (const template of TEMPLATES) {
    for (const reportType of ['lost', 'found']) {
      const m = renderEmail({ ...base, template, reportType })
      assert.ok(m.subject.length > 5 && m.subject.length < 120, template)
      for (const part of [m.html, m.text]) {
        assert.ok(part.includes('LF-12345-ABCDE'), `${template} reference`)
        assert.ok(part.includes('The Grand'), `${template} hotel`)
      }
      assert.ok(m.text.includes(base.trackUrl), `${template} link in text`)
      assert.ok(m.html.includes('href="https://staging.example/track?ref=LF-12345-ABCDE#t='), `${template} link in html`)
      assert.match(m.text, /Sent by Foundora on behalf of The Grand/)
    }
  }
})

test('a finder is never told about owners or matches', () => {
  for (const template of TEMPLATES) {
    const m = renderEmail({ ...base, template, reportType: 'found' })
    assert.doesNotMatch(m.text, /your item|photo ID|matches your booking/i, template)
  }
  assert.match(renderEmail({ ...base, template: 'received', reportType: 'found' }).text, /reception/)
})

test('hotel names and item names are escaped (no HTML from outside)', () => {
  const m = renderEmail({ ...base, template: 'received', itemName: '<img src=x onerror=alert(1)>', hotel: { ...base.hotel, name: 'Bad <b>Hotel</b> & Co' } })
  assert.ok(!m.html.includes('<img src=x'))
  assert.ok(m.html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(m.html.includes('Bad &lt;b&gt;Hotel&lt;/b&gt; &amp; Co'))
})

test('brand colour and logo are used only when safe', () => {
  const ok = renderEmail({ ...base, template: 'received', hotel: { ...base.hotel, colour: '#123ABC', logoUrl: 'https://cdn.example/l.png' } })
  assert.ok(ok.html.includes('#123ABC') && ok.html.includes('https://cdn.example/l.png'))
  const bad = renderEmail({ ...base, template: 'received', hotel: { ...base.hotel, colour: 'red;background:url(x)', logoUrl: 'javascript:alert(1)' } })
  assert.ok(!bad.html.includes('url(x)') && !bad.html.includes('javascript:'))
  assert.ok(bad.html.includes('#0b6468'))
})

test('a staff message email says there is a message, without its text', () => {
  const m = renderEmail({ ...base, template: 'staff_message' })
  assert.match(m.text, /shown on your report page, not in this email/)
})

test('unknown templates are refused', () => {
  assert.throws(() => renderEmail({ ...base, template: 'marketing' }), /unknown email template/)
})

const fakeFetch = (status, body, headers = {}) => async (url, init) => {
  fakeFetch.last = { url, init }
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}
const KEY = 're_unitTestKey_not_real_123'
const mail = { apiKey: KEY, from: { email: 'notifications@foundora.co.uk', name: 'The Grand via Foundora' }, to: 'a@b.co',
  subject: 's', html: '<p>h</p>', text: 't', tag: 'received', idempotencyKey: 'foundora-abc-outbox-7' }

test('Resend: 200 is accepted, with the email id; the request is shaped as Resend expects', async () => {
  const r = await sendViaResend({ ...mail, fetchImpl: fakeFetch(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }) })
  assert.deepEqual(r, { ok: true, messageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' })
  assert.equal(fakeFetch.last.url, RESEND_URL)
  assert.equal(fakeFetch.last.url, 'https://api.resend.com/emails')
  assert.equal(fakeFetch.last.init.method, 'POST')
  assert.equal(fakeFetch.last.init.headers.authorization, `Bearer ${KEY}`)
  assert.equal(fakeFetch.last.init.headers['idempotency-key'], 'foundora-abc-outbox-7')
  const body = JSON.parse(fakeFetch.last.init.body)
  assert.deepEqual(body.to, ['a@b.co'])
  assert.equal(body.from, '"The Grand via Foundora" <notifications@foundora.co.uk>')
  assert.ok(body.html && body.text && body.subject)
  assert.deepEqual(body.tags, [{ name: 'template', value: 'received' }])
  assert.ok(!fakeFetch.last.init.body.includes(KEY), 'the key is only in the header')
})

test('Resend: sender names are quoted safely and can never add headers', () => {
  assert.equal(formatFrom({ name: 'Smith, Jones & "Co" via Foundora', email: 'n@f.co.uk' }), '"Smith, Jones & \\"Co\\" via Foundora" <n@f.co.uk>')
  assert.equal(formatFrom({ name: 'Evil\r\nBcc: x@y.z', email: 'n@f.co.uk' }), '"Evil Bcc: x@y.z" <n@f.co.uk>')
  assert.equal(formatFrom({ name: '', email: 'n@f.co.uk' }), 'n@f.co.uk')
})

test('Resend: every kind of answer is classified; only the short error name is kept', async () => {
  const kind = async (status, body = {}, headers = {}) => sendViaResend({ ...mail, fetchImpl: fakeFetch(status, body, headers) })
  assert.deepEqual(await kind(401, { name: 'missing_api_key', message: 'Missing API key' }), { ok: false, kind: 'config', code: 'http_401:missing_api_key' })
  assert.deepEqual(await kind(403, { name: 'invalid_api_key' }), { ok: false, kind: 'config', code: 'http_403:invalid_api_key' })
  assert.deepEqual(await kind(403, { name: 'validation_error', message: 'The foundora.co.uk domain is not verified' }), { ok: false, kind: 'config', code: 'http_403:validation_error' })
  assert.deepEqual(await kind(422, { name: 'invalid_from_address' }), { ok: false, kind: 'config', code: 'http_422:invalid_from_address' })
  assert.deepEqual(await kind(422, { name: 'validation_error', message: 'Invalid `to` field' }), { ok: false, kind: 'permanent', code: 'http_422:validation_error' })
  assert.deepEqual(await kind(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '2' }), { ok: false, kind: 'rate', code: 'http_429:rate_limit_exceeded', retryAfter: 2 })
  assert.equal((await kind(429, { name: 'rate_limit_exceeded' })).retryAfter, 1, 'no header: wait 1 second')
  assert.deepEqual(await kind(429, { name: 'daily_quota_exceeded' }), { ok: false, kind: 'quota', code: 'http_429:daily_quota_exceeded' })
  assert.deepEqual(await kind(429, { name: 'monthly_quota_exceeded' }), { ok: false, kind: 'quota', code: 'http_429:monthly_quota_exceeded' })
  assert.deepEqual(await kind(409, { name: 'concurrent_idempotent_requests' }), { ok: false, kind: 'retry', code: 'http_409:concurrent_idempotent_requests' })
  assert.deepEqual(await kind(409, { name: 'invalid_idempotent_request' }), { ok: false, kind: 'permanent', code: 'http_409:invalid_idempotent_request' })
  assert.deepEqual(await kind(500, { name: 'internal_server_error' }), { ok: false, kind: 'retry', code: 'http_500:internal_server_error' })
  assert.deepEqual(await sendViaResend({ ...mail, fetchImpl: async () => { throw new TypeError('fetch failed') } }), { ok: false, kind: 'retry', code: 'network' })
  // A request cut off by the 15-second limit (AbortSignal.timeout) rejects with a TimeoutError.
  let given
  const slow = await sendViaResend({ ...mail, fetchImpl: async (u, init) => { given = init.signal; throw new DOMException('timed out', 'TimeoutError') } })
  assert.ok(given instanceof AbortSignal, 'every request has a time limit')
  assert.deepEqual(slow, { ok: false, kind: 'retry', code: 'timeout' })
  const leak = await kind(422, { name: 'validation_error', message: 'a@b.co is invalid' })
  assert.ok(!JSON.stringify(leak).includes('a@b.co'), 'never keeps the message text')
})

test('tracking tokens: the same for every attempt of one email, different for every email; idempotency keys likewise', () => {
  const secret = 'x'.repeat(40)
  assert.match(emailToken(secret, 7), /^[0-9a-f]{64}$/)
  assert.equal(emailToken(secret, 7), emailToken(secret, 7), 'retry: same link')
  assert.notEqual(emailToken(secret, 7), emailToken(secret, 8), 'another email: another link')
  assert.notEqual(emailToken(secret, 7), emailToken('y'.repeat(40), 7), 'another environment: another link')
  assert.throws(() => emailToken('short', 7), /EMAIL_LINK_SECRET/)
  assert.equal(idempotencyKey(secret, 7), idempotencyKey(secret, 7))
  assert.notEqual(idempotencyKey(secret, 7), idempotencyKey('y'.repeat(40), 7), 'staging and production never collide')
  assert.match(idempotencyKey(secret, 7), /^foundora-[0-9a-f]{16}-outbox-7$/)
  assert.ok(!idempotencyKey(secret, 7).includes(secret.slice(0, 8)))
})

test('allowlist: exact addresses and @domains, case-insensitive input', () => {
  const allow = allowlistFrom(' Me@Example.com , @hotel.example ')
  assert.ok(allow('me@example.com'))
  assert.ok(allow('desk@hotel.example'))
  assert.ok(!allow('someone@example.com'))
  assert.ok(!allow('x@nothotel.example'))
  assert.equal(allowlistFrom(''), null)
})

test('retries wait 1, 5, 15, 60 then 360 minutes; 6 attempts at most', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(backoffMinutes), [1, 5, 15, 60, 360, 360])
  assert.equal(MAX_ATTEMPTS, 6)
})

const LINK = 'L'.repeat(40)
test('configuration: off by default; live needs a Resend key, the link secret, a sender and an https address', () => {
  assert.equal(readConfig({}).mode, 'off')
  assert.deepEqual(readConfig({}).problems, [])
  const p = readConfig({ EMAIL_MODE: 'live' }).problems.join(' | ')
  assert.match(p, /RESEND_API_KEY is not set/)
  assert.match(p, /EMAIL_LINK_SECRET/)
  assert.match(p, /EMAIL_FROM/)
  assert.match(p, /PUBLIC_BASE_URL/)
  assert.match(readConfig({ EMAIL_MODE: 'loud' }).problems.join(), /EMAIL_MODE must be/)
  const ok = { EMAIL_MODE: 'live', RESEND_API_KEY: 're_abcdefgh123', EMAIL_LINK_SECRET: LINK, EMAIL_FROM: 'Notifications@Foundora.co.uk',
    PUBLIC_BASE_URL: 'https://web-staging-003c.up.railway.app/', EMAIL_ALLOWLIST: 'me@example.com', RAILWAY_ENVIRONMENT_NAME: 'staging' }
  const good = readConfig(ok)
  assert.deepEqual(good.problems, [])
  assert.equal(good.from.email, 'notifications@foundora.co.uk')
  assert.equal(good.baseUrl, 'https://web-staging-003c.up.railway.app')
  assert.equal(good.linkSecret, LINK)
  assert.match(readConfig({ ...ok, RESEND_API_KEY: 'xkeysib-abc' }).problems.join(), /does not look like a Resend API key/)
  assert.match(readConfig({ ...ok, EMAIL_LINK_SECRET: 'short' }).problems.join(), /EMAIL_LINK_SECRET must be at least 32/)
  assert.match(readConfig({ ...ok, BREVO_API_KEY: 'xkeysib-old' }).problems.join(), /BREVO_API_KEY is still set/)
  assert.ok(!readConfig({ ...ok, RESEND_API_KEY: 'bad-key-value' }).problems.join().includes('bad-key-value'), 'never prints values')
})

test('the email log masks addresses', () => {
  assert.equal(maskEmail('ann.guest@example.com'), 'a••••t@example.com')
  assert.equal(maskEmail('al@example.com'), 'a•@example.com')
})
