// Run with: npm run test:db
// PR C: customer emails through the outbox (migration 017) and the dispatcher
// (scripts/email/dispatch.mjs, scripts/email-dispatch.mjs). Brevo is replaced
// by a fake; nothing leaves the machine. Checks which events queue an email,
// that nothing is emailed twice, preview / allowlist / live, retries, a bad
// API key, expiry, the per-email tracking token, what is stored, and who can
// read the log. Both test databases; parallel runs and the command line on
// real Postgres.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { submitReport, reportStatus, friendly } from '../../src/lib/requests/public-queries.ts'
import { loadEmailLog } from '../../src/lib/email-log.ts'
import { dispatch, allowlistFrom } from '../../scripts/email/dispatch.mjs'
import { runDispatch, readConfig } from '../../scripts/email-dispatch.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, connectAs, close } = await openTestDb('email')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))
const MGR = randomUUID(), HK = randomUUID(), OTHER = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${MGR}'), ('${HK}'), ('${OTHER}');
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  update public.properties set contact_phone = '+44 20 0000 0000' where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${MGR}', id, 'mgr.mail', 'Mo', 'manager' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${HK}', id, 'hk.mail', 'Hana', 'housekeeping' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${OTHER}', id, 'other.mail', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';`)

let pool
if (real) {
  const pg = (await import('pg')).default
  pool = new pg.Pool({ connectionString: urlFor('app_user'), max: 3, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p).then((r) => ({ ...r, rowCount: r.affectedRows ?? r.rows.length })), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const A = (fn) => app.withAnon(fn)
const S = (who, fn) => app.withStaff(who, fn)
const errOf = async (fn) => { try { await fn(); return '' } catch (e) { return e.code ?? e.message } }
// The owner's connection (the email job logs in as app_owner).
const ownerDb = real
  ? await connectAs('app_owner')
  : { query: async (sql, p) => { await db.exec('reset role; set role app_owner'); try { return await db.query(sql, p) } finally { await db.exec('reset role; set role app_user') } } }
const rows = async (sql, p) => (await ownerDb.query(sql, p)).rows
const outbox = (ref) => rows(`select o.* from public.email_outbox o join public.customer_requests r on r.id = o.request_id where r.reference = $1 order by o.id`, [ref])

const lost = (o = {}) => ({ innCode: 'DEMO', reportType: 'lost', email: 'ann@example.com', emailConfirmed: true, itemName: 'Blue scarf',
  description: 'Blue wool scarf with a tassel', category: 'clothing', colour: null, brand: null, location: null, date: null,
  customerName: 'Ann Guest', bookingRef: 'BK-1', whereabouts: null, ...o })
const found = (o = {}) => ({ ...lost(), reportType: 'found', email: 'finder@example.org', itemName: 'Black umbrella', description: '',
  customerName: null, bookingRef: null, whereabouts: 'handed_in', ...o })
const idOf = async (ref) => (await rows(`select id from public.customer_requests where reference = $1`, [ref]))[0].id
const staffDo = (fn, args) => S(MGR, (tx) => tx.rpc(fn, args))

console.log('\nWhich events queue an email')
const L = await A((tx) => submitReport(tx, lost()))
const lid = await idOf(L.reference)
let q = await outbox(L.reference)
check(q.length === 1 && q[0].template === 'received' && q[0].status === 'queued' && q[0].recipient === 'ann@example.com',
  'sending a report queues "received" in the same transaction', JSON.stringify(q.map((x) => x.template)))
await staffDo('set_request_status', { p_request_id: lid, p_to: 'under_investigation', p_note: null })
await staffDo('set_request_status', { p_request_id: lid, p_to: 'pending_review', p_note: null })
await staffDo('set_request_status', { p_request_id: lid, p_to: 'under_investigation', p_note: null })
await staffDo('message_customer', { p_request_id: lid, p_body: 'Was it in the spa?', p_ask: true })
await staffDo('message_customer', { p_request_id: lid, p_body: 'Thanks, checking now.', p_ask: false })
await staffDo('set_request_status', { p_request_id: lid, p_to: 'awaiting_admin', p_note: null })
q = await outbox(L.reference)
check(q.map((x) => x.template).join() === 'received,under_review,contact_required,staff_message',
  'under review only once; a question and a message each queue one; internal steps queue nothing', q.map((x) => x.template).join())
check(new Set(q.map((x) => x.event_key)).size === q.length, 'each email is tied to its own event (no duplicates)')
await staffDo('set_request_status', { p_request_id: lid, p_to: 'rejected', p_note: 'No match' })
await staffDo('set_request_status', { p_request_id: lid, p_to: 'resolved', p_note: null })
q = await outbox(L.reference)
check(q.map((x) => x.template).slice(-2).join() === 'closed,resolved', 'rejected → "closed", resolved → "resolved"')

const F = await A((tx) => submitReport(tx, found()))
await staffDo('set_request_status', { p_request_id: await idOf(F.reference), p_to: 'resolved', p_note: 'Handed in' })
check((await outbox(F.reference)).map((x) => x.template).join() === 'received,resolved', 'found report: received, then resolved (never "matched")')
await asOwner(`insert into public.email_suppressions (email_hash, reason) values (encode(sha256(convert_to('bounced@example.com', 'UTF8')), 'hex'), 'bounce')`)
const B = await A((tx) => submitReport(tx, lost({ email: 'bounced@example.com', bookingRef: 'BK-2' })))
check((await outbox(B.reference))[0].status === 'suppressed', 'an address that bounced before is never mailed again')

console.log('\nPreview mode (staging default)')
const noSend = async () => { throw new Error('must not send') }
const logs = []
const p1 = await dispatch(ownerDb, { mode: 'preview', baseUrl: 'https://staging.example', from: { email: 'notifications@foundora.co.uk', name: 'Foundora' }, send: noSend, log: (m) => logs.push(m) })
const prev = (await outbox(L.reference))[0]
check(p1.previewed >= 8 && prev.status === 'previewed' && /Your hotel lost property enquiry LF-/.test(prev.subject), 'renders and keeps a copy, sends nothing', JSON.stringify(p1))
check(prev.body_text.includes('[your private tracking link]') && !/#t=[0-9a-f]{64}/.test(prev.body_text), 'the kept copy has the link blanked out')
check(!prev.body_text.includes('Ann Guest') && !prev.body_text.includes('BK-1') && !prev.body_text.includes('spa'),
  'no name, booking ID or staff message text in the email')
check(prev.sender === 'Demo Hotel via Foundora <notifications@foundora.co.uk>' || /via Foundora <notifications@foundora\.co\.uk>$/.test(prev.sender), 'sender: "<Hotel> via Foundora <notifications@…>"', prev.sender)

console.log('\nLive mode with a fake Brevo')
const sent = []
const okSend = async (m) => { sent.push(m); return { ok: true, messageId: `<m${sent.length}@brevo>` } }
const C = await A((tx) => submitReport(tx, lost({ email: 'carol@example.com', bookingRef: 'BK-3' })))
const D = await A((tx) => submitReport(tx, lost({ email: 'dave@other.example', bookingRef: 'BK-4' })))
const live = (send, extra = {}) => dispatch(ownerDb, { mode: 'live', baseUrl: 'https://staging.example', from: { email: 'notifications@foundora.co.uk', name: 'Foundora' }, send, log: () => {}, ...extra })
const r1 = await live(okSend, { allow: allowlistFrom('carol@example.com, @hotel.example') })
check(r1.sent === 1 && sent.length === 1 && sent[0].to === 'carol@example.com', 'only allowlisted addresses are sent on staging', JSON.stringify(r1))
check((await outbox(D.reference))[0].status === 'skipped', 'others are recorded as skipped, not sent')
const c0 = (await outbox(C.reference))[0]
check(c0.status === 'sent' && c0.provider_message_id === '<m1@brevo>' && c0.sent_at, 'sent: Brevo’s message id and time recorded')
const link = /https:\/\/staging\.example\/track\?ref=(LF-[0-9A-F-]+)#t=([0-9a-f]{64})/.exec(sent[0].text)
check(link && link[1] === C.reference, 'the email carries a tracking link with its own token')
check(link && (await A((tx) => reportStatus(tx, C.reference, link[2]))).reference === C.reference, 'that link opens the report')
check(!JSON.stringify(await rows(`select * from public.email_outbox`)).includes(link?.[2] ?? 'x'), 'the token is not stored anywhere in the log')
check(sent[0].html.includes(C.reference) && sent[0].html.includes('View your report') && sent[0].from.name.endsWith('via Foundora'), 'HTML version with the reference and button')
const again = await live(okSend, { allow: allowlistFrom('carol@example.com') })
check(again.sent === 0 && sent.length === 1, 'running again sends nothing twice')

console.log('\nFailures and retries')
const E = await A((tx) => submitReport(tx, lost({ email: 'erin@example.com', bookingRef: 'BK-5' })))
const busy = async () => ({ ok: false, permanent: false, code: 'http_503' })
await live(busy, { allow: allowlistFrom('erin@example.com') })
let e0 = (await outbox(E.reference))[0]
check(e0.status === 'retry' && e0.attempts === 1 && e0.last_error === 'http_503' && new Date(e0.next_attempt_at) > new Date(), 'a temporary failure is retried later (1 minute)')
await ownerDb.query(`update public.email_outbox set next_attempt_at = now(), attempts = 5 where id = $1`, [e0.id])
await live(busy, { allow: allowlistFrom('erin@example.com') })
e0 = (await outbox(E.reference))[0]
check(e0.status === 'failed' && e0.attempts === 6, 'after 6 attempts it is marked failed')
const G = await A((tx) => submitReport(tx, lost({ email: 'gary@example.com', bookingRef: 'BK-6' })))
const H = await A((tx) => submitReport(tx, lost({ email: 'gary2@example.com', bookingRef: 'BK-7' })))
const badKey = async () => ({ ok: false, permanent: true, code: 'http_401:unauthorized' })
const bk = await live(badKey, { allow: allowlistFrom('@example.com') })
const g0 = (await outbox(G.reference))[0], h0 = (await outbox(H.reference))[0]
check(bk.stopped && g0.status === 'retry' && h0.status === 'retry', 'a wrong API key stops the run and keeps every email for later', `${g0.status} ${h0.status}`)
const I = await A((tx) => submitReport(tx, lost({ email: 'ivy@example.com', bookingRef: 'BK-8' })))
await live(async () => ({ ok: false, permanent: true, code: 'http_400:invalid_parameter' }), { allow: allowlistFrom('ivy@example.com') })
check((await outbox(I.reference))[0].status === 'failed', 'a permanent error (bad address) fails without retrying')
await ownerDb.query(`update public.email_outbox set status = 'queued', created_at = now() - interval '2 days' where id = $1`, [g0.id])
await dispatch(ownerDb, { mode: 'off', baseUrl: 'https://x.example', from: { email: 'a@b.co', name: 'F' }, send: noSend, log: () => {} })
check((await outbox(G.reference))[0].status === 'expired', 'an email still waiting after a day expires instead of arriving late')
await ownerDb.query(`update public.email_outbox set status = 'sending', locked_until = now() - interval '1 minute' where id = $1`, [h0.id])
await dispatch(ownerDb, { mode: 'off', baseUrl: 'https://x.example', from: { email: 'a@b.co', name: 'F' }, send: noSend, log: () => {} })
check((await outbox(H.reference))[0].status === 'retry', 'an email left "sending" by a crashed run is retried')

if (real) {
  console.log('\nTwo runs at once (real Postgres)')
  const refs = []
  for (let i = 0; i < 6; i++) refs.push((await A((tx) => submitReport(tx, lost({ email: `par${i}@example.com`, bookingRef: `BK-P${i}` })))).reference)
  const other = await connectAs('app_owner')
  const got = []
  const slow = async (m) => { got.push(m.to); await new Promise((r) => setTimeout(r, 20)); return { ok: true, messageId: 'x' } }
  const opts = { mode: 'live', baseUrl: 'https://s.example', from: { email: 'n@f.co', name: 'F' }, allow: allowlistFrom('@example.com'), send: slow, log: () => {} }
  await Promise.all([dispatch(ownerDb, opts), dispatch(other, opts)])
  const par = got.filter((t) => t.startsWith('par'))
  check(par.length === 6 && new Set(par).size === 6, 'each email sent exactly once', String(par.length))
}

console.log('\nWho can read the email log')
const mine = await S(MGR, (tx) => loadEmailLog(tx, 200))
check(mine.length > 0 && mine.every((r) => r.reference), 'the hotel’s manager sees its log')
check((await S(OTHER, (tx) => loadEmailLog(tx, 200))).length === 0, 'another hotel’s manager sees none of it')
check((await S(HK, (tx) => loadEmailLog(tx, 200))).length === 0, 'housekeeping sees none of it')
check(await errOf(() => A((tx) => tx.query('select * from public.email_outbox'))) === '42501', 'guests (anon) cannot read it')
check(await errOf(() => S(MGR, (tx) => tx.query(`update public.email_outbox set status = 'sent'`))) === '42501', 'nobody in the app can change it')
check(await errOf(() => S(MGR, (tx) => tx.query('select * from public.request_access_tokens'))) === '42501', 'nobody in the app can read token hashes')

console.log('\nThe job itself')
check(/must log in as app_owner/.test(await errOf(() => runDispatch({ query: (s) => db.query(s) }, readConfig({ EMAIL_MODE: 'preview' })))),
  'refuses any login but app_owner')
check(readConfig({ EMAIL_MODE: 'live', BREVO_API_KEY: 'xsmtpsib-abc', EMAIL_FROM: 'notifications@foundora.co.uk', PUBLIC_BASE_URL: 'https://a.example', EMAIL_ALLOWLIST: 'a@b.co' })
  .problems.some((p) => /SMTP key/.test(p)), 'an SMTP key is refused with a clear message')
check(readConfig({ EMAIL_MODE: 'live', BREVO_API_KEY: 'xkeysib-abc', EMAIL_FROM: 'notifications@foundora.co.uk', PUBLIC_BASE_URL: 'https://a.example', RAILWAY_ENVIRONMENT_NAME: 'staging' })
  .problems.some((p) => /EMAIL_ALLOWLIST is required/.test(p)), 'live on staging refuses to start without an allowlist')
if (real) {
  const r = spawnSync(process.execPath, ['scripts/email-dispatch.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: urlFor('app_owner'), EMAIL_MODE: 'preview', PUBLIC_BASE_URL: 'https://staging.example' } })
  check(r.status === 0 && /✓ done/.test(r.stdout) && !r.stdout.includes('postgresql://'), 'node scripts/email-dispatch.mjs (preview) exits 0 without printing the URL', (r.stdout + r.stderr).slice(-300))
}
void friendly

if (real) await pool.end()
else await db.exec('reset role')
await close()
console.log(failures ? `\n${failures} FAILED` : '\nall email checks passed')
process.exit(failures ? 1 : 0)
