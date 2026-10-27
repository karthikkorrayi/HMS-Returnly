#!/usr/bin/env node
// HMS Returnly — migration runner for plain Postgres (Railway).
//
//   node db/migrate.mjs            show the plan (default; changes nothing)
//   node db/migrate.mjs --apply    apply pending migrations
//   node db/migrate.mjs --apply --allow-destructive
//                                  also allow files that DROP/TRUNCATE/DELETE/RENAME
//
// Connects with MIGRATION_DATABASE_URL, which must log in as app_owner (never a
// superuser) after db/bootstrap/000_platform.sql has been run once.
//
// Rules:
//   * files in db/migrations run in filename order, each in its own transaction
//     together with its ledger row (so 007's new enum value is committed before
//     008 uses it);
//   * the ledger ops.schema_migrations stores each file's SHA-256: an applied
//     file that was edited, removed, or a new file older than the newest applied
//     one stops everything before any change;
//   * an advisory lock stops two deploys migrating at the same time;
//   * statement-level DROP / TRUNCATE / DELETE / RENAME need --allow-destructive.
// Never prints the connection password.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const LOCK_KEY = 482_207_311 // arbitrary constant shared by every runner
export const DEFAULT_DIR = fileURLToPath(new URL('./migrations/', import.meta.url))

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export class MigrationError extends Error {}

// Statement-level destructive SQL, ignoring comments and function bodies ($$...$$).
export function destructiveStatements(sql) {
  const stripped = sql
    .replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  const re = /\b(drop\s+(table|column|schema|type|view|materialized\s+view|function|trigger|policy|index|sequence|extension)|truncate|delete\s+from|alter\s+table[^;]*\b(drop|rename)\b|alter\s+\w+[^;]*\brename\b)[^;]*/gi
  return [...stripped.matchAll(re)].map((m) => m[0].replace(/\s+/g, ' ').trim().slice(0, 120))
}

export function readMigrations(dir = DEFAULT_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8')
      return { name, sql, sha256: sha256(sql), destructive: destructiveStatements(sql) }
    })
}

// db: { query(sql, params) → { rows }, exec(sql) } connected as app_owner.
export async function plan(db, files) {
  const who = (await db.query(`select current_user as u, r.rolsuper as su, r.rolbypassrls as br
    from pg_roles r where r.rolname = current_user`)).rows[0]
  if (who.su || who.br) throw new MigrationError(`refusing to migrate as "${who.u}": it is a superuser or BYPASSRLS. Connect as app_owner.`)
  if (who.u !== 'app_owner') throw new MigrationError(`refusing to migrate as "${who.u}": connect as app_owner.`)
  const boot = (await db.query(`select to_regprocedure('auth.uid()') is not null as ok`)).rows[0]
  if (!boot.ok) throw new MigrationError('auth.uid() is missing: run db/bootstrap/000_platform.sql as a superuser first.')

  const hasLedger = (await db.query(`select to_regclass('ops.schema_migrations') is not null as ok`)).rows[0].ok
  const applied = hasLedger
    ? (await db.query(`select filename, sha256, applied_at from ops.schema_migrations order by filename`)).rows
    : []
  const onDisk = new Map(files.map((f) => [f.name, f]))
  const problems = []
  for (const a of applied) {
    const f = onDisk.get(a.filename)
    if (!f) problems.push(`${a.filename} was applied but is missing from the folder`)
    else if (f.sha256 !== a.sha256) problems.push(`${a.filename} was edited after it was applied (checksum differs)`)
  }
  const appliedNames = new Set(applied.map((a) => a.filename))
  const newestApplied = applied.length ? applied[applied.length - 1].filename : ''
  const pending = files.filter((f) => !appliedNames.has(f.name))
  for (const p of pending) {
    if (p.name < newestApplied) problems.push(`${p.name} is new but sorts before ${newestApplied}, which is already applied`)
  }
  return { user: who.u, hasLedger, applied, pending, problems }
}

