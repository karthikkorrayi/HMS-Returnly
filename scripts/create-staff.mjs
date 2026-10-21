#!/usr/bin/env node
// Creates a staff login (Better Auth) and its staff row from the command line.
// Use it to create the first manager of a hotel; after that, managers add
// staff in the app (step A4).
//
//   npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager
//
// Reads from .env.local (never printed):
//   AUTH_DATABASE_URL       logs in as auth_service (creates the login)
//   MIGRATION_DATABASE_URL  logs in as app_owner    (adds the staff row)
//   BETTER_AUTH_URL, BETTER_AUTH_SECRET
// Prompts for the password twice; it is never shown, logged or stored in clear.
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { makeAuth } from '../src/lib/better-auth/config.ts'
import { addStaffMember, STAFF_ROLES } from '../src/lib/better-auth/add-staff.ts'
import { StaffLoginError } from '../src/lib/better-auth/staff-logins.ts'
import { assertAuthService, createAuthPool } from '../src/lib/db/auth-pool.ts'

const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

let values
try {
  ;({ values } = parseArgs({
    options: {
      property: { type: 'string' },
      username: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'manager' },
    },
  }))
} catch (e) {
  fail(e.message)
}
if (!values.property) fail('--property is required (the hotel code, e.g. DEMO)')
if (!values.username) fail('--username is required')
if (!values.name?.trim()) fail('--name is required')
if (!STAFF_ROLES.includes(values.role)) fail(`--role must be one of: ${STAFF_ROLES.join(', ')}`)

const missing = ['AUTH_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'].filter((k) => !process.env[k])
if (missing.length) fail(`Set ${missing.join(', ')} in .env.local`)

// Reads both answers from one line reader (so piped input works too); typed
// characters are not echoed.
async function askPasswordTwice() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false })
  rl._writeToOutput = () => {}
  const lines = []
  const waiting = []
  rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)))
  rl.on('close', () => waiting.splice(0).forEach((w) => w('')))
  const ask = (q) => {
    process.stdout.write(q)
    return new Promise((resolve) => (lines.length ? resolve(lines.shift()) : waiting.push(resolve))).then((a) => {
      process.stdout.write('\n')
      return a
    })
  }
  try {
    return [await ask('Password (10–128 characters): '), await ask('Type it again: ')]
  } finally {
    rl.close()
  }
}

const [password, again] = await askPasswordTwice()
if (password !== again) fail('The two passwords do not match. Nothing was created.')

const authPool = createAuthPool(process.env.AUTH_DATABASE_URL, 2)
const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, application_name: 'returnly-create-staff' })
try {
  await assertAuthService(authPool)
  await owner.connect()
  const auth = makeAuth({
    database: authPool,
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
  })
  const { propertyName } = await addStaffMember(auth, owner, {
    property: values.property,
    username: values.username,
    name: values.name,
    role: values.role,
    password,
  })
  console.log(`\n  ✓ Created ${values.role} "${values.username.trim().toLowerCase()}" at ${propertyName}. Sign in with that username.\n`)
} catch (e) {
  if (e instanceof StaffLoginError || e?.name === 'AuthPoolError') fail(e.message)
  fail(`Could not create the staff member: ${e?.message ?? e}`)
} finally {
  await owner.end().catch(() => {})
  await authPool.end().catch(() => {})
}
