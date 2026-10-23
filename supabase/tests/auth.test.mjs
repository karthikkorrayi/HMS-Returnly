/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db  (needs real Postgres: TEST_DATABASE_URL; skipped on PGlite)
// Better Auth as configured in src/lib/better-auth against the Railway schema
// (bootstrap + db/migrations incl. 009). Re-checks the spike criteria that can
// regress (docs/AUTH_SPIKE_REPORT.md): S2 creation and no sign-up, S3 ids and
// RLS, S4 deactivation and reset, S5 rate limits, S8 no hashes, S9 cookies,
// S10 identical errors, S11 login cost, plus the cross-site check on POST.
// Step A3: the session lookup pages use (loadStaffSession) and create-staff.
// Step A4: managers add staff, set passwords and change access (staff-admin).
// Secrets are random per run and never printed.
import { openTestDb } from './test-db.mjs'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { migrate } from '../../db/migrate.mjs'
import { makeAuth } from '../../src/lib/better-auth/config.ts'
import { fromOurSite, crossSiteResponse } from '../../src/lib/better-auth/origin.ts'
import { createStaffLogin, resetStaffPassword, endStaffSessions } from '../../src/lib/better-auth/staff-logins.ts'
import { createAuthPool, assertAuthService, AuthPoolError } from '../../src/lib/db/auth-pool.ts'
import { createDb } from '../../src/lib/db/core.ts'
import { loadStaffSession } from '../../src/lib/staff-session.ts'
import { addStaffMember } from '../../src/lib/better-auth/add-staff.ts'
import { StaffLoginError } from '../../src/lib/better-auth/staff-logins.ts'
import { addStaff, setStaffPassword, setStaffActive, StaffAdminError } from '../../src/lib/staff-admin.ts'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, connectAs, urlFor, close } = await openTestDb('auth')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))

if (kind === 'PGlite') {
  console.log('  skip (Better Auth needs a real Postgres connection pool: set TEST_DATABASE_URL; CI runs this)')
  console.log('\nall checks passed')
  await close()
  process.exit(0)
}

// --- Schema exactly as Railway will have it ------------------------------------------
await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
const owner = await connectAs('app_owner')
await migrate({ query: owner.query, exec: owner.exec }, { apply: true, log: () => {} })
await owner.exec(readFileSync(`${ROOT}/supabase/seed.sql`, 'utf8'))
const DEMO = (await owner.query(`select id from public.properties where inn_code = 'DEMO'`)).rows[0].id
const staffRow = (id, username, role) => owner.query(`insert into public.staff (user_id, property_id, username, display_name, role, active)
  values ($1, $2, $3, $3, $4::public.staff_role, true)`, [id, DEMO, username, role])

const pools = []
const authPool = () => { const p = createAuthPool(urlFor('auth_service')); pools.push(p); return p }
const BASE = 'https://returnly.example'
const SECRET = randomBytes(24).toString('base64url')
const firstPool = authPool()
let auth = makeAuth({ database: firstPool, baseURL: BASE, secret: SECRET })
const appPool = new pg.Pool({ connectionString: urlFor('app_user'), max: 3 })
const app = createDb(appPool)

// Same gate as src/app/api/auth/[...all]/route.ts.
const call = async (path, { body, cookie, ip = '198.51.100.1', method = 'POST', headers = {} } = {}) => {
  // A header set to null in `headers` is left out entirely (e.g. no Origin).
  const h = Object.fromEntries(Object.entries({ 'content-type': 'application/json', origin: BASE, 'x-real-ip': ip, ...(cookie ? { cookie } : {}), ...headers })
    .filter(([, v]) => v !== null))
  const r = new Request(BASE + '/api/auth' + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (method === 'POST' && !fromOurSite(r, BASE)) return crossSiteResponse()
  return auth.handler(r)
}
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const session = async (cookie) => (await call('/get-session', { method: 'GET', cookie })).json()
const PW = randomBytes(18).toString('base64url')
const WRONG = randomBytes(18).toString('base64url')

console.log('Start-up checks')
try { await assertAuthService(firstPool); pass('auth pool logs in as auth_service with search_path auth') } catch (e) { fail('auth pool: ' + e.message) }
const wrongPool = createAuthPool(urlFor('app_user')); pools.push(wrongPool)
try { await assertAuthService(wrongPool); fail('a pool logged in as app_user was accepted') } catch (e) { check(e instanceof AuthPoolError, 'a pool logged in as anything else is refused (fails closed)') }

console.log('\nS2/S3  creating logins')
const anna = await createStaffLogin(auth, { username: 'hk.anna', password: PW, name: 'Anna (test)' })
check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(anna), 'new login id is a UUID')
await staffRow(anna, 'hk.anna', 'housekeeping')
pass('public.staff references it (foreign key to auth.users accepted)')
const ben = await createStaffLogin(auth, { username: 'fo-ben', password: PW, name: 'Ben (test)' })
await staffRow(ben, 'fo-ben', 'front_office')
pass('usernames with a dash work')
const before = (await owner.query(`select count(*)::int n from auth.users`)).rows[0].n
const signUp = await call('/sign-up/email', { body: { email: 'intruder@example.com', password: PW, name: 'x', username: 'intruder' } })
check(signUp.status >= 400, `public sign-up refused (${signUp.status})`)
let serverSignUp = 'allowed'
try { await auth.api.signUpEmail({ body: { email: 'intruder2@example.com', password: PW, name: 'x' } }) } catch { serverSignUp = 'refused' }
check(serverSignUp === 'refused', 'server-side sign-up refused too')
check((await owner.query(`select count(*)::int n from auth.users`)).rows[0].n === before, 'no login was created by either attempt')

