#!/usr/bin/env bash
# =============================================================================
# HMS Returnly — hotel setup S1: database for first-time setup and configuration
#
#   bash setup-s1-db.bash                    # apply + check
#   bash setup-s1-db.bash --rollback-help
#
# Creates setup/s1-hotel-config-db from origin/railway. Database only: the app
# looks and behaves exactly as before until the setup screen (S2) uses it.
#   * migration 012 (Railway only, additive): installation (setup done?),
#     floors + rooms.floor_id/rooms.active, areas, hotel contact and support
#     details, and the functions setup_status(), complete_initial_setup()
#     (once only, all or nothing), update_hotel_details(), update_staff_member()
#     (managers rename staff or change roles, e.g. make a second admin);
#   * existing hotels (your local DEMO): floors made from their rooms, the nine
#     usual areas, and marked as set up, so no setup screen appears for them;
#   * supabase/seed.sql: a fresh local database is set up too;
#   * tests: supabase/tests/setup.test.mjs (+ platform/migrations-sync updates).
# After merging, npm run db:local:setup applies 012 to your local database, and
# Railway applies it to staging automatically before the next deploy.
# Nothing touches .env.local, any database or Railway. Never commits, pushes or deploys.
# =============================================================================
set -Eeuo pipefail
set -f   # no filename patterns: paths contain ( ) and [ ]
trap 'echo "✗ Stopped at line $LINENO (exit $?). Nothing was committed or pushed. Undo: bash $0 --rollback-help" >&2' ERR

BASE="railway"
BRANCH="setup/s1-hotel-config-db"
NEW_FILES="db/migrations/20261030000012_hotel_setup.sql supabase/tests/setup.test.mjs"
ok()  { printf '  ✓ %s\n' "$1"; }
die() { printf '  ✗ %s\n' "$1" >&2; exit 1; }

case "${1:-}" in
  "") ;;
  --rollback-help)
    cat <<'HELP'
ROLLBACK (before committing):
  git switch --discard-changes railway      (drops this step's edits; your other branches are untouched)
  git branch -D setup/s1-hotel-config-db
  then delete the NEW files if they are still there (git status lists them):
    db/migrations/20261030000012_hotel_setup.sql
    supabase/tests/setup.test.mjs
Backups of the replaced files are in .git/returnly-backup/<time>/.
After pushing: close the pull request; railway and main are untouched.
HELP
    exit 0 ;;
  *) die "Unknown option: $1" ;;
esac

echo "== Checks =="
for t in git node npm; do command -v "$t" >/dev/null 2>&1 || die "$t is not installed"; done
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node 22 or later needed"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "Not in a git repository"
[ "$(pwd -P)" = "$(cd "$ROOT" && pwd -P)" ] || die "Run this from the repo root: $ROOT"
grep -q '"name": "hms-returnly"' package.json || die "package.json is not hms-returnly"
sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }

CURRENT=$(git branch --show-current)
if [ "$CURRENT" = "$BRANCH" ] && [ -f db/migrations/20261030000012_hotel_setup.sql ]; then
  ok "Already on $BRANCH with the changes — re-running checks only"
  APPLY=0
else
  APPLY=1
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "Uncommitted changes to tracked files (often AGENTS.md after npm run dev: git restore AGENTS.md). Commit or stash them first."
  git show-ref --verify --quiet "refs/heads/$BRANCH" && die "Branch $BRANCH already exists. Switch to it and re-run, or delete it."
  git fetch --quiet origin "+refs/heads/$BASE:refs/remotes/origin/$BASE" || die "Could not fetch $BASE from GitHub"
  BASE_SHA=$(git rev-parse "origin/$BASE")
  [ "$(git ls-remote origin "refs/heads/$BASE" | awk '{print $1}')" = "$BASE_SHA" ] || die "origin/$BASE does not match GitHub; re-run this script"
  ok "origin/$BASE is $(git rev-parse --short "$BASE_SHA")"
  git cat-file -e "origin/$BASE:db/migrate.mjs" 2>/dev/null || die "unexpected base — tell Claude"
  ok "base looks right"
  for f in $NEW_FILES; do
    git cat-file -e "origin/$BASE:$f" 2>/dev/null && die "$f already exists on $BASE — tell Claude"
    [ -e "$f" ] && die "$f already exists in your folder (untracked). Move it aside first — tell Claude"
  done
  while read -r path blob; do
    [ "$(git rev-parse "origin/$BASE:$path" 2>/dev/null)" = "$blob" ] || die "$path on $BASE differs from the version these changes were made against — tell Claude"
  done <<'BLOBS'
db/README.md 348567ae1391c9f8ac2c4f783a8a8013834b6773
package.json a4c0f33ece8f5739b8fdfa48e484f355aa6cc41e
supabase/seed.sql 2d85f27336789285d5916c7b0356f195bdf83b58
supabase/tests/platform.test.mjs 1e001393a75fec8771a5203f58fed0b12d0941b6
tests/migrations-sync.test.mjs 66591c2c44cd2bde8cbfbb7b352a8268dda3ed82
package-lock.json d1ab090cb31b2be1cec3e601ce523c1958cd3031
BLOBS
  ok "Files to be replaced (and package-lock.json) match origin/$BASE"
fi

TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT

mkdir -p "$TMP/db/migrations"
cat > "$TMP/db/migrations/20261030000012_hotel_setup.sql" <<'RETURNLY_FILE_EOF'
-- HMS Returnly — first-time hotel setup and hotel configuration (Railway only)
--
-- 1. installation: one row once this installation's hotel has been set up.
--    The setup screen is offered only while it is empty, and
--    complete_initial_setup() refuses to run a second time — the database
--    itself guarantees setup happens once, whatever the app does.
-- 2. floors (a list per hotel) and rooms.floor_id; rooms.active so a room that
--    already has history can be retired instead of deleted. rooms.floor (the
--    old free-text column) is kept and filled from the floor's name, so
--    existing queries (room_board) keep working unchanged.
-- 3. areas: public areas (Lobby, Restaurant …) per hotel, replacing the list
--    that was hard-coded in the app. Logged items keep their area label as
--    text, so renaming an area never rewrites history.
-- 4. Hotel contact and support details on properties.
-- 5. Functions: setup_status(), complete_initial_setup(), update_hotel_details(),
--    update_staff_member().
-- Additive only: no column, table or row is removed. Existing hotels (for
-- example a local DEMO hotel) get floors from their rooms' floor text, the
-- default areas, and count as already set up.

-- 1. Installation -------------------------------------------------------------
create table public.installation (
  singleton     boolean primary key default true check (singleton),
  property_id   uuid not null unique references public.properties (id),
  completed_at  timestamptz not null default now(),
  completed_by  uuid references public.staff (user_id)
);
comment on table public.installation is
  'One row once first-time setup is complete. Read through setup_status(); written only by complete_initial_setup().';
alter table public.installation enable row level security;
revoke all on public.installation from anon, authenticated;
-- No policies: only the owner (and the security-definer functions below) can read it.

-- 2. Floors and rooms -----------------------------------------------------------
create table public.floors (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  name         text not null check (name ~ '^[A-Za-z0-9 ._-]{1,20}$' and name = trim(name)),
  sort_order   integer not null default 0 check (sort_order between 0 and 1000),
  active       boolean not null default true,
  unique (property_id, name),
  unique (property_id, id)
);
create index floors_property_idx on public.floors (property_id, sort_order);

alter table public.rooms
  add column floor_id uuid,
  add column active boolean not null default true,
  add constraint rooms_floor_same_hotel
    foreign key (property_id, floor_id) references public.floors (property_id, id);
create index rooms_floor_idx on public.rooms (floor_id);

-- rooms.floor (text) always shows the floor's current name.
create or replace function public.rooms_sync_floor_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.floor_id is not null then
    select f.name into new.floor from public.floors f where f.id = new.floor_id;
  end if;
  return new;
end;
$$;
create trigger rooms_sync_floor_name
  before insert or update of floor_id on public.rooms
  for each row execute function public.rooms_sync_floor_name();

create or replace function public.floors_rename_rooms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.rooms set floor = new.name where floor_id = new.id;
  end if;
  return new;
end;
$$;
create trigger floors_rename_rooms
  after update of name on public.floors
  for each row execute function public.floors_rename_rooms();

-- Existing rooms: one floor per distinct floor text, numbers in numeric order.
insert into public.floors (property_id, name, sort_order)
select property_id, left(trim(floor), 20),
       (row_number() over (partition by property_id
          order by (trim(floor) ~ '^[0-9]+$') desc,
                   case when trim(floor) ~ '^[0-9]+$' then trim(floor)::numeric end,
                   trim(floor)))::int
from (select distinct property_id, floor from public.rooms
      where floor is not null and trim(floor) ~ '^[A-Za-z0-9 ._-]{1,20}$') r
on conflict do nothing;

update public.rooms r set floor_id = f.id
from public.floors f
where f.property_id = r.property_id and f.name = trim(r.floor) and r.floor_id is null;