export async function migrate(db, { files = readMigrations(), apply = false, allowDestructive = false, log = console.log } = {}) {
  const got = (await db.query(`select pg_try_advisory_lock($1) as ok`, [LOCK_KEY])).rows[0].ok
  if (!got) throw new MigrationError('another migration run holds the lock; try again when it has finished.')
  try {
    const p = await plan(db, files)
    log(`connected as ${p.user}; ${p.applied.length} applied, ${p.pending.length} pending`)
    for (const f of p.pending) log(`  pending  ${f.name}${f.destructive.length ? '  [DESTRUCTIVE: ' + f.destructive.join(' | ') + ']' : ''}`)
    if (p.problems.length) throw new MigrationError('history problem, nothing changed:\n  - ' + p.problems.join('\n  - '))
    const destructive = p.pending.filter((f) => f.destructive.length)
    if (destructive.length && !allowDestructive) {
      throw new MigrationError(`${destructive.map((f) => f.name).join(', ')} contain destructive statements; review them and re-run with --allow-destructive. Nothing changed.`)
    }
    if (!apply) {
      log(p.pending.length ? 'plan only: re-run with --apply to apply the pending files' : 'up to date')
      return { applied: [], pending: p.pending.map((f) => f.name) }
    }

    if (!p.hasLedger) {
      await db.exec(`
        create schema if not exists ops;
        revoke all on schema ops from public;
        create table if not exists ops.schema_migrations (
          filename    text primary key,
          sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
          applied_at  timestamptz not null default now(),
          applied_by  text not null default current_user,
          duration_ms integer not null
        );
        revoke all on ops.schema_migrations from public;`)
    }
    const done = []
    for (const f of p.pending) {
      const t0 = Date.now()
      try {
        await db.exec('begin')
        await db.exec(`set local lock_timeout = '10s'`)
        await db.exec(f.sql)
        await db.query(`insert into ops.schema_migrations (filename, sha256, duration_ms) values ($1, $2, $3)`,
          [f.name, f.sha256, Date.now() - t0])
        await db.exec('commit')
      } catch (e) {
        await db.exec('rollback').catch(() => {})
        throw new MigrationError(`${f.name} failed and was rolled back (${done.length} applied before it): ${e.message}`)
      }
      log(`  applied  ${f.name}  (${Date.now() - t0} ms)`)
      done.push(f.name)
    }
    log(done.length ? `done: ${done.length} applied` : 'up to date')
    return { applied: done, pending: [] }
  } finally {
    await db.query(`select pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {})
  }
}

// --- command line ---------------------------------------------------------------
async function main(argv) {
  const known = new Set(['--apply', '--allow-destructive'])
  const bad = argv.filter((a) => !known.has(a))
  if (bad.length) {
    console.error(`unknown option ${bad.join(' ')}\nusage: node db/migrate.mjs [--apply] [--allow-destructive]`)
    return 2
  }
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is not set (it must log in as app_owner).')
    return 2
  }
  // Never echo the URL itself: it contains the password. (Node's own "Invalid
  // URL" error prints the whole input, so it must not reach the log.)
  let u
  try {
    u = new URL(url)
  } catch {
    console.error('MIGRATION_DATABASE_URL is not a valid postgresql:// URL (value not shown). On Railway: check its ${{...}} references.')
    return 2
  }
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.hostname) {
    console.error('MIGRATION_DATABASE_URL has no host name or is not postgresql:// (value not shown). On Railway: a ${{Service.VARIABLE}} reference is probably empty (service name?).')
    return 2
  }
  console.log(`database ${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname} as ${decodeURIComponent(u.username) || '(default user)'}`)
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: url, application_name: 'returnly-migrate' })
  try {
    await client.connect()
  } catch (e) {
    console.error(`✗ could not connect to the database (${e.code || 'error'}): ${String(e.message).split('\n')[0].replaceAll(url, '[url]')}`)
    return 1
  }
  try {
    await migrate({ query: (s, p) => client.query(s, p), exec: (s) => client.query(s) }, {
      apply: argv.includes('--apply'),
      allowDestructive: argv.includes('--allow-destructive'),
    })
    return 0
  } catch (e) {
    console.error(e instanceof MigrationError ? `✗ ${e.message}` : e)
    return 1
  } finally {
    await client.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2))
}