console.log('\nS2/S8/S9  sign-in, cookies, no hashes')
const si = await call('/sign-in/username', { body: { username: 'hk.anna', password: PW } })
const siText = await si.clone().text()
check(si.status === 200, `sign-in with username works (${si.status})`)
const sess = (si.headers.getSetCookie?.() ?? []).find((c) => /session_token=/.test(c)) ?? ''
check(/^__Secure-/.test(sess) && /;\s*HttpOnly/i.test(sess) && /;\s*Secure/i.test(sess) && /;\s*SameSite=Lax/i.test(sess), 'session cookie: __Secure-, HttpOnly, Secure, SameSite=Lax')
const hash = (await owner.query(`select password from auth.account where user_id = $1`, [anna])).rows[0].password
check(hash && hash !== PW && hash.length > 40, 'stored password is a hash')
check(!siText.includes(hash) && !siText.includes(PW) && !/"password"/.test(siText), 'sign-in response has no password or hash')
const cookie = cookieOf(si)
const gs = await call('/get-session', { method: 'GET', cookie })
const gsText = await gs.text()
check(!gsText.includes(hash) && !/"password"/.test(gsText), 'session response has no password or hash')
const s = JSON.parse(gsText)
check(s?.user?.id === anna, 'session user id = auth.users id = staff.user_id')
const viaApp = await app.withStaff(s.user.id, async (tx) => (await tx.query(`select public.current_staff_role()::text r, auth.uid()::text u`)).rows[0])
check(viaApp.r === 'housekeeping' && viaApp.u === anna, 'withStaff(session.user.id) → row-level security sees the housekeeper')

