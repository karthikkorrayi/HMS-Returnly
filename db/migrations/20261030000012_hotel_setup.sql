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