alter table public.floors enable row level security;
revoke all on public.floors from anon;

create policy floors_select on public.floors
  for select to authenticated
  using (property_id = public.current_property_id());

create policy floors_manage on public.floors
  for all to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'))
  with check (property_id = public.current_property_id() and public.has_role('{manager}'));

-- 3. Areas --------------------------------------------------------------------
create table public.areas (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  label        text not null check (length(trim(label)) between 1 and 60 and label = trim(label)),
  sort_order   integer not null default 0 check (sort_order between 0 and 1000),
  active       boolean not null default true,
  unique (property_id, label)
);
create index areas_property_idx on public.areas (property_id, sort_order);

-- Existing hotels get the list the app used to hard-code.
insert into public.areas (property_id, label, sort_order)
select p.id, a.label, a.n::int
from public.properties p
cross join unnest(array['Lobby', 'Restaurant', 'Bar', 'Gym', 'Pool', 'Meeting rooms',
                        'Car park', 'Lifts', 'Corridor']) with ordinality as a(label, n)
on conflict do nothing;

alter table public.areas enable row level security;
revoke all on public.areas from anon;

create policy areas_select on public.areas
  for select to authenticated
  using (property_id = public.current_property_id());

create policy areas_manage on public.areas
  for all to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'))
  with check (property_id = public.current_property_id() and public.has_role('{manager}'));

-- 4. Hotel contact and support details ------------------------------------------
alter table public.properties
  add column address        text check (address is null or length(address) <= 300),
  add column contact_phone  text check (contact_phone is null or contact_phone ~ '^[0-9 +()-]{5,30}$'),
  add column contact_email  text check (contact_email is null or (length(contact_email) <= 120 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column support_hours  text check (support_hours is null or length(support_hours) <= 120),
  add column support_note   text check (support_note is null or length(support_note) <= 500);

-- Existing hotels count as set up (the oldest one is this installation's hotel).
insert into public.installation (property_id, completed_at)
select id, created_at from public.properties order by created_at, id limit 1
on conflict do nothing;

-- 5. Functions ------------------------------------------------------------------

-- Is this installation set up? The only thing the setup screen needs to know
-- before anyone can sign in. Reveals nothing else.
create or replace function public.setup_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.installation)
$$;
revoke all on function public.setup_status() from public;
grant execute on function public.setup_status() to anon, authenticated;

-- First-time setup, all or nothing. Called by the app's setup screen (as anon:
-- nobody can sign in yet) only after it has checked the one-time SETUP_TOKEN
-- and created the first manager's login with Better Auth. p_config:
--   { "hotel":   { "code", "name", "address", "phone", "email", "support_hours", "support_note" },
--     "floors":  [ { "name": "1", "rooms": ["101", "102"] }, … ],
--     "areas":   [ "Lobby", … ],
--     "storage": [ { "label": "Front desk safe", "secure": true }, … ] }
create or replace function public.complete_initial_setup(
  p_user_id      uuid,
  p_username     text,
  p_display_name text,
  p_config       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hotel    jsonb := coalesce(p_config -> 'hotel', '{}'::jsonb);
  v_code     text  := upper(trim(coalesce(v_hotel ->> 'code', '')));
  v_name     text  := trim(coalesce(v_hotel ->> 'name', ''));
  v_property uuid;
  v_floor    jsonb;
  v_floor_id uuid;
  v_room     text;
  v_n        integer := 0;
  v_rooms    integer := 0;
  v_item     jsonb;
  v_text     text;
begin
  -- Two setup screens submitted at the same moment: the second waits here,
  -- then finds the installation row and stops.
  perform pg_advisory_xact_lock(hashtext('returnly.initial_setup'));
  if exists (select 1 from public.installation) or exists (select 1 from public.properties) then
    raise exception 'This installation is already set up.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'The administrator login was not found.' using errcode = 'P0001';
  end if;

  if v_code !~ '^[A-Z0-9]{3,10}$' then
    raise exception 'Hotel code: 3–10 letters or digits (e.g. GRAND).' using errcode = 'P0001';
  end if;
  if length(v_name) not between 2 and 100 then
    raise exception 'Hotel name: 2–100 characters.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_config -> 'floors') is distinct from 'array' or jsonb_array_length(p_config -> 'floors') = 0 then
    raise exception 'Add at least one floor with its rooms.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_config -> 'floors') > 200 then
    raise exception 'At most 200 floors.' using errcode = 'P0001';
  end if;

  insert into public.properties (inn_code, name, address, contact_phone, contact_email, support_hours, support_note)
  values (v_code, v_name,
          nullif(trim(v_hotel ->> 'address'), ''), nullif(trim(v_hotel ->> 'phone'), ''),
          nullif(lower(trim(v_hotel ->> 'email')), ''), nullif(trim(v_hotel ->> 'support_hours'), ''),
          nullif(trim(v_hotel ->> 'support_note'), ''))
  returning id into v_property;

  for v_floor in select value from jsonb_array_elements(p_config -> 'floors') loop
    v_n := v_n + 1;
    v_text := trim(coalesce(v_floor ->> 'name', ''));
    if v_text !~ '^[A-Za-z0-9 ._-]{1,20}$' then
      raise exception 'Floor %: name of 1–20 letters, digits, spaces, dots or dashes.', v_n using errcode = 'P0001';
    end if;
    if exists (select 1 from public.floors where property_id = v_property and name = v_text) then
      raise exception 'Floor "%" is listed twice.', v_text using errcode = 'P0001';
    end if;
    insert into public.floors (property_id, name, sort_order) values (v_property, v_text, v_n)
    returning id into v_floor_id;
    if jsonb_typeof(v_floor -> 'rooms') is distinct from 'array' or jsonb_array_length(v_floor -> 'rooms') = 0 then
      raise exception 'Floor "%": add its room numbers.', v_text using errcode = 'P0001';
    end if;
    for v_room in select trim(value) from jsonb_array_elements_text(v_floor -> 'rooms') loop
      if v_room !~ '^[A-Za-z0-9-]{1,10}$' then
        raise exception 'Room "%": 1–10 letters, digits or dashes.', left(v_room, 20) using errcode = 'P0001';
      end if;
      if exists (select 1 from public.rooms where property_id = v_property and room_number = v_room) then
        raise exception 'Room % is listed twice.', v_room using errcode = 'P0001';
      end if;
      insert into public.rooms (property_id, room_number, floor_id) values (v_property, v_room, v_floor_id);
      v_rooms := v_rooms + 1;
    end loop;
  end loop;
  if v_rooms > 5000 then
    raise exception 'At most 5000 rooms.' using errcode = 'P0001';
  end if;

  v_n := 0;
  if jsonb_typeof(p_config -> 'areas') = 'array' then
    for v_text in select trim(value) from jsonb_array_elements_text(p_config -> 'areas') loop
      v_n := v_n + 1;
      if length(v_text) not between 1 and 60 then
        raise exception 'Area %: 1–60 characters.', v_n using errcode = 'P0001';
      end if;
      if exists (select 1 from public.areas where property_id = v_property and label = v_text) then
        raise exception 'Area "%" is listed twice.', v_text using errcode = 'P0001';
      end if;
      insert into public.areas (property_id, label, sort_order) values (v_property, v_text, v_n);
    end loop;
  end if;

  if jsonb_typeof(p_config -> 'storage') = 'array' then
    for v_item in select value from jsonb_array_elements(p_config -> 'storage') loop
      v_text := trim(coalesce(v_item ->> 'label', ''));
      if length(v_text) not between 1 and 60 then
        raise exception 'Storage place: 1–60 characters.' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.storage_locations where property_id = v_property and label = v_text) then
        raise exception 'Storage place "%" is listed twice.', v_text using errcode = 'P0001';
      end if;
      insert into public.storage_locations (property_id, label, is_secure)
      values (v_property, v_text, coalesce((v_item ->> 'secure')::boolean, false));
    end loop;
  end if;

  insert into public.staff (user_id, property_id, username, display_name, role)
  values (p_user_id, v_property, lower(trim(p_username)), trim(p_display_name), 'manager');

  insert into public.installation (property_id, completed_by) values (v_property, p_user_id);
  return v_property;
end;
$$;
revoke all on function public.complete_initial_setup(uuid, text, text, jsonb) from public, authenticated;
grant execute on function public.complete_initial_setup(uuid, text, text, jsonb) to anon;

-- Managers edit their hotel's details. The hotel code is fixed: it is printed
-- on every item tag.
create or replace function public.update_hotel_details(
  p_name          text,
  p_address       text,
  p_contact_phone text,
  p_contact_email text,
  p_support_hours text,
  p_support_note  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can change hotel details.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 100 then
    raise exception 'Hotel name: 2–100 characters.' using errcode = 'P0001';
  end if;
  update public.properties set
    name          = trim(p_name),
    address       = nullif(trim(p_address), ''),
    contact_phone = nullif(trim(p_contact_phone), ''),
    contact_email = nullif(lower(trim(p_contact_email)), ''),
    support_hours = nullif(trim(p_support_hours), ''),
    support_note  = nullif(trim(p_support_note), '')
  where id = v_property;
end;
$$;
revoke all on function public.update_hotel_details(text, text, text, text, text, text) from public, anon;
grant execute on function public.update_hotel_details(text, text, text, text, text, text) to authenticated;

-- Managers change a staff member's name or role (including making another
-- manager). A manager can't change their own role, and the hotel always keeps
-- at least one active manager.
create or replace function public.update_staff_member(
  p_user_id      uuid,
  p_display_name text,
  p_role         public.staff_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_current  public.staff;
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can change staff.' using errcode = '42501';
  end if;
  select * into v_current from public.staff
   where user_id = p_user_id and property_id = v_property
   for update;
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_display_name, ''))) not between 1 and 80 then
    raise exception 'Name: 1–80 characters.' using errcode = 'P0001';
  end if;
  if p_role is distinct from v_current.role then
    if p_user_id = auth.uid() then
      raise exception 'You can''t change your own role.' using errcode = '42501';
    end if;
    if v_current.role = 'manager' and v_current.active and not exists (
      select 1 from public.staff
       where property_id = v_property and role = 'manager' and active and user_id <> p_user_id
    ) then
      raise exception 'The hotel needs at least one active manager.' using errcode = 'P0001';
    end if;
  end if;
  update public.staff set display_name = trim(p_display_name), role = p_role
   where user_id = p_user_id and property_id = v_property;
