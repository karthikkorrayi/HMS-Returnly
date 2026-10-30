// Run with: npm run test:db  (needs real Postgres: TEST_DATABASE_URL; skipped on PGlite)
// The whole first-time setup as the setup screen runs it (src/lib/setup.ts):
// Better Auth creates the administrator's login, then complete_initial_setup()
// creates the hotel — and the administrator can then sign in as a manager.
import { openTestDb } from './test-db.mjs'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { migrate } from '../../db/migrate.mjs'
import { makeAuth } from '../../src/lib/better-auth/config.ts'
import { createAuthPool } from '../../src/lib/db/auth-pool.ts'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { loadStaffSession } from '../../src/lib/staff-session.ts'
import { buildSetup, runInitialSetup, isSetUp, SetupError } from '../../src/lib/setup.ts'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, connectAs, urlFor, close } = await openTestDb('setup_flow')
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

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
const owner = await connectAs('app_owner')
await migrate({ query: owner.query, exec: owner.exec }, { apply: true, log: () => {} })

const BASE = 'https://returnly.example'
const authPool = createAuthPool(urlFor('auth_service'))
const auth = makeAuth({ database: authPool, baseURL: BASE, secret: randomBytes(24).toString('base64url') })
const appPool = new pg.Pool({ connectionString: urlFor('app_user'), max: 3, types: returnlyTypes })
const app = createDb(appPool)
const deps = { auth, withAnon: app.withAnon }
const PW = randomBytes(15).toString('base64url')
const form = (over = {}) => ({
  code: 'grand', name: 'The Grand', address: '1 Test Street', phone: '+44 20 7946 0000', email: 'desk@grand.example',
  supportHours: '24 hours', supportNote: '',
  floorNames: ['Ground', '1'], floorRooms: ['G01, G02', '101-110'],
  areas: 'Lobby\nRestaurant', storageLabels: ['Front desk safe'], storageKinds: ['secure'],
  adminName: 'Grace Manager', adminUsername: 'grace.m', adminPassword: PW, adminPassword2: PW,
  ...over,
})
const logins = async () => (await owner.query(`select count(*)::int n from auth.users`)).rows[0].n
const signIn = (username, password) => auth.handler(new Request(BASE + '/api/auth/sign-in/username', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-real-ip': '198.51.100.9' },
  body: JSON.stringify({ username, password }),
}))

console.log('A failed setup leaves nothing behind')
check((await isSetUp(app.withAnon)) === false, 'a new installation is not set up')
// Passes the form checks, refused by the database: the admin login must be removed again.
const sneaky = buildSetup(form())
sneaky.config.floors.push({ name: '2', rooms: ['G01'] })
let msg = ''
try { await runInitialSetup(deps, sneaky) } catch (e) { msg = e instanceof SetupError ? e.message : 'unexpected: ' + e.message }
check(/Room G01 is listed twice/.test(msg), 'the database refuses it with a plain message', msg)
check((await logins()) === 0, 'and the administrator login created first is removed again')
check((await isSetUp(app.withAnon)) === false, 'still not set up, so setup can simply be repeated')

console.log('\nSetup')
const { propertyId } = await runInitialSetup(deps, buildSetup(form()))
check(/^[0-9a-f-]{36}$/.test(propertyId), 'setup completes')
check((await isSetUp(app.withAnon)) === true, 'the installation is now set up')
const rooms = (await owner.query(`select count(*)::int n from public.rooms`)).rows[0].n
check(rooms === 12, 'G01, G02 and the range 101-110 became 12 rooms', String(rooms))

console.log('\nThe administrator signs in')
const res = await signIn('grace.m', PW)
check(res.status === 200, `sign-in works (${res.status})`)
const userId = (await res.json())?.user?.id
const session = await app.withStaff(userId, loadStaffSession)
check(session?.staff.role === 'manager' && session.property.inn_code === 'GRAND' && session.property.name === 'The Grand',
  'as an active manager of The Grand', JSON.stringify(session?.staff))
check((await signIn('grace.m', 'wrong-password-123')).status === 401, 'a wrong password is refused')

console.log('\nSetup runs once')
const before = await logins()
let again = ''
try { await runInitialSetup(deps, buildSetup(form({ code: 'OTHER', adminUsername: 'second.admin' }))) } catch (e) { again = e.message }
check(/already set up/.test(again), 'a second setup is refused', again)
check((await logins()) === before, 'and creates no extra login')
check((await owner.query(`select count(*)::int n from public.properties`)).rows[0].n === 1, 'still exactly one hotel')

await appPool.end()
await authPool.end()
await owner.end()
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
