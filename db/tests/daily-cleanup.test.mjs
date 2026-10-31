// Run with: npm run test:db
// Phase 6: the daily clean-up (migration 014, scripts/daily-cleanup.mjs,
// src/lib/daily-cleanup.ts). Checks it removes exactly what has expired and
// nothing else, records every run (also a failed one, whose changes are
// undone), can only be run as app_owner, and that only managers see when it
// last ran. Both test databases; the command line itself on real Postgres.
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { loadLastCleanup } from '../../src/lib/daily-cleanup.ts'
import { runCleanup } from '../../scripts/daily-cleanup.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, urlFor, connectAs, close } = await openTestDb('daily_cleanup')
console.log('database: ' + kind)
const real = kind !== 'PGlite'
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))
const asOwner = (sql) => db.exec(`set role app_owner;\n${sql}\n;reset role;`)
const count = async (sql) => (await db.query(`select count(*)::int n from ${sql}`)).rows[0].n
const errCode = async (fn) => { try { await fn(); return 'none' } catch (e) { return e.code ?? e.message } }

await db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
for (const f of readdirSync(`${ROOT}/db/migrations`).sort()) {
  await asOwner(readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8'))
}
await asOwner(readFileSync(`${ROOT}/db/seed.sql`, 'utf8'))

const MGR = randomUUID(), HK = randomUUID()
const old = randomUUID(), live = randomUUID()
await asOwner(`
  insert into auth.users (id) values ('${MGR}'), ('${HK}');
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${MGR}', id, 'mgr.clean', 'Mo', 'manager' from public.properties where inn_code = 'DEMO';
  insert into public.staff (user_id, property_id, username, display_name, role)
    select '${HK}', id, 'hk.clean', 'Hana', 'housekeeping' from public.properties where inn_code = 'DEMO';
  delete from public.stays;
  delete from public.customer_requests;`)

// Made-up records: for each kind, one that has expired and one that has not.
const fixtures = `
  insert into public.stays (property_id, room_number, reservation_ref, check_in_date, check_out_date, status, checked_out_at)
    select p.id, r.room_number, x.ref, current_date - x.age - 2, current_date - x.age, x.status::public.stay_status,
           case when x.status = 'departed' then now() end
      from public.properties p
      join lateral (select room_number from public.rooms where property_id = p.id order by room_number limit 1) r on true
      cross join (values ('OLD-STAY', 800, 'departed'), ('NEW-STAY', 2, 'departed'), ('OLD-INHOUSE', 800, 'in_house')) x(ref, age, status)
     where p.inn_code = 'DEMO';
  insert into public.customer_requests (property_id, reference, customer_name, booking_ref, item_name, description, status, updated_at)
    select p.id, x.ref, 'Test Guest', 'BOOK-1', 'Blue scarf', 'A blue wool scarf', x.status::public.request_status, now() - x.age * interval '1 day'
      from public.properties p
      cross join (values ('RQ-OLD-DONE', 2000, 'resolved'), ('RQ-NEW-DONE', 1, 'resolved'), ('RQ-OLD-OPEN', 2000, 'pending_review')) x(ref, age, status)
     where p.inn_code = 'DEMO';
  insert into auth.session (id, user_id, token, expires_at) values
    ('${old}', '${MGR}', 'tok-old-' || gen_random_uuid(), now() - interval '1 hour'),
    ('${live}', '${MGR}', 'tok-new-' || gen_random_uuid(), now() + interval '6 days');
  insert into auth.verification (id, identifier, value, expires_at) values
    (gen_random_uuid(), 'old', 'x', now() - interval '1 minute'),
    (gen_random_uuid(), 'new', 'x', now() + interval '1 hour');
  insert into auth.rate_limit (id, key, count, last_request) values
    (gen_random_uuid(), 'old-' || gen_random_uuid(), 3, (extract(epoch from now() - interval '2 days') * 1000)::bigint),
    (gen_random_uuid(), 'new-' || gen_random_uuid(), 3, (extract(epoch from now()) * 1000)::bigint);
  insert into auth.sign_in_failures (username, failures, first_failed_at, locked_until) values
    ('old.unlocked', 3, now() - interval '2 days', null),
    ('old.lock.over', 10, now() - interval '2 days', now() - interval '1 day'),
    ('old.still.locked', 10, now() - interval '2 days', now() + interval '1 hour'),
    ('recent', 2, now() - interval '5 minutes', null);`
await asOwner(fixtures)

const owner = { query: async (sql, p) => { await db.exec('set role app_owner'); try { return await db.query(sql, p) } finally { await db.exec('reset role') } } }

console.log('\nOnly the owner can run it')
for (const role of ['authenticated', 'anon', 'app_user']) {
  const code = await errCode(() => db.exec(`set role ${role}; select public.run_daily_cleanup(); reset role;`))
  await db.exec('reset role').catch(() => {})
  check(code === '42501', `${role} may not run run_daily_cleanup()`, code)
}
check((await errCode(() => runCleanup(db, () => {}))).includes('must log in as app_owner'), 'the script refuses a superuser login')
if (real) {
  const appUser = await connectAs('app_user')
  check((await errCode(() => runCleanup(appUser, () => {}))).includes('connected as app_user'), 'the script refuses the web app’s login (app_user)')
}

console.log('\nFirst run removes exactly what has expired')
await asOwner(`insert into public.lost_items (property_id, found_area_type, room_number, found_at, found_by, category, description)
  select p.id, 'room', (select room_number from public.rooms where property_id = p.id order by 1 limit 1),
         now() - interval '5 years', '${MGR}', 'other', 'Old umbrella' from public.properties p where p.inn_code = 'DEMO';`)
const itemsBefore = await count('public.lost_items')
const logs = []
const first = await runCleanup(owner, (m) => logs.push(m))
check(first.stays === 1 && first.closed_enquiries === 1 && first.sessions === 1 && first.verifications === 1 &&
  first.rate_limits === 1 && first.sign_in_failures === 2, 'counts: 1 stay, 1 enquiry, 1 session, 1 verification, 1 rate limit, 2 failure counts', JSON.stringify(first))
check(/removed: stays 1, closed enquiries 1/.test(logs[0] ?? ''), 'the log names what was removed', logs[0])
const stays = (await db.query(`select reservation_ref from public.stays order by 1`)).rows.map((r) => r.reservation_ref).join(',')
check(stays === 'NEW-STAY,OLD-INHOUSE', 'kept: the recent stay and the guest still in house', stays)
const reqs = (await db.query(`select reference from public.customer_requests order by 1`)).rows.map((r) => r.reference).join(',')
check(reqs === 'RQ-NEW-DONE,RQ-OLD-OPEN', 'kept: the recently closed enquiry and the open one', reqs)
check((await db.query(`select id from auth.session`)).rows.map((r) => r.id).join() === live, 'kept: the session that is still valid')
const fails = (await db.query(`select username from auth.sign_in_failures order by 1`)).rows.map((r) => r.username).join(',')
check(fails === 'old.still.locked,recent', 'kept: a lock still running and today’s wrong passwords', fails)
check(await count('public.lost_items') === itemsBefore, 'lost items are untouched (even one five years past its retention)')

console.log('\nRuns are recorded; a second run finds nothing')
const second = await runCleanup(owner, () => {})
check(Object.values(second).every((n) => n === 0), 'second run removes nothing', JSON.stringify(second))
const runs = (await db.query(`select ok, finished_at is not null as done, summary from ops.job_runs order by id`)).rows
check(runs.length === 2 && runs.every((r) => r.ok && r.done) && runs[0].summary.stays === 1, 'two successful runs in ops.job_runs', JSON.stringify(runs))

console.log('\nA failed run is recorded and changes nothing')
await asOwner(`insert into public.stays (property_id, room_number, reservation_ref, check_in_date, check_out_date, status, checked_out_at)
  select property_id, room_number, 'OLD-STAY-2', current_date - 900, current_date - 899, 'departed', now() from public.stays where reservation_ref = 'NEW-STAY';
  insert into auth.session (id, user_id, token, expires_at) values (gen_random_uuid(), '${MGR}', 'tok-x-' || gen_random_uuid(), now() - interval '1 hour');
  create function public._test_break() returns trigger language plpgsql as $$ begin raise exception 'broken on purpose'; end $$;
  create trigger _test_break before delete on auth.session for each row execute function public._test_break();`)
const broken = await errCode(() => runCleanup(owner, () => {}))
check(/failed in the database \(error P0001\)/.test(broken), 'the script reports the failure (exit 1)', broken)
check(await count(`public.stays where reservation_ref = 'OLD-STAY-2'`) === 1, 'the stay removed earlier in that run is back (all undone)')
const lastRun = (await db.query(`select ok, summary from ops.job_runs order by id desc limit 1`)).rows[0]
check(lastRun.ok === false && lastRun.summary.error === 'P0001', 'the failed run is kept with its error code', JSON.stringify(lastRun))
await asOwner(`drop trigger _test_break on auth.session; drop function public._test_break();`)
const third = await runCleanup(owner, () => {})
check(third.stays === 1 && third.sessions === 1, 'the next run does the work', JSON.stringify(third))

console.log('\nWho can see the runs')
let pool
if (real) {
  const pg = (await import('pg')).default
  pool = new pg.Pool({ connectionString: urlFor('app_user'), max: 2, types: returnlyTypes })
} else {
  await db.exec('set role app_user')
  const client = { query: (q, p) => db.query(q, p).then((r) => ({ ...r, rowCount: r.affectedRows ?? r.rows.length })), release: () => {} }
  pool = { connect: async () => client }
}
const app = createDb(pool)
const seen = await app.withStaff(MGR, loadLastCleanup)
check(seen instanceof Date && Date.now() - seen.getTime() < 600_000, 'a manager sees when it last succeeded', String(seen))
check(await errCode(() => app.withStaff(HK, loadLastCleanup)) === '42501', 'housekeeping may not')
check(await errCode(() => app.withStaff(MGR, (tx) => tx.query('select * from ops.job_runs'))) === '42501', 'nobody in the app can read ops.job_runs directly')
check(await errCode(() => app.withAnon((tx) => tx.query('select * from public.last_cleanup()'))) === '42501', 'guests (anon) may not')
if (real) await pool.end()
else await db.exec('reset role')

if (real) {
  console.log('\nThe command line (as Railway runs it)')
  const r = spawnSync(process.execPath, ['scripts/daily-cleanup.mjs'], {
    cwd: ROOT, env: { ...process.env, MIGRATION_DATABASE_URL: urlFor('app_owner') }, encoding: 'utf8', timeout: 30000 })
  check(r.status === 0 && /✓ done/.test(r.stdout), 'node scripts/daily-cleanup.mjs exits 0', (r.stdout + r.stderr).slice(-300))
  check(!r.stdout.includes('postgresql://'), 'it does not print the database URL')
}

await close()
console.log(failures ? `\n${failures} FAILED` : '\nall daily clean-up checks passed')
process.exit(failures ? 1 : 0)