end;
$$;
revoke all on function public.update_staff_member(uuid, text, public.staff_role) from public, anon;
grant execute on function public.update_staff_member(uuid, text, public.staff_role) to authenticated;
RETURNLY_FILE_EOF

mkdir -p "$TMP/supabase/tests"
cat > "$TMP/supabase/tests/setup.test.mjs" <<'RETURNLY_FILE_EOF'
// Run with: npm run test:db
// Migration 012: first-time hotel setup, floors, areas, hotel details and
// staff edits. Run as the app runs them: through the data layer as app_user
// (anon before anyone can sign in, then signed-in staff). Both test databases.
//   Part 1: a brand-new installation (no seed): the setup screen's database side.
//   Part 2: an installation that already had a hotel before 012 (the upgrade path).
import { openTestDb } from './test-db.mjs'
import { createDb } from '../../src/lib/db/core.ts'
import { returnlyTypes } from '../../src/lib/db/pg-types.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const MIGRATIONS = readdirSync(`${ROOT}/db/migrations`).sort()
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(msg + (detail ? ' → ' + detail : '')))

async function open(suite, { upTo = MIGRATIONS.length, seed = false } = {}) {
  const t = await openTestDb(suite)
  await t.db.exec(readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8'))
  for (const f of MIGRATIONS.slice(0, upTo)) {
    await t.db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/${f}`, 'utf8')}\n;reset role;`)
  }
  if (seed) await t.db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/supabase/seed.sql`, 'utf8')}\n;reset role;`)
  return t
}

async function appDb(t) {
  if (t.kind !== 'PGlite') {
    const pg = (await import('pg')).default
    const name = (await t.db.query('select current_database() as d')).rows[0].d
    const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + name; u.username = 'app_user'; u.password = ''
    const pool = new pg.Pool({ connectionString: u.toString(), max: 4, types: returnlyTypes })
    return { app: createDb(pool), end: () => pool.end() }
  }
  // PGlite: one connection; the owner work below happens before switching to app_user.
  const client = { query: (q, p) => t.db.query(q, p), release: () => {} }
  return { app: createDb({ connect: async () => client }), end: async () => {}, single: true }
}

const codeOf = async (p) => { try { await p; return 'ok' } catch (e) { return e.code ?? e.message } }
const msgOf = async (p) => { try { await p; return 'ok' } catch (e) { return e.message } }

// ============================================================================
console.log('Part 1: a brand-new installation')
const t1 = await open('setup')
console.log('database: ' + t1.kind)
const real = t1.kind !== 'PGlite'

// Logins exist before setup runs (the app creates them with Better Auth first).
const ADMIN = randomUUID(), HK = randomUUID(), OTHER_MGR = randomUUID(), SPARE = randomUUID()
await t1.db.exec(`set role app_owner;
  insert into auth.users (id) values ('${ADMIN}'), ('${HK}'), ('${OTHER_MGR}'), ('${SPARE}');
  reset role;`)
if (!real) await t1.db.exec('set role app_user')
const { app, end } = await appDb(t1)
// Reads and writes as the database owner (PGlite has one connection: step out of app_user and back).
const own = async (q, p) => {
  if (!real) await t1.db.exec('reset role')
  try { return await t1.db.query(q, p ?? []) } finally { if (!real) await t1.db.exec('set role app_user') }
}
const ownExec = async (sql) => {
  if (!real) await t1.db.exec('reset role')
  try { await t1.db.exec(sql) } finally { if (!real) await t1.db.exec('set role app_user') }
}
const A = (fn) => app.withAnon(fn)
const S = (id, fn) => app.withStaff(id, fn)
const setup = (userId, config, username = 'gm.admin') => A((tx) =>
  tx.query(`select public.complete_initial_setup($1::uuid, $2, $3, $4::jsonb) as id`, [userId, username, 'Grace Manager', JSON.stringify(config)]))
const goodConfig = {
  hotel: { code: 'grand', name: 'The Grand Test Hotel', address: '1 Test Street, London', phone: '+44 20 7946 0000',
    email: 'Desk@Grand.Example', support_hours: 'Every day 08:00–20:00', support_note: 'Ask for the duty manager.' },
  floors: [
    { name: 'Ground', rooms: ['G01', 'G02'] },
    { name: '1', rooms: ['101', '102', '103'] },
  ],
  areas: ['Lobby', 'Restaurant', 'Spa'],
  storage: [{ label: 'Front desk safe', secure: true }, { label: 'Housekeeping shelf A' }],
}
const statusNow = async () => (await A((tx) => tx.query('select public.setup_status() as s'))).rows[0].s

console.log('\nBefore setup')
check((await statusNow()) === false, 'setup_status() is false on a fresh installation')
for (const table of ['installation', 'floors', 'areas', 'properties']) {
  check((await codeOf(A((tx) => tx.query(`select * from public.${table}`)))) === '42501', `anon cannot read ${table}`)
}

console.log('\nBad setup attempts leave nothing behind')
const bad = [
  [{ ...goodConfig, hotel: { ...goodConfig.hotel, code: 'x' } }, /Hotel code/, 'a bad hotel code'],
  [{ ...goodConfig, hotel: { ...goodConfig.hotel, name: ' ' } }, /Hotel name/, 'a missing hotel name'],
  [{ ...goodConfig, floors: [] }, /at least one floor/, 'no floors'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: [] }] }, /add its room numbers/, 'a floor without rooms'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: ['101'] }, { name: '1', rooms: ['102'] }] }, /listed twice/, 'the same floor twice'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: ['101'] }, { name: '2', rooms: ['101'] }] }, /Room 101 is listed twice/, 'the same room on two floors'],
  [{ ...goodConfig, floors: [{ name: '1', rooms: ['10 1'] }] }, /letters, digits or dashes/, 'a room number with a space'],
  [{ ...goodConfig, areas: ['Lobby', 'Lobby'] }, /Area "Lobby" is listed twice/, 'the same area twice'],
  [{ ...goodConfig, hotel: { ...goodConfig.hotel, email: 'not-an-email' } }, /contact_email|check constraint/, 'a malformed email'],
]
for (const [cfg, re, what] of bad) {
  const m = await msgOf(setup(ADMIN, cfg))
  check(re.test(m), `refused: ${what}`, m)
}
check(/administrator login was not found/.test(await msgOf(setup(randomUUID(), goodConfig))), 'refused: an admin login that does not exist')
const left = (await own(`select (select count(*) from public.properties)::int p, (select count(*) from public.floors)::int f,
  (select count(*) from public.rooms)::int r, (select count(*) from public.staff)::int s, (select count(*) from public.installation)::int i`)).rows[0]
check(left.p + left.f + left.r + left.s + left.i === 0, 'after every refusal: no hotel, floor, room, staff or setup row exists', JSON.stringify(left))
check((await statusNow()) === false, 'and setup is still offered')

console.log('\nSetup')
const created = await setup(ADMIN, goodConfig)
const propertyId = created.rows[0].id
check(/^[0-9a-f-]{36}$/.test(propertyId), 'complete_initial_setup() returns the new hotel id')
check((await statusNow()) === true, 'setup_status() is now true')
const prop = (await own(`select * from public.properties`)).rows
check(prop.length === 1 && prop[0].inn_code === 'GRAND' && prop[0].name === 'The Grand Test Hotel' && prop[0].contact_email === 'desk@grand.example'
  && prop[0].support_hours === 'Every day 08:00–20:00', 'hotel saved: code upper-cased, email lower-cased, contact and support details', JSON.stringify(prop[0]))