console.log('\nCross-site sign-in')
const evil = await call('/sign-in/username', { body: { username: 'fo-ben', password: PW }, ip: '198.51.100.5', headers: { origin: 'https://evil.example' } })
check(evil.status === 403, `sign-in with another site's Origin → 403 (${evil.status})`)
const meta = await call('/sign-in/username', { body: { username: 'fo-ben', password: PW }, ip: '198.51.100.6', headers: { origin: null, 'sec-fetch-site': 'cross-site' } })
check(meta.status === 403, `browser-marked cross-site sign-in without Origin → 403 (${meta.status})`)
const noHeaders = await call('/sign-in/username', { body: { username: 'fo-ben', password: PW }, ip: '198.51.100.8', headers: { origin: null } })
check(noHeaders.status === 200, `a non-browser client (no Origin, no Sec-Fetch-Site) can still sign in (${noHeaders.status})`)
const libraryAlone = await auth.handler(new Request(BASE + '/api/auth/sign-in/username', { method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-real-ip': '198.51.100.7' }, body: JSON.stringify({ username: 'fo-ben', password: PW }) }))
console.log(`  note Better Auth alone answers ${libraryAlone.status} to a cross-site username sign-in` +
  (libraryAlone.status === 200 ? ' (known upstream gap; our route check covers it)' : ' (upstream may have fixed the gap; keep our check anyway)'))

console.log('\nS10  same answer for wrong password and unknown user')
const w = await call('/sign-in/username', { body: { username: 'hk.anna', password: WRONG }, ip: '198.51.100.21' })
const u = await call('/sign-in/username', { body: { username: 'nobody.here', password: WRONG }, ip: '198.51.100.22' })
const wb = await w.text(), ub = await u.text()
check(w.status === u.status && wb === ub, `identical status and message (${w.status}: ${wb.slice(0, 60)})`)

console.log('\nS5  rate limiting')
const codes = []
for (let i = 0; i < 6; i++) codes.push((await call('/sign-in/username', { body: { username: 'hk.anna', password: WRONG }, ip: '203.0.113.7' })).status)
check(codes.slice(0, 5).every((c) => c !== 429) && codes[5] === 429, `6th failed sign-in from one IP within a minute is blocked (${codes.join(',')})`)
const spoof = await call('/sign-in/username', { body: { username: 'hk.anna', password: WRONG }, ip: '203.0.113.7', headers: { 'x-forwarded-for': '192.0.2.99' } })
check(spoof.status === 429, 'changing X-Forwarded-For does not escape the limit (X-Real-IP is used)')
check((await call('/sign-in/username', { body: { username: 'hk.anna', password: PW }, ip: '203.0.113.8' })).status === 200, 'another IP is not blocked')
auth = makeAuth({ database: authPool(), baseURL: BASE, secret: SECRET })
check((await call('/sign-in/username', { body: { username: 'hk.anna', password: WRONG }, ip: '203.0.113.7' })).status === 429, 'the limit survives a restart (stored in auth.rate_limit)')

console.log('\nS4  deactivation and password reset')
const c2 = cookieOf(await call('/sign-in/username', { body: { username: 'hk.anna', password: PW }, ip: '198.51.100.40' }))
check((await session(c2))?.user?.id === anna, 'session works before deactivation')
await owner.query(`update public.staff set active = false where user_id = $1`, [anna])
await endStaffSessions(auth, anna)
check((await session(c2)) === null, 'after deactivation the same cookie has no session')
check((await owner.query(`select count(*)::int n from auth.session where user_id = $1`, [anna])).rows[0].n === 0, 'all of that user\'s sessions are deleted')
await owner.query(`update public.staff set active = true where user_id = $1`, [anna])
const c3 = cookieOf(await call('/sign-in/username', { body: { username: 'hk.anna', password: PW }, ip: '198.51.100.41' }))
const PW2 = randomBytes(18).toString('base64url')
await resetStaffPassword(auth, anna, PW2)
check((await session(c3)) === null, 'a password reset ends existing sessions')
check((await call('/sign-in/username', { body: { username: 'hk.anna', password: PW }, ip: '198.51.100.42' })).status !== 200, 'the old password no longer works')
check((await call('/sign-in/username', { body: { username: 'hk.anna', password: PW2 }, ip: '198.51.100.43' })).status === 200, 'the new password works')

console.log('\nS11  login cost')
for (let i = 0; i < 30; i++) await createStaffLogin(auth, { username: `load.${String(i).padStart(2, '0')}`, password: PW, name: `Load ${i}` })
const t0 = performance.now()
const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => call('/sign-in/username', { body: { username: `load.${String(i).padStart(2, '0')}`, password: PW }, ip: `10.9.0.${i + 1}` })))
const ms = performance.now() - t0
check(burst.every((r) => r.status === 200) && ms < 60_000, `30 simultaneous sign-ins all succeeded in ${(ms / 1000).toFixed(1)} s (target: 30 within 60 s)`)

console.log('\nA3  session lookup (what every staff page sees)')
const asStaff = (id) => app.withStaff(id, loadStaffSession)
const s1 = await asStaff(ben)
check(s1?.staff.username === 'fo-ben' && s1?.staff.role === 'front_office' && s1?.property.inn_code === 'DEMO',
  'an active staff member gets their own staff row and hotel', JSON.stringify(s1?.staff))
check(typeof s1?.property.retention_days === 'number', 'hotel settings come back as numbers')
await owner.query(`update public.staff set active = false where user_id = $1`, [ben])
check((await asStaff(ben)) === null, 'a deactivated staff member gets no session')
await owner.query(`update public.staff set active = true where user_id = $1`, [ben])
const loginOnly = await createStaffLogin(auth, { username: 'no.staff.row', password: PW, name: 'No row' })
check((await asStaff(loginOnly)) === null, 'a login without a staff row gets no session')

console.log('\nA3  create-staff (addStaffMember)')
const staffCount = async () => (await owner.query(`select (select count(*)::int from public.staff) s, (select count(*)::int from auth.users) u`)).rows[0]
const mgr = await addStaffMember(auth, owner, { property: 'demo', username: ' Demo.Manager ', name: 'Demo Manager', role: 'manager', password: PW })
check(mgr.propertyName === 'Demo Hotel', 'creates a manager at the DEMO hotel (code is case-insensitive)')
check((await call('/sign-in/username', { body: { username: 'demo.manager', password: PW }, ip: '198.51.100.60' })).status === 200, 'the new manager can sign in')
check((await asStaff(mgr.userId))?.staff.role === 'manager', 'and gets a manager session')
const sup = await addStaffMember(auth, owner, { property: 'DEMO', username: 'support.sam', name: 'Sam', role: 'support', password: PW })
check((await asStaff(sup.userId))?.staff.role === 'support', 'the support role can be created too')
const countBefore = await staffCount()
const rejects = async (input, re, msg) => {
  try { await addStaffMember(auth, owner, { property: 'DEMO', name: 'X', role: 'manager', password: PW, ...input }); fail(msg + ' (accepted)') }
  catch (e) { check(e instanceof StaffLoginError && re.test(e.message), msg, e.message) }
}
await rejects({ username: 'demo.manager' }, /already taken/, 'refuses a username that is already taken')
await rejects({ username: 'no.staff.row' }, /already taken/, 'refuses a username that already has a login')
await rejects({ username: 'new.person', property: 'NOPE' }, /No hotel/, 'refuses an unknown hotel code')
await rejects({ username: 'new.person', role: 'owner' }, /Role must be/, 'refuses an unknown role')
await rejects({ username: 'new.person', password: 'short' }, /Password must be/, 'refuses a short password')
await rejects({ username: 'Bad Name!' }, /Username must be/, 'refuses an invalid username')
const failingInsert = { query: (sql, params) => /insert into public\.staff/.test(sql) ? Promise.reject(new Error('simulated failure')) : owner.query(sql, params) }
try { await addStaffMember(auth, failingInsert, { property: 'DEMO', username: 'half.made', name: 'X', role: 'manager', password: PW }); fail('a failed staff row was ignored') }
catch (e) { check(/login was removed again/.test(e.message), 'if the staff row fails, the new login is removed again', e.message) }
check(JSON.stringify(await staffCount()) === JSON.stringify(countBefore), 'none of those left a login or staff row behind')
try { await addStaffMember(auth, { query: (s, p) => appPool.query(s, p) }, { property: 'DEMO', username: 'via.app.user', name: 'X', role: 'manager', password: PW }); fail('ran without app_owner') }
catch (e) { check(/must connect as app_owner/.test(e.message), 'refuses to run unless connected as app_owner', e.message) }

console.log('\nA4  managers manage staff (staff page)')
const W = app.withStaff
const logins = async () => (await owner.query(`select count(*)::int n from auth.users`)).rows[0].n
const a4rejects = async (p, re, msg) => {
  try { await p; fail(msg + ' (accepted)') } catch (e) { check(e instanceof StaffAdminError && re.test(e.message), msg, e.message) }
}
const OTHER = (await owner.query(`insert into public.properties (inn_code, name) values ('OTHR', 'Other Hotel') returning id`)).rows[0].id
const otherMgr = await addStaffMember(auth, owner, { property: 'OTHR', username: 'other.manager', name: 'Other Manager', role: 'manager', password: PW })
const otherHk = await addStaffMember(auth, owner, { property: 'OTHR', username: 'other.hk', name: 'Other HK', role: 'housekeeping', password: PW })
check(Boolean(OTHER), 'a second hotel exists for the cross-hotel checks')

const cara = await addStaff(auth, W, mgr.userId, { username: 'HK.Cara', displayName: ' Cara ', role: 'housekeeping', password: PW })
const caraSession = await asStaff(cara)
check(caraSession?.staff.username === 'hk.cara' && caraSession?.staff.role === 'housekeeping' && caraSession?.property.inn_code === 'DEMO',
  'a manager adds a housekeeper to their own hotel', JSON.stringify(caraSession?.staff))
const caraCookie = cookieOf(await call('/sign-in/username', { body: { username: 'hk.cara', password: PW }, ip: '198.51.100.70' }))
check((await session(caraCookie))?.user?.id === cara, 'the new person can sign in')

let n0 = await logins()
await a4rejects(addStaff(auth, W, mgr.userId, { username: 'hk.cara', displayName: 'X', role: 'housekeeping', password: PW }), /already taken/, 'refuses a username taken in the same hotel')
await a4rejects(addStaff(auth, W, mgr.userId, { username: 'other.hk', displayName: 'X', role: 'housekeeping', password: PW }), /already taken/, 'refuses a username taken in another hotel')
await a4rejects(addStaff(auth, W, ben, { username: 'sneaky.one', displayName: 'X', role: 'manager', password: PW }), /Only managers/, 'the database refuses a non-manager adding staff')
await a4rejects(addStaff(auth, W, mgr.userId, { username: 'x.y', displayName: 'X', role: 'owner', password: PW }), /Choose a role/, 'refuses an unknown role')
await a4rejects(addStaff(auth, W, mgr.userId, { username: 'x.y', displayName: 'X', role: 'support', password: 'short' }), /Password must be/, 'refuses a short password')
await a4rejects(addStaff(auth, W, mgr.userId, { username: 'No Spaces', displayName: 'X', role: 'support', password: PW }), /Username must be/, 'refuses an invalid username')
check((await logins()) === n0, 'none of the refused attempts left a login behind')

try { await W(mgr.userId, (tx) => tx.query(`insert into public.staff (user_id, property_id, username, display_name, role) values ($1, $2, 'direct.x', 'X', 'manager')`, [loginOnly, DEMO])); fail('a manager wrote public.staff directly') }
catch (e) { check(/row-level security/.test(e.message), 'even a manager cannot write public.staff directly (only through the functions)', e.message) }
const direct = await W(mgr.userId, (tx) => tx.query(`update public.staff set active = false where user_id = $1`, [cara]))
check(direct.rowCount === 0 && (await asStaff(cara)) !== null, 'a direct UPDATE of public.staff changes nothing')

console.log('\nA4  new password')
const PW3 = randomBytes(18).toString('base64url')
await setStaffPassword(auth, W, mgr.userId, cara, PW3)
check((await session(caraCookie)) === null, 'setting a new password signs that person out everywhere')
check((await call('/sign-in/username', { body: { username: 'hk.cara', password: PW3 }, ip: '198.51.100.71' })).status === 200, 'the new password works')
check((await call('/sign-in/username', { body: { username: 'hk.cara', password: PW }, ip: '198.51.100.72' })).status !== 200, 'the old one does not')
await a4rejects(setStaffPassword(auth, W, mgr.userId, otherHk.userId, PW3), /not found/, 'cannot set a password for staff of another hotel')
await a4rejects(setStaffPassword(auth, W, mgr.userId, mgr.userId, PW3), /own password/, 'cannot reset their own password from the staff page')
await a4rejects(setStaffPassword(auth, W, ben, cara, PW3), /Only managers/, 'a non-manager is refused (checked in the database)')
await a4rejects(setStaffPassword(auth, W, mgr.userId, 'not-a-uuid', PW3), /not found/, 'a malformed id is refused')

console.log('\nA4  deactivate / reactivate')
const caraCookie2 = cookieOf(await call('/sign-in/username', { body: { username: 'hk.cara', password: PW3 }, ip: '198.51.100.73' }))
await setStaffActive(auth, W, mgr.userId, cara, false)
check((await session(caraCookie2)) === null, 'deactivating ends their sessions at once')
check((await asStaff(cara)) === null, 'and they get no staff session afterwards')
await a4rejects(setStaffPassword(auth, W, mgr.userId, cara, PW3), /Reactivate/, 'no new password for a deactivated person')
await a4rejects(setStaffActive(auth, W, mgr.userId, mgr.userId, false), /own access/, 'the database refuses a manager deactivating themselves')
await a4rejects(setStaffActive(auth, W, mgr.userId, otherHk.userId, false), /not found/, 'cannot deactivate staff of another hotel')
check((await asStaff(otherHk.userId)) !== null, '(the other hotel’s staff member is still active)')
await a4rejects(setStaffActive(auth, W, ben, anna, false), /Only managers/, 'a non-manager is refused by the database')
await a4rejects(setStaffActive(auth, W, otherMgr.userId, cara, true), /not found/, 'another hotel’s manager cannot reactivate them')
await setStaffActive(auth, W, mgr.userId, cara, true)
check((await asStaff(cara))?.staff.active === true, 'reactivating restores access')

await appPool.end()
for (const p of pools) await p.end()
await owner.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
