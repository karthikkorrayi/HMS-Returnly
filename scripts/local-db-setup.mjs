#!/usr/bin/env node
// Sets up a LOCAL development database the way Railway will be set up:
// the bootstrap (roles, schema auth) as a superuser, then every migration as
// app_owner with the real runner, then the DEMO seed (synthetic data only).
//
//   npm run db:local:setup                 # database returnly_dev
//   npm run db:local:setup -- --database returnly_dev2
//
// Safe to run again: it never drops or empties anything. On an existing
// database it re-applies the (idempotent) bootstrap, applies only migrations
// that are not applied yet, and re-runs the seed (which skips existing rows).
//
// Connects with LOCAL_PG_URL. Without it: the host and port of DATABASE_URL in
// .env.local (e.g. 5433 when another PostgreSQL already uses 5432), otherwise
// postgresql://localhost:5432/postgres — as your own user (Postgres.app makes
// that a superuser). Refuses anything
// that is not on this computer, so it can never touch a real database.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { migrate } from '../db/migrate.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

class SetupError extends Error {}

export async function setupLocalDb({ adminUrl, database, log = console.log }) {
  if (!/^returnly_[a-z0-9_]{1,40}$/.test(database)) {
    throw new SetupError(`Database name must look like returnly_dev (got "${database}").`)
  }
  const base = new URL(adminUrl)
  const socket = base.searchParams.get('host') ?? ''
  if (!LOCAL_HOSTS.has(base.hostname) && !socket.startsWith('/')) {
    throw new SetupError('LOCAL_PG_URL must point at Postgres on this computer (localhost).')
  }
  const urlAs = (user, db) => {
    const u = new URL(base)
    u.username = user ?? base.username
    u.password = user ? '' : base.password
    u.pathname = '/' + db
    return u.toString()
  }

  // 1. Server checks and the database itself --------------------------------------
  const admin = new pg.Client({ connectionString: urlAs(null, base.pathname.slice(1) || 'postgres') })
  await admin.connect()
  let created = false
  try {
    const me = (await admin.query(`select current_user as u, r.rolsuper as su, current_setting('server_version_num')::int as v
      from pg_roles r where r.rolname = current_user`)).rows[0]
    if (!me.su) throw new SetupError(`"${me.u}" is not a superuser; the bootstrap needs one (Postgres.app's default user is).`)
    if (me.v < 170000) throw new SetupError(`PostgreSQL 17 or newer is needed (Railway runs 18); port ${base.port || 5432} has an older server. Is another PostgreSQL (e.g. Homebrew) on that port? Set LOCAL_PG_URL=postgresql://localhost:<port>/postgres`)
    const exists = (await admin.query(`select 1 from pg_database where datname = $1`, [database])).rows.length > 0
    if (!exists) {
      await admin.query(`create database "${database}"`) // name checked against the pattern above
      created = true
    }
    log(`${created ? '✓ created' : '• using existing'} database ${database}`)
  } finally {
    await admin.end()
  }

  // 2. Bootstrap as superuser (idempotent) -----------------------------------------
  const su = new pg.Client({ connectionString: urlAs(null, database) })
  await su.connect()
  try {
    if (!created) {
      const foreign = (await su.query(`select count(*)::int as n from pg_tables
        where schemaname = 'public' and tableowner <> 'app_owner'`)).rows[0].n
      if (foreign > 0) throw new SetupError(`${database} has tables not owned by app_owner: it was not made by this script. Use another --database name.`)
    }
    await su.query(readFileSync(`${ROOT}db/bootstrap/000_platform.sql`, 'utf8'))
    log('✓ bootstrap (roles anon, authenticated, app_owner, app_user, auth_service; schema auth)')
  } finally {
    await su.end()
  }

  // 3. Migrations and seed as app_owner --------------------------------------------
  const owner = new pg.Client({ connectionString: urlAs('app_owner', database), application_name: 'returnly-local-setup' })
  await owner.connect()
  try {
    await migrate({ query: (s, p) => owner.query(s, p), exec: (s) => owner.query(s) }, { apply: true, log: (m) => log('  ' + m) })
    log('✓ migrations up to date')
    await owner.query(readFileSync(`${ROOT}supabase/seed.sql`, 'utf8'))
    const n = (await owner.query(`select count(*)::int as n from public.properties where inn_code = 'DEMO'`)).rows[0].n
    log(`✓ seed: DEMO hotel ${n === 1 ? 'present' : 'MISSING'} (synthetic data only)`)
  } finally {
    await owner.end()
  }

  return {
    created,
    urls: {
      DATABASE_URL: urlAs('app_user', database),
      MIGRATION_DATABASE_URL: urlAs('app_owner', database),
      AUTH_DATABASE_URL: urlAs('auth_service', database),
    },
  }
}

// The server to set up: LOCAL_PG_URL, else the host/port .env.local already uses.
export function defaultAdminUrl(envLocalText) {
  const line = (envLocalText ?? '').split('\n').find((l) => /^DATABASE_URL=/.test(l.trim()))
  if (line) {
    try {
      const u = new URL(line.trim().slice('DATABASE_URL='.length).replace(/^["']|["']$/g, ''))
      if (LOCAL_HOSTS.has(u.hostname)) return `postgresql://${u.hostname}:${u.port || 5432}/postgres`
    } catch {
      // not a URL: fall back to the default
    }
  }
  return 'postgresql://localhost:5432/postgres'
}

async function main(argv) {
  let values
  try {
    ;({ values } = parseArgs({ args: argv, options: { database: { type: 'string', default: 'returnly_dev' } } }))
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`)
    return 1
  }
  try {
    let envLocal = ''
    try { envLocal = readFileSync(`${ROOT}.env.local`, 'utf8') } catch { /* no .env.local yet */ }
    const adminUrl = process.env.LOCAL_PG_URL || defaultAdminUrl(envLocal)
    const shown = new URL(adminUrl)
    console.log(`• server: ${shown.hostname}:${shown.port || 5432}${process.env.LOCAL_PG_URL ? ' (LOCAL_PG_URL)' : ''}`)
    const { urls } = await setupLocalDb({
      adminUrl,
      database: values.database,
    })
    console.log('\nConnection strings for .env.local (local only, no passwords):')
    for (const [k, v] of Object.entries(urls)) console.log(`  ${k}=${v}`)
    console.log('')
    return 0
  } catch (e) {
    const hint = e.code === 'ECONNREFUSED' ? ' Is Postgres.app running (elephant icon in the menu bar)?' : ''
    console.error(`\n  ✗ ${e.message}${hint}\n`)
    return 1
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2))
}