const floors = (await own(`select f.name, f.sort_order, array_agg(r.room_number order by r.room_number) rooms, bool_and(r.floor = f.name) synced
  from public.floors f join public.rooms r on r.floor_id = f.id group by f.id order by f.sort_order`)).rows
check(floors.length === 2 && floors[0].name === 'Ground' && floors[1].rooms.join() === '101,102,103' && floors.every((f) => f.synced),
  'floors saved in order, each room linked to its floor, rooms.floor shows the floor name', JSON.stringify(floors))
const areas = (await own(`select label from public.areas order by sort_order`)).rows.map((r) => r.label)
check(areas.join() === 'Lobby,Restaurant,Spa', 'areas saved in order', areas.join())
const storage = (await own(`select label, is_secure from public.storage_locations order by label`)).rows
check(storage.length === 2 && storage[0].is_secure === true && storage[1].is_secure === false, 'storage places saved (secure flag kept)')
const admin = (await own(`select username, role::text role, active from public.staff where user_id = $1`, [ADMIN])).rows[0]
check(admin?.username === 'gm.admin' && admin.role === 'manager' && admin.active, 'the first administrator is an active manager')
const inst = (await own(`select property_id, completed_by from public.installation`)).rows
check(inst.length === 1 && inst[0].property_id === propertyId && inst[0].completed_by === ADMIN, 'installation records the hotel and who set it up')

console.log('\nSetup happens once')
check((await codeOf(setup(SPARE, { ...goodConfig, hotel: { ...goodConfig.hotel, code: 'OTHER' } }, 'second.admin'))) === '42501', 'a second setup is refused, even with a different hotel')
check((await own(`select count(*)::int n from public.properties`)).rows[0].n === 1, 'still exactly one hotel')
check((await codeOf(S(ADMIN, (tx) => tx.query(`select public.complete_initial_setup($1::uuid, 'x.y', 'X', '{}'::jsonb)`, [SPARE])))) === '42501',
  'signed-in staff cannot call the setup function at all')

console.log('\nThe administrator manages the hotel')
const mine = await S(ADMIN, async (tx) => ({
  floors: (await tx.query(`select name from public.floors order by sort_order`)).rows.length,
  areas: (await tx.query(`select label from public.areas`)).rows.length,
  rooms: (await tx.query(`select room_number from public.rooms`)).rows.length,
}))
check(mine.floors === 2 && mine.areas === 3 && mine.rooms === 5, 'sees the hotel’s floors, areas and rooms', JSON.stringify(mine))
await S(ADMIN, (tx) => tx.query(`insert into public.floors (property_id, name, sort_order) values ($1, '2', 3)`, [propertyId]))
await S(ADMIN, (tx) => tx.query(`insert into public.rooms (property_id, room_number, floor_id)
  select $1, '201', id from public.floors where name = '2'`, [propertyId]))
await S(ADMIN, (tx) => tx.query(`update public.floors set name = 'First' where name = '1'`))
const renamed = (await own(`select floor from public.rooms where room_number in ('101','201') order by room_number`)).rows.map((r) => r.floor)
check(renamed.join() === 'First,2', 'adds a floor and a room; renaming a floor updates its rooms', renamed.join())
await S(ADMIN, (tx) => tx.query(`update public.rooms set active = false where room_number = 'G02'`))
await S(ADMIN, (tx) => tx.query(`insert into public.areas (property_id, label, sort_order) values ($1, 'Car park', 4)`, [propertyId]))
await S(ADMIN, (tx) => tx.query(`update public.areas set active = false where label = 'Spa'`))
const after = (await own(`select (select active from public.rooms where room_number = 'G02') g02,
  (select count(*)::int from public.areas where active) areas`)).rows[0]
check(after.g02 === false && after.areas === 3, 'retires a room and an area (kept for history) and adds an area')
check((await codeOf(S(ADMIN, (tx) => tx.query(`insert into public.floors (property_id, name) values ($1, 'Roof')`, [randomUUID()])))) !== 'ok',
  'cannot add a floor to another hotel')

await S(ADMIN, (tx) => tx.query(`select public.update_hotel_details('The Grand', '2 New Road', '+44 20 0000 0000', 'help@grand.example', '24 hours', null)`))
const hotel = (await own(`select name, address, support_hours, support_note, inn_code from public.properties`)).rows[0]
check(hotel.name === 'The Grand' && hotel.address === '2 New Road' && hotel.support_hours === '24 hours' && hotel.support_note === null && hotel.inn_code === 'GRAND',
  'updates hotel details; the hotel code stays the same', JSON.stringify(hotel))
check((await codeOf(S(ADMIN, (tx) => tx.query(`select public.update_hotel_details('The Grand', null, null, 'nope', null, null)`)))) === '23514',
  'a malformed contact email is refused')

console.log('\nStaff: names and roles')
await S(ADMIN, (tx) => tx.query(`select public.add_staff_member($1, 'hk.anna', 'Anna', 'housekeeping')`, [HK]))
check((await codeOf(S(HK, (tx) => tx.query(`insert into public.floors (property_id, name) values ($1, '9')`, [propertyId])))) === '42501',
  'housekeeping can read but not change floors')
check((await S(HK, (tx) => tx.query(`select name from public.floors`))).rows.length === 3, 'housekeeping sees the floors (for logging items)')
check((await codeOf(S(HK, (tx) => tx.query(`select public.update_hotel_details('X Hotel', null, null, null, null, null)`)))) === '42501',
  'housekeeping cannot change hotel details')
check((await codeOf(S(HK, (tx) => tx.query(`select public.update_staff_member($1, 'Anna B', 'manager')`, [HK])))) === '42501',
  'housekeeping cannot change staff (or promote themselves)')
