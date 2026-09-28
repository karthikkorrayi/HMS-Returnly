#!/usr/bin/env node
// Creates a staff login from the command line — use it once to create the
// first manager; after that, managers add staff in the app.
//
//   npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and optional
// STAFF_EMAIL_DOMAIN from .env.local. Prompts for the password.

import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    property: { type: 'string' },
    username: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'manager' },
  },
})

const fail = (msg) => {
  console.error(`\n  ${msg}\n`)
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const domain = process.env.STAFF_EMAIL_DOMAIN || 'staff.invalid'
if (!url || !key) fail('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')

const username = (values.username ?? '').trim().toLowerCase()
if (!values.property) fail('--property is required (the inn_code, e.g. DEMO)')
if (!/^[a-z0-9._-]{3,32}$/.test(username)) fail('--username: 3–32 chars, lowercase letters, numbers, . _ -')
if (!values.name?.trim()) fail('--name is required')
if (!['housekeeping', 'front_office', 'manager'].includes(values.role)) fail('--role must be housekeeping, front_office or manager')

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const password = await askHidden('Password (min 10 characters): ')
if (password.length < 10) fail('Password must be at least 10 characters.')

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: property, error: propError } = await supabase
  .from('properties')
  .select('id, name')
  .eq('inn_code', values.property.toUpperCase())
  .single()
if (propError || !property) fail(`No property with inn_code ${values.property}. Did you run the seed?`)

const { data: created, error: authError } = await supabase.auth.admin.createUser({
  email: `${username}@${domain}`,
  password,
  email_confirm: true,
  user_metadata: { username },
})
if (authError) fail(`Could not create login: ${authError.message}`)

const { error: staffError } = await supabase.from('staff').insert({
  user_id: created.user.id,
  property_id: property.id,
  username,
  display_name: values.name.trim(),
  role: values.role,
})
if (staffError) {
  await supabase.auth.admin.deleteUser(created.user.id)
  fail(`Could not add staff row: ${staffError.message}`)
}

console.log(`\n  Created ${values.role} "${username}" at ${property.name}. Sign in with that username.\n`)
