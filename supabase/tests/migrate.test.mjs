/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// The migration runner (db/migrate.mjs): refuses the wrong role or a missing
// bootstrap, plans without changing anything, applies db/migrations as
// app_owner, records checksums, refuses edited/missing/out-of-order history,
// rolls back a failing file, gates destructive SQL, and (real Postgres only)
// respects the lock and works from the command line without printing secrets.
import { openTestDb } from './test-db.mjs'
import { migrate, readMigrations, destructiveStatements, LOCK_KEY, DEFAULT_DIR } from '../../db/migrate.mjs'
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, connectAs, close } = await openTestDb('migrate')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const quiet = () => {}
const expectError = async (name, fn, match) => {
  try { await fn(); fail(`${name} → succeeded but should have failed`) } catch (e) {
    match.test(e.message) ? pass(`${name}`) : fail(`${name} → wrong error: ${e.message}`)
  }
}
const real = kind !== 'PGlite'
// A random throwaway value (never a literal in the code): the trust-auth test server
// ignores it, and the checks below prove the runner never prints it.
const DUMMY_PASSWORD = randomBytes(12).toString('hex')
const runCli = async () => {
  const url = new URL(process.env.TEST_DATABASE_URL)
  url.pathname = '/' + (await db.query('select current_database() as d')).rows[0].d
  url.username = 'app_owner'
  url.password = DUMMY_PASSWORD
  const r = spawnSync(process.execPath, [`${ROOT}/db/migrate.mjs`], {
    env: { ...process.env, MIGRATION_DATABASE_URL: url.toString() }, encoding: 'utf8',
  })
  return { status: r.status, out: r.stdout + r.stderr }
}
const temps = []
const variant = (edit) => {
  const dir = mkdtempSync(join(tmpdir(), 'returnly-migrations-'))
  temps.push(dir)
  cpSync(DEFAULT_DIR, dir, { recursive: true })
  edit(dir)
  return dir
}

// --- Pure checks -------------------------------------------------------------------
console.log('Destructive-statement detection')
destructiveStatements(`create function f() returns void language sql as $$ delete from t $$;`).length === 0
  ? pass('DELETE inside a function body is not flagged') : fail('function body flagged')
destructiveStatements(`-- drop table x\ncreate table y (id int);`).length === 0
  ? pass('commented-out DROP is not flagged') : fail('comment flagged')
const flagged = destructiveStatements(`drop table a; alter table b drop column c; truncate d; alter type e rename value 'x' to 'y';`)
flagged.length === 4 ? pass('DROP TABLE, DROP COLUMN, TRUNCATE and RENAME are flagged') : fail('flagged: ' + JSON.stringify(flagged))
readMigrations().every((f) => f.destructive.length === 0)
  ? pass('none of the current migrations is destructive') : fail('a current migration is flagged destructive')

// --- Connections ---------------------------------------------------------------------
// Make sure app_owner exists before the bootstrap so "bootstrap missing" can be tested.
await db.exec(`do $$ begin if not exists (select from pg_roles where rolname = 'app_owner') then
  create role app_owner login nosuperuser nobypassrls; end if; end $$;`)

const superDb = { query: (s, p) => db.query(s, p), exec: (s) => db.exec(s) }
let owner
if (real) {
  owner = await connectAs('app_owner')
} else {
  owner = { query: (s, p) => db.query(s, p), exec: (s) => db.exec(s) }
}
const asOwner = async (fn) => {
  if (!real) await db.exec('set role app_owner')
  try { return await fn() } finally { if (!real) await db.exec('reset role') }
}

console.log('\nRefusals before anything is applied')
await expectError('refuses to run as a superuser', () => migrate(superDb, { log: quiet }), /superuser/)
await asOwner(() => expectError('refuses when the bootstrap has not run', () => migrate(owner, { log: quiet }), /bootstrap/))

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
const ledgerExists = async () => (await db.query(`select to_regclass('ops.schema_migrations') is not null as ok`)).rows[0].ok
const ledgerCount = async () => (await db.query(`select count(*)::int n from ops.schema_migrations`)).rows[0].n

console.log('\nPlan, apply, re-apply')
const planned = await asOwner(() => migrate(owner, { log: quiet }))
planned.pending.length === 8 && planned.applied.length === 0 ? pass('plan lists 8 pending files') : fail('plan: ' + JSON.stringify(planned))
!(await ledgerExists()) ? pass('planning changed nothing (no ledger created)') : fail('plan created the ledger')

const first = await asOwner(() => migrate(owner, { apply: true, log: quiet }))
first.applied.length === 8 ? pass('applies all 8 migrations as app_owner (007 then 008 in separate transactions)') : fail('applied ' + first.applied.length)
const ledger = (await db.query(`select filename, sha256 from ops.schema_migrations order by filename`)).rows
const files = readMigrations()
ledger.length === 8 && ledger.every((r, i) => r.filename === files[i].name && r.sha256 === files[i].sha256)
  ? pass('ledger records every file with its SHA-256') : fail('ledger mismatch')
const owned = (await db.query(`select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner
  where c.oid = 'public.lost_items'::regclass or c.oid = 'ops.schema_migrations'::regclass`)).rows
owned.length === 2 && owned.every((r) => r.rolname === 'app_owner') ? pass('tables and ledger are owned by app_owner') : fail('owners: ' + JSON.stringify(owned))
const ledgerPriv = (await db.query(`select bool_or(has_schema_privilege(r, 'ops', 'usage')) as any
  from unnest(array['app_user','anon','authenticated']) r`)).rows[0].any
ledgerPriv === false ? pass('app_user, anon and authenticated cannot see the ledger') : fail('ledger schema is visible to app roles')