await S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Anna Brown', 'manager')`, [HK]))
const anna = (await own(`select display_name, role::text role from public.staff where user_id = $1`, [HK])).rows[0]
check(anna.display_name === 'Anna Brown' && anna.role === 'manager', 'a manager renames a staff member and makes them a manager (a second admin)')
check(/own role/.test(await msgOf(S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Grace', 'support')`, [ADMIN])))),
  'a manager cannot change their own role')
await S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Grace M', 'manager')`, [ADMIN]))
check((await own(`select display_name from public.staff where user_id = $1`, [ADMIN])).rows[0].display_name === 'Grace M', 'but can change their own name')
await S(HK, (tx) => tx.query(`select public.update_staff_member($1, 'Anna Brown', 'housekeeping')`, [HK]).catch((e) => { throw e }))
  .then(() => fail('a manager changed their own role'), () => pass('the second manager cannot demote themselves either'))
await S(ADMIN, (tx) => tx.query(`select public.update_staff_member($1, 'Anna Brown', 'housekeeping')`, [HK]))
check((await own(`select role::text r from public.staff where user_id = $1`, [HK])).rows[0].r === 'housekeeping', 'and can be set back to housekeeping by another manager')

console.log('\nAnother hotel in the same database stays separate')
await ownExec(`set role app_owner;
  insert into public.properties (inn_code, name) values ('OTHER', 'Other Hotel');
  insert into public.staff (user_id, property_id, username, display_name, role)
  select '${OTHER_MGR}', id, 'other.mgr', 'Olu', 'manager' from public.properties where inn_code = 'OTHER';
  reset role;`)
const otherSees = await S(OTHER_MGR, async (tx) => (await tx.query(`select count(*)::int n from public.floors`)).rows[0].n
  + (await tx.query(`select count(*)::int n from public.areas`)).rows[0].n)
check(otherSees === 0, 'the other hotel’s manager sees none of these floors or areas')
check((await codeOf(S(OTHER_MGR, (tx) => tx.query(`select public.update_staff_member($1, 'Hacked', 'support')`, [ADMIN])))) === 'P0002',
  'and cannot change this hotel’s staff')

await end()
await t1.close()

if (real) {
  console.log('\nTwo setup screens submitted at the same moment (real Postgres)')
  const tr = await open('setup_race')
  const U1 = randomUUID(), U2 = randomUUID()
  await tr.db.exec(`set role app_owner; insert into auth.users (id) values ('${U1}'), ('${U2}'); reset role;`)
  const r = await appDb(tr)
  const go = (u, code, name) => codeOf(r.app.withAnon((tx) => tx.query(`select public.complete_initial_setup($1::uuid, $2, 'Admin', $3::jsonb)`,
    [u, name, JSON.stringify({ ...goodConfig, hotel: { ...goodConfig.hotel, code } })])))
  const results = (await Promise.all([go(U1, 'RACEA', 'race.a'), go(U2, 'RACEB', 'race.b')])).sort()
  const counts = (await tr.db.query(`select (select count(*)::int from public.properties) p, (select count(*)::int from public.installation) i`)).rows[0]
  check(results.join() === '42501,ok' && counts.p === 1 && counts.i === 1, 'exactly one wins; the other is refused; one hotel exists', `${results} ${JSON.stringify(counts)}`)
  await r.end()
  await tr.close()
}

// ============================================================================
console.log('\nPart 2: upgrading an installation that already had a hotel')
const t2 = await open('setup_upgrade', { upTo: MIGRATIONS.indexOf('20261030000012_hotel_setup.sql'), seed: true })
await t2.db.exec(`set role app_owner;
  insert into public.rooms (property_id, room_number, floor) select id, '1001', '10' from public.properties where inn_code = 'DEMO';
  insert into public.rooms (property_id, room_number, floor) select id, 'PH1', 'Penthouse' from public.properties where inn_code = 'DEMO';
  reset role;`)
await t2.db.exec(`set role app_owner;\n${readFileSync(`${ROOT}/db/migrations/20261030000012_hotel_setup.sql`, 'utf8')}\n;reset role;`)
const up = (await t2.db.query(`select
  (select string_agg(name, ',' order by sort_order) from public.floors) floors,
  (select count(*)::int from public.rooms where floor_id is null) unlinked,
  (select count(*)::int from public.areas) areas,
  (select p.inn_code from public.installation i join public.properties p on p.id = i.property_id) installed`)).rows[0]
check(up.floors === '1,2,3,10,Penthouse', 'floors created from the rooms’ floor text, numbers in number order', up.floors)
check(up.unlinked === 0, 'every room is linked to its floor')
check(up.areas === 9, 'the nine areas the app used to hard-code are added')
check(up.installed === 'DEMO', 'the existing hotel counts as set up (no setup screen after the upgrade)')
await t2.close()

// Fresh local development database (migrations, then seed): set up, with floors and areas.
const t3 = await open('setup_seed', { seed: true })
const seeded = (await t3.db.query(`select (select count(*)::int from public.floors) f, (select count(*)::int from public.rooms where floor_id is null) u,
  (select count(*)::int from public.areas) a, (select count(*)::int from public.installation) i`)).rows[0]
check(seeded.f === 3 && seeded.u === 0 && seeded.a === 9 && seeded.i === 1, 'a fresh local database from the seed is set up, with floors and areas', JSON.stringify(seeded))
await t3.close()

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
RETURNLY_FILE_EOF

mkdir -p "$TMP/db"
cat > "$TMP/db/README.md" <<'RETURNLY_FILE_EOF'
# Database for plain Postgres (Railway)

This folder holds the database setup for running HMS Returnly on plain Postgres 17+ (Railway runs 18; CI tests on 18)
instead of Supabase. Supabase production is unchanged until launch.

| Path | What | Run as | When |
|---|---|---|---|
| `bootstrap/000_platform.sql` | Roles `anon`, `authenticated`, `app_user`, `app_owner`, `auth_service`; `auth.users`; `auth.uid()`; Supabase's default grants | a superuser | once per new database (safe to repeat) |
| `migrations/*.sql` | The eight Supabase migrations, copied. `004` is empty and `008` lacks one block: both only configured Supabase Storage, whose photo rules move to the app in Phase 5 | `app_owner` | in filename order, after the bootstrap; `007` alone in its own transaction |
| `migrations/20261022000009_auth_tables.sql` | **Railway only.** Sign-in tables for Better Auth in schema `auth` (extends `auth.users`; adds `session`, `account`, `verification`, `rate_limit`), usable only by `auth_service` | `app_owner` | after re-running the bootstrap (it creates `auth_service`) |
| `migrations/20261024000010_staff_admin.sql` | **Railway only.** `add_staff_member()` and `set_staff_active()`: the only way the app can add a staff row or change access; each checks the caller is an active manager of the same hotel | `app_owner` | after 009 |
| `migrations/20261026000011_sign_in_guard.sql` | **Railway only.** `auth.sign_in_failures` (wrong-password lock per username) and `auth.users.blocked` (deactivated staff cannot sign in), kept in step by `set_staff_active()` | `app_owner` | after 010 |
| `migrations/20261030000012_hotel_setup.sql` | **Railway only.** First-time setup (`installation`, `setup_status()`, `complete_initial_setup()`: once only, all or nothing), `floors` + `rooms.floor_id`/`rooms.active`, `areas`, hotel contact and support details, `update_hotel_details()`, `update_staff_member()`. Additive; existing hotels get floors from their rooms, the default areas, and count as set up | `app_owner` | after 011 |
| `migrate.mjs` | The runner: applies `migrations/` in order, one transaction per file, recording each file's SHA-256 in `ops.schema_migrations` | `app_owner` via `MIGRATION_DATABASE_URL` | every deploy (Phase 7 pre-deploy step) |

While `supabase/migrations/` still exists (until launch), change both folders together:
`tests/migrations-sync.test.mjs` fails if the copies drift from the originals. Railway-only files
must be listed in its `RAILWAY_ONLY` set. On Supabase the staff page wrote staff rows with the
service key (bypassing RLS); on Railway the app has no such key, so 010 moves that check into the database.

## Local development database

```bash
npm run db:local:setup          # creates returnly_dev on Postgres at localhost:5432
```

`scripts/local-db-setup.mjs` does what Railway will: the bootstrap as a superuser, every migration
as `app_owner` with the runner, then the DEMO seed (synthetic data only). It refuses anything that is
not on this computer, never drops or empties anything, and on an existing database only applies new
migrations, so run it again after pulling new ones. It prints the three connection strings for
`.env.local`. Then create a login with `npm run create-staff` (it asks for the password twice).
Set `LOCAL_PG_URL` if your local server is not `postgresql://localhost:5432/postgres`.

## Running migrations

```bash
MIGRATION_DATABASE_URL=… npm run db:migrate               # plan only: lists pending files, changes nothing
MIGRATION_DATABASE_URL=… npm run db:migrate -- --apply    # apply them
```

The runner stops **before changing anything** if it is connected as anything other than `app_owner`
(a superuser would end up owning the tables), if the bootstrap has not been run, if an applied file was
edited or removed, if a new file sorts before one already applied, or if another run holds the lock.
Files with statement-level `DROP`, `TRUNCATE`, `DELETE` or `RENAME` also need `--allow-destructive`.
A file that fails is rolled back and not recorded. Applied files are never edited: fix forward with a new file.

## App code: src/lib/db

All queries go through `withStaff(userId, tx => …)` or `withAnon(tx => …)` from `@/lib/db`. Each call runs in one
transaction as `authenticated` (with the staff user id) or `anon`, so row-level security applies exactly as on Supabase.

- `tx.query(sql, params)` for parameterised SQL; `tx.rpc(fn, { p_name: value })` for workflow functions.
- Statements starting with `SET`/`RESET`, `set_config()`, and transaction control are refused before reaching the database.
- On start-up the pool checks it is logged in as `app_user` (not a superuser) and refuses to serve requests otherwise.
- `tests/db-guard.test.mjs` fails if any file outside `src/lib/db` switches roles or imports `pg`.
- Sign-in uses its own pool (`src/lib/db/auth-pool.ts`) logged in as `auth_service`; it refuses to start as any other role.

## Roles

| Role | Logs in | Used by | Can do |
|---|---|---|---|
| `app_owner` | yes | migration runner, scheduled jobs | owns every table and function; not a superuser; no BYPASSRLS |
| `app_user` | yes | the web app | nothing by itself; each request runs `SET LOCAL ROLE authenticated` or `anon` inside a transaction |
| `authenticated` | no | signed-in staff requests | what row-level security and the workflow functions allow |
| `anon` | no | public customer pages | the four public functions only |
| `auth_service` | yes | Better Auth (sign-in, sessions) | only the sign-in tables in schema `auth`; no hotel tables or functions; cannot switch roles |

Rules for application code:

- Always `BEGIN; SET LOCAL ROLE …; SELECT set_config('request.jwt.claim.sub', $1, true); …; COMMIT;`
- Never a session-level `SET ROLE` or `set_config(..., false)`: on a pooled connection it leaks
  one user's identity into the next request. `supabase/tests/platform.test.mjs` proves `SET LOCAL`
  does not leak.

Passwords for `app_user` and `app_owner` are set by hand when a database is provisioned
(Phase 7), never in files.

## Tests

`npm run test:db` runs the bootstrap and every migration as `app_owner`; with
`TEST_DATABASE_URL` set it also logs in as `app_user` to prove the rules above.
RETURNLY_FILE_EOF

mkdir -p "$TMP/."
cat > "$TMP/package.json" <<'RETURNLY_FILE_EOF'
{
  "name": "hms-returnly",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "node --experimental-strip-types --import ./tests/resolve-ts.mjs --test tests/*.test.mjs",
    "test:db": "node supabase/tests/rls.test.mjs && node supabase/tests/stays.test.mjs && node supabase/tests/trace-refinements.test.mjs && node supabase/tests/customer-requests.test.mjs && node supabase/tests/platform.test.mjs && node supabase/tests/migrate.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/tests/data-layer.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/auth.test.mjs && node supabase/tests/local-db.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/pages-items.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/pages-item-detail.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/pages-log-photos.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/pages-requests.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/pages-public.test.mjs && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs supabase/tests/setup.test.mjs",
    "db:migrate": "node db/migrate.mjs",
    "create-staff": "node --env-file=.env.local --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs scripts/create-staff.mjs",
    "db:local:setup": "node scripts/local-db-setup.mjs",
    "storage:local": "node --env-file=.env.local --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/resolve-ts.mjs scripts/local-storage.mjs",
    "dev:lan": "next dev -H 0.0.0.0",
    "start:lan": "next start -H 0.0.0.0"
  },
  "dependencies": {
    "@fontsource-variable/public-sans": "^5.3.0",
    "aws4fetch": "1.0.20",
    "better-auth": "1.7.12",
    "next": "16.4.2",
    "pg": "8.23.1",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.8",
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/pg": "8.23.1",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.4.2",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
RETURNLY_FILE_EOF

mkdir -p "$TMP/supabase"
cat > "$TMP/supabase/seed.sql" <<'RETURNLY_FILE_EOF'
-- HMS Returnly — demo seed data (development only; no real hotel data)
-- Staff accounts are not seeded here: create the first manager with
--   npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager

insert into public.properties (inn_code, name, retention_days)
values ('DEMO', 'Demo Hotel', 90)
on conflict (inn_code) do nothing;

insert into public.rooms (property_id, room_number, floor)
select p.id, f.floor::text || lpad(n::text, 2, '0'), f.floor::text
from public.properties p
cross join generate_series(1, 3) as f(floor)
cross join generate_series(1, 12) as n
where p.inn_code = 'DEMO'
on conflict do nothing;

insert into public.storage_locations (property_id, label, is_secure)
select p.id, l.label, l.is_secure
from public.properties p
cross join (values
  ('Housekeeping office — shelf A', false),
  ('Housekeeping office — shelf B', false),
  ('Front desk safe', true),
  ('Back office safe', true)
) as l(label, is_secure)
where p.inn_code = 'DEMO'
on conflict do nothing;

-- Railway only (migration 012 and later): floors, public areas, and "already
-- set up" for the demo hotel, so local development skips the first-time setup
-- screen. Skipped where those tables don't exist (the Supabase schema).
do $$
begin
  if to_regclass('public.installation') is null then
    return;
  end if;
  execute $sql$
    insert into public.floors (property_id, name, sort_order)
    select p.id, f.n::text, f.n from public.properties p cross join generate_series(1, 3) as f(n)
    where p.inn_code = 'DEMO'
    on conflict do nothing;

    update public.rooms r set floor_id = f.id
    from public.floors f, public.properties p
    where p.inn_code = 'DEMO' and r.property_id = p.id and f.property_id = p.id
      and f.name = r.floor and r.floor_id is null;

    insert into public.areas (property_id, label, sort_order)
    select p.id, a.label, a.n::int from public.properties p
    cross join unnest(array['Lobby', 'Restaurant', 'Bar', 'Gym', 'Pool', 'Meeting rooms',
                            'Car park', 'Lifts', 'Corridor']) with ordinality as a(label, n)
    where p.inn_code = 'DEMO'
    on conflict do nothing;

    insert into public.installation (property_id)
    select id from public.properties where inn_code = 'DEMO'
    on conflict do nothing;
  $sql$;
end $$;
RETURNLY_FILE_EOF

mkdir -p "$TMP/supabase/tests"
cat > "$TMP/supabase/tests/platform.test.mjs" <<'RETURNLY_FILE_EOF'
/* eslint-disable @typescript-eslint/no-unused-expressions -- `cond ? pass() : fail()` checks */
// Run with: npm run test:db
// Platform bootstrap for plain Postgres (db/bootstrap/000_platform.sql):
// applies it, then the Railway migrations (db/migrations) as the non-superuser
// owner app_owner, on bare Postgres with no Supabase storage schema, and checks
// the roles the Railway app will use.
//   Part A (PGlite and real Postgres): ownership, role attributes, grants, RLS.
//   Part B (real Postgres only): logs in as app_user, like the web app, and
//   proves it can do nothing without SET LOCAL ROLE and that nothing leaks
//   between transactions on one connection.
import { openTestDb } from './test-db.mjs'
import { readFileSync, readdirSync } from 'node:fs'

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { db, kind, connectAs, close } = await openTestDb('platform')
console.log('database: ' + kind)
let failures = 0
const pass = (m) => console.log('  ok   ' + m)
const fail = (m) => { failures++; console.log('  FAIL ' + m) }
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

// --- Bootstrap (twice: it must be safe to re-run) ------------------------------
const bootstrap = readFileSync(`${ROOT}/db/bootstrap/000_platform.sql`, 'utf8')
await db.exec(bootstrap)
try { await db.exec(bootstrap); pass('bootstrap can be run twice') } catch (e) { fail('bootstrap re-run → ' + e.message) }

// --- Railway migrations, applied as app_owner ------------------------------------
const MIGRATIONS = `${ROOT}/db/migrations`
const failuresBefore = failures
for (const f of readdirSync(MIGRATIONS).sort()) {
  try {
    await db.exec(`set role app_owner;\n${readFileSync(`${MIGRATIONS}/${f}`, 'utf8')}\n;reset role;`)
  } catch (e) {
    await db.exec('reset role').catch(() => {})
    fail(`${f} as app_owner → ${e.message}`)
  }
}
if (failures === failuresBefore) pass('all db/migrations apply as app_owner (not a superuser)')
const storageSchema = await one(`select count(*)::int n from pg_namespace where nspname = 'storage'`)
storageSchema.n === 0 ? pass('no Supabase storage schema needed or created') : fail('a storage schema exists')
await db.exec(`set role app_owner;\n${readFileSync(`${REPO}/seed.sql`, 'utf8')}\n;reset role;`)

console.log('\nPart A: ownership, roles, grants')
const owners = await db.query(`
  select r.rolname, count(*)::int n from (
    select relowner o from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname in ('public', 'auth') and c.relkind in ('r', 'v', 'S', 'f', 'p')
    union all
    select proowner from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('public', 'auth')
  ) x join pg_roles r on r.oid = x.o group by 1`)
owners.rows.length === 1 && owners.rows[0].rolname === 'app_owner'
  ? pass(`every table, sequence and function is owned by app_owner (${owners.rows[0].n})`)
  : fail('owners: ' + JSON.stringify(owners.rows))

const roles = (await db.query(`select rolname, rolsuper, rolinherit, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb
  from pg_roles where rolname in ('anon','authenticated','app_user','app_owner','auth_service')`)).rows
const R = Object.fromEntries(roles.map((r) => [r.rolname, r]))
roles.length === 5 ? pass('five platform roles exist (incl. auth_service)') : fail('roles: ' + roles.map((r) => r.rolname))
roles.every((r) => !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole && !r.rolcreatedb)
  ? pass('none is superuser, BYPASSRLS, CREATEROLE or CREATEDB') : fail('role flags: ' + JSON.stringify(roles))
!R.app_user.rolinherit && !R.anon.rolinherit && !R.authenticated.rolinherit && !R.auth_service.rolinherit
  ? pass('app_user, auth_service, anon and authenticated do not inherit privileges') : fail('inherit flags wrong')
R.app_user.rolcanlogin && R.app_owner.rolcanlogin && R.auth_service.rolcanlogin && !R.anon.rolcanlogin && !R.authenticated.rolcanlogin
  ? pass('only app_user, app_owner and auth_service can log in') : fail('login flags wrong')

const members = (await db.query(`
  select r.rolname as granted, m.inherit_option, m.set_option
  from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
  where u.rolname = 'app_user' order by 1`)).rows
members.length === 2 && members.map((m) => m.granted).join() === 'anon,authenticated' &&
  members.every((m) => !m.inherit_option && m.set_option)
  ? pass('app_user may only SET ROLE to anon or authenticated, and inherits nothing')
  : fail('app_user memberships: ' + JSON.stringify(members))

const noRls = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows
noRls.length === 0 ? pass('row-level security is on for every public table') : fail('no RLS: ' + noRls.map((r) => r.relname))

const appUserTables = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r'
  and (has_table_privilege('app_user', c.oid, 'select') or has_table_privilege('app_user', c.oid, 'insert')
    or has_table_privilege('app_user', c.oid, 'update') or has_table_privilege('app_user', c.oid, 'delete'))`)).rows
appUserTables.length === 0 ? pass('app_user has no privileges on any table by itself') : fail('app_user can touch: ' + appUserTables.map((r) => r.relname))

const anonTables = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select')`)).rows
anonTables.length === 0 ? pass('anon cannot read any table') : fail('anon can read: ' + anonTables.map((r) => r.relname))

const anonFns = (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map((r) => r.proname).join(',')
// The four customer functions, plus (migration 012) the two the first-time
// setup screen needs before anyone can sign in.
anonFns === 'complete_initial_setup,customer_reply,customer_request_status,public_properties,setup_status,submit_customer_request'
  ? pass('anon can call exactly the four public functions and the two setup functions') : fail('anon functions: ' + anonFns)

const ownerOnly = (await db.query(`select has_function_privilege('authenticated', 'public.purge_closed_requests()', 'execute') a,
  has_function_privilege('authenticated', 'public.purge_expired_stays()', 'execute') b,
  has_function_privilege('app_owner', 'public.purge_closed_requests()', 'execute') c`)).rows[0]
!ownerOnly.a && !ownerOnly.b && ownerOnly.c
  ? pass('purges run only as app_owner (scheduled job), not as staff') : fail('purge grants: ' + JSON.stringify(ownerOnly))

console.log('\nSign-in tables (schema auth, migration 009)')
const AUTH_TABLES = ['auth.users', 'auth.session', 'auth.account', 'auth.verification', 'auth.rate_limit']
const present = (await db.query(`select count(*)::int n from unnest($1::text[]) t where to_regclass(t) is not null`, [AUTH_TABLES])).rows[0].n
present === AUTH_TABLES.length ? pass('users, session, account, verification and rate_limit exist in schema auth') : fail(`only ${present} auth tables exist`)
const inPublicAuth = (await db.query(`select string_agg(table_name, ',') t from information_schema.tables where table_schema = 'public'
  and table_name in ('user', 'users', 'session', 'account', 'verification', 'rate_limit')`)).rows[0].t
!inPublicAuth ? pass('no sign-in table is in schema public') : fail('auth tables in public: ' + inPublicAuth)
const authLeaks = (await db.query(`select r || ' ' || p || ' ' || t as x from unnest($1::text[]) t,
  unnest(array['anon','authenticated','app_user']) r, unnest(array['select','insert','update','delete']) p
  where has_table_privilege(r, t, p)`, [AUTH_TABLES])).rows.map((r) => r.x)
authLeaks.length === 0 ? pass('anon, authenticated and app_user have no privilege on any sign-in table') : fail('auth table privileges: ' + authLeaks.join('; '))
const svcOk = (await db.query(`select bool_and(has_table_privilege('auth_service', t, 'select,insert,update,delete')) ok from unnest($1::text[]) t`, [AUTH_TABLES])).rows[0].ok
svcOk ? pass('auth_service can read and write the sign-in tables') : fail('auth_service lacks privileges on auth tables')
const svcPublic = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and (has_table_privilege('auth_service', c.oid, 'select')
  or has_table_privilege('auth_service', c.oid, 'insert') or has_table_privilege('auth_service', c.oid, 'update')
  or has_table_privilege('auth_service', c.oid, 'delete'))`)).rows
svcPublic.length === 0 ? pass('auth_service has no privilege on any hotel table') : fail('auth_service can touch: ' + svcPublic.map((r) => r.relname))
const svcFns = (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('auth_service', p.oid, 'execute')`)).rows
svcFns.length === 0 ? pass('auth_service cannot call any hotel function') : fail('auth_service can call: ' + svcFns.map((r) => r.proname))
const svcPath = (await db.query(`select array_to_string(s.setconfig, ',') c from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
  where r.rolname = 'auth_service' and s.setdatabase = (select oid from pg_database where datname = current_database())`)).rows[0]?.c ?? ''
