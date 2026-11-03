// PR C without a database: the email templates, the Brevo client's handling
// of every kind of answer (with a fake fetch; nothing is sent), the job's
// configuration checks, the allowlist and the retry timing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderEmail, TEMPLATES } from '../scripts/email/templates.mjs'
import { sendViaBrevo, BREVO_URL } from '../scripts/email/brevo.mjs'
import { allowlistFrom, backoffMinutes, MAX_ATTEMPTS } from '../scripts/email/dispatch.mjs'
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

const fakeFetch = (status, body) => async (url, init) => {
  fakeFetch.last = { url, init }
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const mail = { apiKey: 'xkeysib-test', from: { email: 'notifications@foundora.co.uk', name: 'The Grand via Foundora' }, to: 'a@b.co', subject: 's', html: '<p>h</p>', text: 't', tag: 'received' }

test('Brevo: 201 is sent, with the message id; the request is shaped as Brevo expects', async () => {
  const r = await sendViaBrevo({ ...mail, fetchImpl: fakeFetch(201, { messageId: '<x@relay>' }) })
  assert.deepEqual(r, { ok: true, messageId: '<x@relay>' })
  assert.equal(fakeFetch.last.url, BREVO_URL)
  assert.equal(fakeFetch.last.init.headers['api-key'], 'xkeysib-test')
  const body = JSON.parse(fakeFetch.last.init.body)
  assert.deepEqual(body.to, [{ email: 'a@b.co' }])
  assert.equal(body.sender.email, 'notifications@foundora.co.uk')
  assert.ok(body.htmlContent && body.textContent && body.subject)
})

test('Brevo: 429 and 5xx are retried; 400 is permanent; the code is kept, never the request', async () => {
  assert.deepEqual(await sendViaBrevo({ ...mail, fetchImpl: fakeFetch(429, {}) }), { ok: false, permanent: false, code: 'http_429' })
  assert.deepEqual(await sendViaBrevo({ ...mail, fetchImpl: fakeFetch(502, {}) }), { ok: false, permanent: false, code: 'http_502' })
  const bad = await sendViaBrevo({ ...mail, fetchImpl: fakeFetch(400, { code: 'invalid_parameter', message: 'email a@b.co is not valid' }) })
  assert.deepEqual(bad, { ok: false, permanent: true, code: 'http_400:invalid_parameter' })
  const net = await sendViaBrevo({ ...mail, fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.deepEqual(net, { ok: false, permanent: false, code: 'network' })
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

test('configuration: off by default; live needs an API key, sender, https address', () => {
  assert.equal(readConfig({}).mode, 'off')
  assert.deepEqual(readConfig({}).problems, [])
  const p = readConfig({ EMAIL_MODE: 'live' }).problems.join(' | ')
  assert.match(p, /BREVO_API_KEY is not set/)
  assert.match(p, /EMAIL_FROM/)
  assert.match(p, /PUBLIC_BASE_URL/)
  assert.match(readConfig({ EMAIL_MODE: 'loud' }).problems.join(), /EMAIL_MODE must be/)
  const good = readConfig({ EMAIL_MODE: 'live', BREVO_API_KEY: 'xkeysib-x', EMAIL_FROM: 'Notifications@Foundora.co.uk',
    PUBLIC_BASE_URL: 'https://web-staging-003c.up.railway.app/', EMAIL_ALLOWLIST: 'me@example.com', RAILWAY_ENVIRONMENT_NAME: 'staging' })
  assert.deepEqual(good.problems, [])
  assert.equal(good.from.email, 'notifications@foundora.co.uk')
  assert.equal(good.baseUrl, 'https://web-staging-003c.up.railway.app')
})

test('the email log masks addresses', () => {
  assert.equal(maskEmail('ann.guest@example.com'), 'a••••t@example.com')
  assert.equal(maskEmail('al@example.com'), 'a•@example.com')
})