const again = await asOwner(() => migrate(owner, { apply: true, log: quiet }))
again.applied.length === 0 ? pass('re-running is a no-op') : fail('re-run applied ' + again.applied.length)
if (real) {
  const cli = await runCli()
  cli.status === 0 && /8 applied, 0 pending/.test(cli.out) && /up to date/.test(cli.out)
    ? pass('command line: plan reports up to date') : fail(`cli exit ${cli.status}: ${cli.out}`)
  !cli.out.includes(DUMMY_PASSWORD) ? pass('command line never prints the password') : fail('password printed')
}

console.log('\nHistory protection (nothing may change)')
const n0 = await ledgerCount()
const edited = variant((d) => writeFileSync(join(d, '20260929000003_workflow_functions.sql'),
  readFileSync(join(d, '20260929000003_workflow_functions.sql'), 'utf8') + '\n-- edited\n'))
await asOwner(() => expectError('refuses an applied file that was edited', () => migrate(owner, { files: readMigrations(edited), apply: true, log: quiet }), /edited after it was applied/))
const removed = variant((d) => unlinkSync(join(d, '20261006000005_stays_and_room_checks.sql')))
await asOwner(() => expectError('refuses when an applied file is missing', () => migrate(owner, { files: readMigrations(removed), apply: true, log: quiet }), /missing from the folder/))
const early = variant((d) => writeFileSync(join(d, '20260101000000_too_early.sql'), 'create table public.too_early (id int);\n'))
await asOwner(() => expectError('refuses a new file older than the newest applied one', () => migrate(owner, { files: readMigrations(early), apply: true, log: quiet }), /sorts before/))
const n1 = await ledgerCount()
const tooEarly = (await db.query(`select to_regclass('public.too_early') is null as gone`)).rows[0].gone
n1 === n0 && tooEarly ? pass('after the refusals the ledger and schema are unchanged') : fail('something changed during a refusal')

console.log('\nNew files, failures and destructive SQL')
const probe = variant((d) => writeFileSync(join(d, '20261101000009_probe.sql'),
  'create table public.runner_probe (id int primary key);\nalter table public.runner_probe enable row level security;\n'))
const added = await asOwner(() => migrate(owner, { files: readMigrations(probe), apply: true, log: quiet }))
added.applied.join() === '20261101000009_probe.sql' ? pass('applies only the new file') : fail('applied: ' + added.applied)

const broken = variant((d) => {
  writeFileSync(join(d, '20261101000009_probe.sql'), readFileSync(join(probe, '20261101000009_probe.sql'), 'utf8'))
  writeFileSync(join(d, '20261101000010_broken.sql'), 'create table public.half_done (id int);\nselect * from public.does_not_exist;\n')
})
await asOwner(() => expectError('a failing file reports the error', () => migrate(owner, { files: readMigrations(broken), apply: true, log: quiet }), /20261101000010_broken\.sql failed and was rolled back/))
const halfGone = (await db.query(`select to_regclass('public.half_done') is null as gone`)).rows[0].gone
halfGone && (await ledgerCount()) === n0 + 1 ? pass('…and its partial work is rolled back, not recorded') : fail('partial migration left behind')

const dropper = variant((d) => {
  writeFileSync(join(d, '20261101000009_probe.sql'), readFileSync(join(probe, '20261101000009_probe.sql'), 'utf8'))
  writeFileSync(join(d, '20261101000011_drop.sql'), 'drop table public.runner_probe;\n')
})
await asOwner(() => expectError('destructive file is refused without --allow-destructive', () => migrate(owner, { files: readMigrations(dropper), apply: true, log: quiet }), /--allow-destructive/))
const stillThere = (await db.query(`select to_regclass('public.runner_probe') is not null as ok`)).rows[0].ok
stillThere ? pass('…and nothing was dropped') : fail('table dropped without the flag')
const dropped = await asOwner(() => migrate(owner, { files: readMigrations(dropper), apply: true, allowDestructive: true, log: quiet }))
dropped.applied.join() === '20261101000011_drop.sql' ? pass('with --allow-destructive it is applied') : fail('drop not applied')

// --- Real Postgres only: lock and command line ----------------------------------------
console.log('\nLock and command line')
if (!real) {
  console.log('  skip (needs real Postgres: set TEST_DATABASE_URL)')
} else {
  const other = await connectAs('app_owner')
  await other.query(`select pg_advisory_lock($1)`, [LOCK_KEY])
  await expectError('a second run stops while another holds the lock', () => migrate(owner, { log: quiet }), /holds the lock/)
  await other.query(`select pg_advisory_unlock($1)`, [LOCK_KEY])
  await other.end()

  const cli = await runCli()
  cli.status === 1 && /missing from the folder/.test(cli.out) && /nothing changed/.test(cli.out)
    ? pass('command line: exits 1 and explains a history problem') : fail(`cli exit ${cli.status}: ${cli.out}`)
  !cli.out.includes(DUMMY_PASSWORD) ? pass('…without printing the password') : fail('password printed')
}
const noEnv = spawnSync(process.execPath, [`${ROOT}/db/migrate.mjs`], {
  env: { PATH: process.env.PATH }, encoding: 'utf8',
})
noEnv.status === 2 && /MIGRATION_DATABASE_URL is not set/.test(noEnv.stderr) ? pass('command line: clear error without MIGRATION_DATABASE_URL') : fail('no-env: ' + noEnv.status + noEnv.stderr)
const badOpt = spawnSync(process.execPath, [`${ROOT}/db/migrate.mjs`, '--force'], { encoding: 'utf8' })
badOpt.status === 2 && /unknown option --force/.test(badOpt.stderr) ? pass('command line: rejects unknown options') : fail('bad option: ' + badOpt.status)

if (real) await owner.end()
for (const d of temps) rmSync(d, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