const pathOk = /search_path=auth/.test(svcPath)
pathOk ? pass('auth_service defaults to search_path auth in this database') : fail('auth_service settings: ' + svcPath)

// Fixtures: a housekeeper and a front-office user at DEMO.
const U = { hk: '00000000-0000-0000-0000-0000000000a1', fo: '00000000-0000-0000-0000-0000000000a2' }
await db.exec(`
  set role app_owner;
  insert into auth.users (id) values ('${U.hk}'), ('${U.fo}');
  insert into public.staff (user_id, property_id, username, display_name, role, active)
  select u, (select id from public.properties where inn_code = 'DEMO'), n, n, r::public.staff_role, true
  from (values ('${U.hk}'::uuid, 'hk01', 'housekeeping'), ('${U.fo}'::uuid, 'fo01', 'front_office')) t(u, n, r);
  reset role;
`)
const DEMO = (await one(`select id from public.properties where inn_code = 'DEMO'`)).id

// --- Part B: real login as app_user ------------------------------------------------
console.log('\nPart B: logged in as app_user (the web app)')
const app = await connectAs('app_user').catch((e) => {
  fail('could not log in as app_user → ' + e.message + ' (the test server must trust local logins)')
  return null
})
if (!app) {
  if (kind === 'PGlite') console.log('  skip (needs real Postgres: set TEST_DATABASE_URL)')
} else {
  const denied = async (name, sql, params, match = 'permission denied') => {
    try { await app.query(sql, params); fail(`${name} → succeeded`) } catch (e) {
      e.message.includes(match) ? pass(`${name} (${e.message})`) : fail(`${name} → ${e.message}`)
    }
    await app.query('rollback').catch(() => {})
  }
  // Reads the raw per-request setting: app_user itself may not even use auth.uid().
  const me = async () => (await app.query(`select current_user as u,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid as uid`)).rows[0]

  const start = await me()
  start.u === 'app_user' && start.uid === null ? pass('connects as app_user with no user id set') : fail('start: ' + JSON.stringify(start))

  await denied('cannot read items without switching role', `select count(*) from public.lost_items`)
  await denied('cannot read staff without switching role', `select count(*) from public.staff`)
  await denied('cannot switch to app_owner', `set role app_owner`)
  await denied('cannot switch to the superuser', `set role postgres`)
  await denied('cannot even call auth.uid() without switching role', `select auth.uid()`)
  await denied('cannot create tables', `create table public.sneaky (id int)`)
  await denied('cannot grant itself BYPASSRLS', `alter role app_user bypassrls`)

  // A staff request: transaction + SET LOCAL ROLE + user id, exactly as the app will do it.
  await app.query('begin')
  await app.query('set local role authenticated')
  await app.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.hk])
  const inside = await me()
  const uidInside = (await app.query(`select auth.uid() as id`)).rows[0].id
  const logged = await app.query(`insert into public.lost_items
    (property_id, found_area_type, area_label, found_at, found_by, category, description)
    values ($1, 'public_area', 'Lobby', now(), $2, 'clothing', 'Blue scarf') returning id`, [DEMO, U.hk])
  const edit = await app.query(`update public.lost_items set description = 'changed' where id = $1`, [logged.rows[0].id])
  const ledger = await app.query(`delete from public.custody_events`)
  await app.query('commit')
  inside.u === 'authenticated' && inside.uid === U.hk && uidInside === U.hk ? pass('inside the transaction: authenticated, as the housekeeper') : fail('inside: ' + JSON.stringify(inside))
  logged.rows.length === 1 ? pass('housekeeper can log an item through app_user') : fail('log item failed')
  edit.affectedRows === 0 ? pass('housekeeper still cannot edit items directly (trigger + RLS hold)') : fail(`edited ${edit.affectedRows} rows`)
  ledger.affectedRows === 0 ? pass('custody ledger cannot be deleted through app_user') : fail(`deleted ${ledger.affectedRows} ledger rows`)

  const after = await me()
  after.u === 'app_user' && after.uid === null
    ? pass('after COMMIT the connection is back to app_user with no user id (no leak)')
    : fail('leak after commit: ' + JSON.stringify(after))

  await app.query('begin')
  await app.query('set local role authenticated')
  await app.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U.fo])
  await app.query('select 1/0').catch(() => {})
  await app.query('rollback')
  const afterErr = await me()
  afterErr.u === 'app_user' && afterErr.uid === null
    ? pass('after an error and ROLLBACK there is no leak either') : fail('leak after rollback: ' + JSON.stringify(afterErr))

  await app.query('begin')
  await app.query('set local role anon')
  const hotels = (await app.query(`select count(*)::int n from public.public_properties()`)).rows[0].n
  let anonItems = 'allowed'
  await app.query('savepoint s')
  try { await app.query(`select count(*) from public.lost_items`) } catch { anonItems = 'denied'; await app.query('rollback to savepoint s') }
  await app.query('commit')
  hotels >= 1 ? pass('as anon: public_properties() works') : fail('public_properties returned nothing')
  anonItems === 'denied' ? pass('as anon: items cannot be read') : fail('anon read items')

  await app.end()

  // Logged in as auth_service, like Better Auth will be.
  const svc = await connectAs('auth_service')
  const unqualified = await svc.query('select count(*)::int n from users').then(() => 'ok', (e) => e.message)
  unqualified === 'ok' ? pass('auth_service: unqualified "users" resolves to auth.users (search_path)') : fail('auth_service users: ' + unqualified)
  const staffRead = await svc.query('select count(*) from public.staff').then(() => 'allowed', (e) => e.message)
  const staffDenied = /permission denied/.test(staffRead)
  staffDenied ? pass('auth_service cannot read staff (permission denied)') : fail('auth_service staff read: ' + staffRead)
  const asRole = await svc.query('set role authenticated').then(() => 'allowed', (e) => e.message)
  const roleDenied = /permission denied/.test(asRole)
  roleDenied ? pass('auth_service cannot switch to authenticated') : fail('auth_service set role: ' + asRole)
  await svc.end()
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
await close()
process.exit(failures ? 1 : 0)
RETURNLY_FILE_EOF

mkdir -p "$TMP/tests"
cat > "$TMP/tests/migrations-sync.test.mjs" <<'RETURNLY_FILE_EOF'
// Guards the Railway copy of the migrations (db/migrations) against drifting
// from the Supabase originals (supabase/migrations) while both exist.
// Rule: same file names (apart from the Railway-only files listed in
// RAILWAY_ONLY); every shared file byte-identical, except
//   004_photo_storage   → comments only (Supabase Storage setup has no
//                          equivalent in plain Postgres), and
//   008_customer_requests → identical apart from the Railway note at the top
//                          and ONE removed block: the storage.objects upload policy.
// Photo rules move to the app in Phase 5 (see docs/MIGRATION_PLAN.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const SUPA = `${ROOT}supabase/migrations/`
const RAIL = `${ROOT}db/migrations/`
const read = (dir, f) => readFileSync(dir + f, 'utf8')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const sqlLines = (s) => s.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'))

const PHOTO = '20260929000004_photo_storage.sql'
const REQUESTS = '20261013000008_customer_requests.sql'
// The Supabase original of 004 that the empty Railway copy stands in for.
const PHOTO_SHA256 = '63368dea05b796be5f3ad892fd02c87b8d1adfbb455eb0c1949438108fdbea66'
const REMOVED_BLOCK_START = 'drop policy if exists item_photos_upload on storage.objects;\n'
const MARKER = '-- [Railway] Supabase Storage policy item_photos_upload removed here; see note at the top.\n\n'
const NOTE_END = '-- (end of Railway note)\n'
// Migrations that exist only for Railway (Supabase has its own Auth until
// launch). Each must be listed here explicitly and sort after every shared file.
const RAILWAY_ONLY = new Set(['20261022000009_auth_tables.sql', '20261024000010_staff_admin.sql', '20261026000011_sign_in_guard.sql', '20261030000012_hotel_setup.sql'])

test('both folders hold the same migration file names, apart from listed Railway-only files', () => {
  const rail = readdirSync(RAIL).sort()
  const supa = readdirSync(SUPA).sort()
  assert.deepEqual(rail.filter((f) => !RAILWAY_ONLY.has(f)), supa)
  for (const f of RAILWAY_ONLY) {
    assert.ok(rail.includes(f), `${f} is listed as Railway-only but missing from db/migrations`)
    assert.ok(!supa.includes(f), `${f} is listed as Railway-only but also exists in supabase/migrations`)
    assert.ok(supa.every((s) => s < f), `${f} must sort after every shared migration`)
  }
})

test('every migration except 004 and 008 is byte-identical', () => {
  for (const f of readdirSync(SUPA).sort()) {
    if (f === PHOTO || f === REQUESTS) continue
    assert.equal(read(RAIL, f), read(SUPA, f), `${f} differs between db/ and supabase/`)
  }
})

test('004 Railway copy contains no SQL, and the original is unchanged', () => {
  assert.deepEqual(sqlLines(read(RAIL, PHOTO)), [], 'db/migrations 004 must stay comments only')
  assert.equal(sha256(read(SUPA, PHOTO)), PHOTO_SHA256,
    'supabase/migrations 004 changed: re-check what the Railway copy and Phase 5 must cover')
})

test('008 Railway copy = original minus exactly the storage upload policy', () => {
  const original = read(SUPA, REQUESTS)
  const copy = read(RAIL, REQUESTS)

  const start = original.indexOf(REMOVED_BLOCK_START)
  assert.notEqual(start, -1, 'storage block not found in the original')
  assert.equal(original.indexOf(REMOVED_BLOCK_START, start + 1), -1, 'storage block appears twice')
  const end = original.indexOf('  );\n\n', start) + '  );\n\n'.length
  const block = original.slice(start, end)
  assert.match(block, /^drop policy if exists item_photos_upload on storage\.objects;\ncreate policy item_photos_upload on storage\.objects\n/)
  assert.equal(sqlLines(block).length, 15, 'removed block should be the 15-line policy')

  const noteEnd = copy.indexOf(NOTE_END)
  assert.notEqual(noteEnd, -1, 'Railway note missing at the top of the 008 copy')
  assert.ok(copy.slice(0, noteEnd).split('\n').every((l) => l === '' || l.startsWith('--')), 'note must be comments only')
  const body = copy.slice(noteEnd + NOTE_END.length)
  assert.equal(body, original.slice(0, start) + MARKER + original.slice(end))
})

test('no Railway migration touches Supabase Storage', () => {
  for (const f of readdirSync(RAIL)) {
    const hits = sqlLines(read(RAIL, f)).filter((l) => /\bstorage\.(objects|buckets|foldername)\b/.test(l))
    assert.deepEqual(hits, [], `${f} still references Supabase Storage`)
  }
})
RETURNLY_FILE_EOF

EXPECTED_SHA="$TMP/expected.sha"
cat > "$EXPECTED_SHA" <<'RETURNLY_FILE_EOF'
9ee7ac3df823fc45a9b899196940cd24c9d4337521140314e24430e930c386cf db/migrations/20261030000012_hotel_setup.sql
edd04b6ff42c246a5a1a9d2950dd99aa6d8edfeb41ba0a45336e698652d0caec supabase/tests/setup.test.mjs
5a3e505fd9a1b3d68e97265b37b0511a9d5057b94787de37e25b2e01380f2010 db/README.md
e0862f779c92f0ed300ea5f49ba77ac355d3ad1ca1e47fcbdf4a1b29d6e2046e package.json
06f6f643a90b493a52343fd1ea1a5a53ef123550b3aa896cdfe61c7365eaf628 supabase/seed.sql
2fc2fff945dcd9af44a643feaa9b85f3a39fd2de60c5edd9e726674084085ab6 supabase/tests/platform.test.mjs
ee8686f070147ee53a04c91a5f5ee33f93d78a4aa1e3ab65fb7bdb2253cd04df tests/migrations-sync.test.mjs
RETURNLY_FILE_EOF
LOCK_BLOB="d1ab090cb31b2be1cec3e601ce523c1958cd3031"

if [ "$APPLY" = 1 ]; then
  echo "== Branch =="
  git switch -c "$BRANCH" "origin/$BASE"
  echo "== Backup =="
  BK="$(git rev-parse --git-dir)/returnly-backup/setup-s1-$(date +%Y%m%d-%H%M%S)"
  while read -r path _; do
    [ "$path" = package-lock.json ] && continue
    mkdir -p "$BK/$(dirname "$path")"; cp -p -- "$path" "$BK/$path"
  done <<'BACKUP'
db/README.md 348567ae1391c9f8ac2c4f783a8a8013834b6773
package.json a4c0f33ece8f5739b8fdfa48e484f355aa6cc41e
supabase/seed.sql 2d85f27336789285d5916c7b0356f195bdf83b58
supabase/tests/platform.test.mjs 1e001393a75fec8771a5203f58fed0b12d0941b6
tests/migrations-sync.test.mjs 66591c2c44cd2bde8cbfbb7b352a8268dda3ed82
package-lock.json d1ab090cb31b2be1cec3e601ce523c1958cd3031
BACKUP
  ok "Backed up to $BK"
  echo "== Write files =="
  while read -r _ f; do mkdir -p "$(dirname "$f")"; cp -- "$TMP/$f" "$f"; ok "$f"; done < "$EXPECTED_SHA"
fi

echo "== Verify =="
while read -r want path; do
  [ "$(sha "$path")" = "$want" ] || die "$path does not match the tested version — tell Claude"
done < "$EXPECTED_SHA"
ok "All $(wc -l < "$EXPECTED_SHA" | tr -d ' ') files match Claude's tested versions"
[ "$(git hash-object package-lock.json)" = "$LOCK_BLOB" ] || die "package-lock.json changed — this step adds no packages; tell Claude"
ok "package-lock.json unchanged (no new packages)"
[ -d node_modules ] || { echo "  installing packages exactly as locked (npm ci) …"; npm ci --no-audit --no-fund; }
if [ "$APPLY" = 1 ]; then git --no-pager diff --stat HEAD; git status --short; fi

echo "== Checks =="
rm -rf -- "$ROOT/.next"
failed=0
for c in lint typecheck test test:db build; do
  printf '→ npm run %s … ' "$c"; log=$(mktemp)
  if npm run -s "$c" >"$log" 2>&1; then echo PASS; else echo FAIL; failed=1; tail -n 40 "$log"; fi
  grep -hE '^# (tests|pass|fail) ' "$log" | sed 's/^/     /' || true
  rm -f -- "$log"
done

echo
if [ "$failed" = 0 ]; then
  echo "✓ All checks passed on $BRANCH (based on $BASE). Nothing was committed or pushed."
  echo "  CI on the pull request also runs the database checks on real PostgreSQL 18."
else
  echo "✗ Some checks failed (above). Nothing was committed or pushed. Undo: bash $0 --rollback-help"; exit 1
fi