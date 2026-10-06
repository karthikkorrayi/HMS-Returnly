-- HMS Returnly — stay log, room checks and ownership tracing
--
-- Bridges the gap until the PMS can be connected: front desk records who
-- stayed in which room (by hand or by importing the PMS arrivals/departures
-- export), housekeeping records a check of every room after departure, and
-- any found item can be traced back to the stays most likely to own it.
--
-- Privacy:
--   * guest_surname is never readable through the API (no column grant). It
--     exists only so a guest can later prove a booking with
--     confirmation number + surname, checked inside a security-definer
--     function.
--   * Housekeeping never sees stays directly — only the room board, which
--     shows room status without guest details.
--   * Stays are purged after properties.stay_retention_days.

-- ---------------------------------------------------------------------------
-- Per-hotel settings
-- ---------------------------------------------------------------------------
alter table public.properties
  add column trace_window_days    integer not null default 45
    check (trace_window_days between 7 and 120),
  add column stay_retention_days  integer not null default 180
    check (stay_retention_days between 30 and 730),
  add constraint stay_retention_covers_trace
    check (stay_retention_days >= trace_window_days);

-- ---------------------------------------------------------------------------
-- Stays
-- ---------------------------------------------------------------------------
create type public.stay_status as enum ('in_house', 'departed', 'cancelled');
create type public.stay_source as enum ('manual', 'import', 'pms');

create table public.stays (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.properties (id) on delete cascade,
  room_number      text not null,
  reservation_ref  text not null check (reservation_ref ~ '^[A-Z0-9-]{3,32}$'),
  guest_surname    text check (guest_surname is null or length(guest_surname) between 1 and 80),
  check_in_date    date not null,
  check_out_date   date not null,
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  status           public.stay_status not null default 'in_house',
  source           public.stay_source not null default 'manual',
  note             text check (note is null or length(note) <= 300),
  created_by       uuid references public.staff (user_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint stay_room_exists
    foreign key (property_id, room_number) references public.rooms (property_id, room_number),
  constraint stay_dates_in_order check (check_out_date >= check_in_date),
  constraint stay_one_row_per_room unique (property_id, reservation_ref, room_number),
  constraint departed_has_checkout_time check (status <> 'departed' or checked_out_at is not null)
);
create index stays_room_dates_idx on public.stays (property_id, room_number, check_in_date, check_out_date);
create index stays_in_house_idx   on public.stays (property_id, room_number) where status = 'in_house';

-- When the guest was (or is expected to be) in the room. Exact timestamps
-- when recorded; otherwise standard 15:00 arrival / 11:00 departure, hotel time.
create or replace function public.stay_effective_in(s public.stays)
returns timestamptz
language sql
stable
as $$
  select coalesce(s.checked_in_at, (s.check_in_date + time '15:00') at time zone 'Europe/London')
$$;

create or replace function public.stay_effective_out(s public.stays)
returns timestamptz
language sql
stable
as $$
  select coalesce(s.checked_out_at, (s.check_out_date + time '11:00') at time zone 'Europe/London')
$$;

-- ---------------------------------------------------------------------------
-- Room checks
-- ---------------------------------------------------------------------------
create type public.room_check_type as enum ('departure', 'recheck', 'deep_clean');
create type public.room_check_outcome as enum ('clean', 'items_found');

create table public.room_checks (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete cascade,
  room_number   text not null,
  stay_id       uuid references public.stays (id) on delete set null,
  check_type    public.room_check_type not null default 'departure',
  outcome       public.room_check_outcome not null,
  checked_by    uuid not null references public.staff (user_id),
  checked_at    timestamptz not null default now(),
  note          text check (note is null or length(note) <= 300),

  constraint room_check_room_exists
    foreign key (property_id, room_number) references public.rooms (property_id, room_number)
);
create index room_checks_room_idx on public.room_checks (property_id, room_number, checked_at desc);
-- One departure check per stay; corrections are rechecks.
create unique index room_checks_one_departure_per_stay
  on public.room_checks (stay_id) where check_type = 'departure' and stay_id is not null;

-- ---------------------------------------------------------------------------
-- Links from existing tables
-- ---------------------------------------------------------------------------
alter table public.lost_items
  add column room_check_id uuid references public.room_checks (id);

alter table public.guest_candidates
  add column stay_id uuid references public.stays (id) on delete set null;

-- An item logged against a room check must be in that room, at that hotel,
-- and the check must have recorded items_found.
create or replace function public.lost_items_check_room_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.room_checks;
begin
  if new.room_check_id is null then
    return new;
  end if;
  select * into c from public.room_checks where id = new.room_check_id;
  if not found
     or c.property_id <> new.property_id
     or new.found_area_type <> 'room'
     or c.room_number <> new.room_number then
    raise exception 'Room check does not match this item''s room';
  end if;
  if c.outcome <> 'items_found' then
    raise exception 'That room check was recorded as clean — record a recheck with items found';
  end if;
  return new;
end;
$$;

create trigger lost_items_check_room_check
  before insert on public.lost_items
  for each row execute function public.lost_items_check_room_check();

-- room_check_id joins the fields only the workflow may change.
create or replace function public.lost_items_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.status              is distinct from old.status
    or new.storage_location_id is distinct from old.storage_location_id
    or new.value_tier          is distinct from old.value_tier
    or new.property_id         is distinct from old.property_id
    or new.item_code           is distinct from old.item_code
    or new.found_by            is distinct from old.found_by
    or new.found_at            is distinct from old.found_at
    or new.dispose_after       is distinct from old.dispose_after
    or new.created_at          is distinct from old.created_at
    or new.room_check_id       is distinct from old.room_check_id
  ) then
    raise exception 'These fields can only be changed through the item workflow';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: reads under RLS, every write through the functions below
-- ---------------------------------------------------------------------------
alter table public.stays       enable row level security;
alter table public.room_checks enable row level security;

revoke all on public.stays, public.room_checks from anon, authenticated;

-- Front office and managers read stays — every column except guest_surname.
grant select (id, property_id, room_number, reservation_ref, check_in_date, check_out_date,
              checked_in_at, checked_out_at, status, source, note, created_by, created_at, updated_at)
  on public.stays to authenticated;

create policy stays_select on public.stays
  for select to authenticated
  using (property_id = public.current_property_id()
         and public.has_role('{front_office,manager}'));

grant select on public.room_checks to authenticated;

create policy room_checks_select on public.room_checks
  for select to authenticated
  using (property_id = public.current_property_id());

-- ---------------------------------------------------------------------------
-- Internal: validate and save one stay (used by check-in and import)
-- ---------------------------------------------------------------------------
create or replace function public._normalise_surname(p text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

create or replace function public._save_stay(
  p_property_id      uuid,
  p_actor            uuid,
  p_source           public.stay_source,
  p_room_number      text,
  p_reservation_ref  text,
  p_surname          text,
  p_check_in_date    date,
  p_check_out_date   date,
  p_status           public.stay_status,
  p_checked_in_at    timestamptz,
  p_checked_out_at   timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref   text := upper(regexp_replace(coalesce(p_reservation_ref, ''), '\s+', '', 'g'));
  v_room  text;
  v_id    uuid;
begin
  select room_number into v_room from public.rooms
  where property_id = p_property_id and upper(room_number) = upper(trim(p_room_number));
  if v_room is null then
    raise exception 'Room % is not on this hotel''s room list', p_room_number;
  end if;
  if p_check_in_date is null or p_check_out_date is null then
    raise exception 'Check-in and check-out dates are required';
  end if;
  if p_status = 'departed' and p_checked_out_at is null then
    p_checked_out_at := (p_check_out_date + time '11:00') at time zone 'Europe/London';
  end if;

  select id into v_id from public.stays
  where property_id = p_property_id and reservation_ref = v_ref and room_number = v_room;

  -- Two live stays can't share a room on the same night (same-day turnover is fine).
  if p_status <> 'cancelled' and exists (
    select 1 from public.stays s
    where s.property_id = p_property_id
      and s.room_number = v_room
      and s.status <> 'cancelled'
      and s.id is distinct from v_id
      and daterange(s.check_in_date, s.check_out_date, '[)')
          && daterange(p_check_in_date, p_check_out_date, '[)')
  ) then
    raise exception 'Room % already has a stay overlapping % to %', v_room, p_check_in_date, p_check_out_date;
  end if;

  if v_id is null then
    insert into public.stays
      (property_id, room_number, reservation_ref, guest_surname, check_in_date, check_out_date,
       checked_in_at, checked_out_at, status, source, created_by)
    values
      (p_property_id, v_room, v_ref, nullif(trim(p_surname), ''), p_check_in_date, p_check_out_date,
       p_checked_in_at, p_checked_out_at, p_status, p_source, p_actor)
    returning id into v_id;
  else
    update public.stays set
      guest_surname  = coalesce(nullif(trim(p_surname), ''), guest_surname),
      check_in_date  = p_check_in_date,
      check_out_date = p_check_out_date,
      checked_in_at  = coalesce(p_checked_in_at, checked_in_at),
      checked_out_at = coalesce(p_checked_out_at, checked_out_at),
      status         = p_status,
      source         = p_source,
      updated_at     = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public._normalise_surname(text) from public, anon, authenticated;
revoke all on function public._save_stay(uuid, uuid, public.stay_source, text, text, text, date, date,
  public.stay_status, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Front desk API
-- ---------------------------------------------------------------------------
create or replace function public.check_in_guest(
  p_room_number      text,
  p_reservation_ref  text,
  p_guest_surname    text,
  p_check_out_date   date,
  p_check_in_date    date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  v_in date := coalesce(p_check_in_date, (now() at time zone 'Europe/London')::date);
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can check guests in' using errcode = '42501';
  end if;
  if public._normalise_surname(p_guest_surname) is null then
    raise exception 'Enter the guest''s surname as it appears on the booking';
  end if;
  if exists (select 1 from public.stays
             where property_id = s.property_id and status = 'in_house'
               and upper(room_number) = upper(trim(p_room_number))) then
    raise exception 'Room % still has a guest in house — check them out first', p_room_number;
  end if;
  return public._save_stay(s.property_id, s.user_id, 'manual', p_room_number, p_reservation_ref,
                           p_guest_surname, v_in, p_check_out_date, 'in_house', now(), null);
end;
$$;

-- Records the actual departure. Early departures move check_out_date forward.
create or replace function public.check_out_guest(p_stay_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  v public.stays;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can check guests out' using errcode = '42501';
  end if;
  select * into v from public.stays where id = p_stay_id and property_id = s.property_id for update;
  if not found then
    raise exception 'Stay not found' using errcode = 'P0002';
  end if;
  if v.status <> 'in_house' then
    raise exception 'This stay is already %', v.status;
  end if;
  update public.stays
     set status = 'departed',
         checked_out_at = now(),
         check_out_date = least(check_out_date, greatest(check_in_date, (now() at time zone 'Europe/London')::date)),
         updated_at = now()
   where id = v.id;
end;
$$;

create or replace function public.cancel_stay(p_stay_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can cancel stays' using errcode = '42501';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'Say why the stay is being cancelled';
  end if;
  update public.stays
     set status = 'cancelled', note = left(trim(p_note), 300), updated_at = now()
   where id = p_stay_id and property_id = s.property_id;
  if not found then
    raise exception 'Stay not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Bulk load from the PMS arrivals/in-house/departures export (CSV → JSON
-- array). Each row: room_number, reservation_ref, guest_surname,
-- check_in_date, check_out_date, status ('in_house' | 'departed' |
-- 'cancelled'), optional checked_out_at. Re-importing the same file is safe:
-- rows are matched on reservation_ref + room. Bad rows are reported, not fatal.
create or replace function public.import_stays(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r jsonb;
  i integer := 0;
  saved integer := 0;
  errors jsonb := '[]'::jsonb;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can import stays' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of rows';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2000 rows at a time';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      perform public._save_stay(
        s.property_id, s.user_id, 'import',
        r->>'room_number', r->>'reservation_ref', r->>'guest_surname',
        (r->>'check_in_date')::date, (r->>'check_out_date')::date,
        coalesce(nullif(r->>'status', ''), 'in_house')::public.stay_status,
        null, nullif(r->>'checked_out_at', '')::timestamptz);
      saved := saved + 1;
    exception when others then
      errors := errors || jsonb_build_object('row', i, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('saved', saved, 'failed', jsonb_array_length(errors), 'errors', errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping API
-- ---------------------------------------------------------------------------

-- Live status of every room, with no guest details:
--   occupied     guest in house
--   due_out      guest in house, due to leave today or overdue
--   needs_check  last guest has left and nobody has checked the room since
--   ready        checked since the last departure (or never occupied)
create or replace function public.room_board()
returns table (
  room_number        text,
  floor              text,
  status             text,
  stay_id            uuid,
  departed_at        timestamptz,
  last_checked_at    timestamptz,
  last_check_outcome public.room_check_outcome)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s public.staff := public._require_staff();
  today date := (now() at time zone 'Europe/London')::date;
begin
  return query
  with last_departure as (
    select distinct on (st.room_number) st.room_number, st.id, st.checked_out_at
    from public.stays st
    where st.property_id = s.property_id and st.status = 'departed'
    order by st.room_number, st.checked_out_at desc
  ),
  in_house as (
    select distinct on (st.room_number) st.room_number, st.id, st.check_out_date
    from public.stays st
    where st.property_id = s.property_id and st.status = 'in_house'
    order by st.room_number, st.check_in_date desc
  ),
  last_check as (
    select distinct on (c.room_number) c.room_number, c.checked_at, c.outcome
    from public.room_checks c
    where c.property_id = s.property_id
    order by c.room_number, c.checked_at desc
  )
  select
    r.room_number,
    r.floor,
    case
      when ih.id is not null and ih.check_out_date <= today then 'due_out'
      when ih.id is not null then 'occupied'
      when ld.id is not null and (lc.checked_at is null or lc.checked_at < ld.checked_out_at) then 'needs_check'
      else 'ready'
    end,
    case when ih.id is not null then ih.id else ld.id end,
    ld.checked_out_at,
    lc.checked_at,
    lc.outcome
  from public.rooms r
  left join in_house ih       on ih.room_number = r.room_number
  left join last_departure ld on ld.room_number = r.room_number
  left join last_check lc     on lc.room_number = r.room_number
  where r.property_id = s.property_id
  order by r.room_number;
end;
$$;

-- Records a room check. For a departure check with no stay given, links the
-- room's most recent departure that hasn't been checked yet.
-- If the outcome is items_found, log each item with room_check_id = the
-- returned id.
create or replace function public.record_room_check(
  p_room_number  text,
  p_outcome      public.room_check_outcome,
  p_check_type   public.room_check_type default 'departure',
  p_stay_id      uuid default null,
  p_note         text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  v_room text;
  v_stay public.stays;
  v_id uuid;
begin
  select room_number into v_room from public.rooms
  where property_id = s.property_id and upper(room_number) = upper(trim(p_room_number));
  if v_room is null then
    raise exception 'Room % is not on this hotel''s room list', p_room_number;
  end if;

  if p_stay_id is not null then
    select * into v_stay from public.stays
    where id = p_stay_id and property_id = s.property_id and room_number = v_room;
    if not found then
      raise exception 'That stay is not for room %', v_room;
    end if;
    if v_stay.status <> 'departed' then
      raise exception 'Departure checks are for guests who have checked out';
    end if;
  elsif p_check_type = 'departure' then
    select st.* into v_stay from public.stays st
    where st.property_id = s.property_id and st.room_number = v_room and st.status = 'departed'
      and not exists (select 1 from public.room_checks c
                      where c.stay_id = st.id and c.check_type = 'departure')
    order by st.checked_out_at desc
    limit 1;
  end if;

  if p_check_type = 'departure' and v_stay.id is not null
     and exists (select 1 from public.room_checks
                 where stay_id = v_stay.id and check_type = 'departure') then
    raise exception 'Room % was already checked after this departure — record a recheck instead', v_room;
  end if;

  insert into public.room_checks (property_id, room_number, stay_id, check_type, outcome, checked_by, note)
  values (s.property_id, v_room, v_stay.id, p_check_type, p_outcome, s.user_id,
          nullif(left(trim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership tracing
-- ---------------------------------------------------------------------------
-- Ranks the stays in the item's room within the hotel's trace window.
-- Explainable scores, highest first; staff decide. Score:
--   98  item found during the departure check that followed this stay
--   95  guest was in the room when the item was found
--   90  otherwise, then minus 20 per later stay before the find
--       and minus 25 per clean room check since this guest left (min 5)
-- Public-area items return nothing: there is no room to trace.
create or replace function public.trace_item_owners(p_item_id uuid)
returns table (
  stay_id          uuid,
  reservation_ref  text,
  check_in_date    date,
  check_out_date   date,
  score            integer,
  reasons          text[])
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s public.staff := public._require_staff();
  i public.lost_items;
  p public.properties;
  v_check_stay uuid;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can trace owners' using errcode = '42501';
  end if;
  select * into i from public.lost_items where id = p_item_id and property_id = s.property_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if i.found_area_type <> 'room' then
    return;
  end if;
  select * into p from public.properties where id = i.property_id;
  select c.stay_id into v_check_stay from public.room_checks c
  where c.id = i.room_check_id and c.check_type = 'departure';

  return query
  with candidates as (
    select st.*,
           public.stay_effective_in(st)  as eff_in,
           public.stay_effective_out(st) as eff_out
    from public.stays st
    where st.property_id = i.property_id
      and st.room_number = i.room_number
      and st.status <> 'cancelled'
      and public.stay_effective_in(st) <= i.found_at
      and public.stay_effective_out(st) >= i.found_at - make_interval(days => p.trace_window_days)
  ),
  scored as (
    select c.*,
      coalesce(c.id = v_check_stay, false) as found_on_departure_check,
      (c.eff_in <= i.found_at and (c.status = 'in_house' or c.eff_out > i.found_at)) as in_room,
      (select count(*)::int from candidates later
        where later.id <> c.id and later.eff_in >= c.eff_out and later.eff_in <= i.found_at) as later_stays,
      (select count(*)::int from public.room_checks rc
        where rc.property_id = i.property_id and rc.room_number = i.room_number
          and rc.outcome = 'clean'
          and rc.checked_at > c.eff_out and rc.checked_at < i.found_at) as clean_checks
    from candidates c
  )
  select sc.id, sc.reservation_ref, sc.check_in_date, sc.check_out_date,
    case
      when sc.found_on_departure_check then 98
      when sc.in_room then 95
      else greatest(5, 90 - 20 * sc.later_stays - 25 * sc.clean_checks)
    end,
    array_remove(array[
      case when sc.found_on_departure_check then 'Found during the room check after this guest left' end,
      case when sc.in_room and not sc.found_on_departure_check then 'Guest was in the room when it was found' end,
      case when not sc.in_room and not sc.found_on_departure_check and sc.later_stays = 0
           then 'Last guest in the room before it was found' end,
      case when not sc.found_on_departure_check and sc.later_stays > 0
           then sc.later_stays || ' later stay(s) before it was found' end,
      case when not sc.found_on_departure_check and sc.clean_checks > 0
           then 'Room checked clean ' || sc.clean_checks || ' time(s) since this guest left' end,
      case when not sc.in_room and not sc.found_on_departure_check
           then 'Left ' || greatest(0, (i.found_at::date - sc.eff_out::date)) || ' day(s) before it was found' end
    ], null)
  from scored sc
  order by 5 desc, sc.eff_out desc
  limit 20;
end;
$$;

-- Turns a traced stay into a possible owner on the item.
create or replace function public.add_candidate_from_stay(p_item_id uuid, p_stay_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  i public.lost_items;
  v public.stays;
  v_id uuid;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can add possible owners' using errcode = '42501';
  end if;
  select * into i from public.lost_items where id = p_item_id and property_id = s.property_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if i.status in ('returned', 'disposed', 'donated') then
    raise exception 'Item is closed';
  end if;
  select * into v from public.stays where id = p_stay_id and property_id = s.property_id;
  if not found then
    raise exception 'Stay not found' using errcode = 'P0002';
  end if;

  insert into public.guest_candidates (item_id, reservation_ref, departure_date, added_by, note, stay_id)
  values (i.id, v.reservation_ref, v.check_out_date, s.user_id, nullif(left(trim(coalesce(p_note, '')), 300), ''), v.id)
  on conflict (item_id, reservation_ref) do update set stay_id = excluded.stay_id
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention (schedule daily with pg_cron, or run from a scheduled function)
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_stays()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.stays st
  using public.properties p
  where p.id = st.property_id
    and st.status <> 'in_house'
    and st.check_out_date < (now() at time zone 'Europe/London')::date - p.stay_retention_days;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.stay_effective_in(public.stays)  from public, anon;
revoke all on function public.stay_effective_out(public.stays) from public, anon;
revoke all on function public.check_in_guest(text, text, text, date, date) from public, anon;
revoke all on function public.check_out_guest(uuid)                        from public, anon;
revoke all on function public.cancel_stay(uuid, text)                      from public, anon;
revoke all on function public.import_stays(jsonb)                          from public, anon;
revoke all on function public.room_board()                                 from public, anon;
revoke all on function public.record_room_check(text, public.room_check_outcome, public.room_check_type, uuid, text) from public, anon;
revoke all on function public.trace_item_owners(uuid)                      from public, anon;
revoke all on function public.add_candidate_from_stay(uuid, uuid, text)    from public, anon;
revoke all on function public.purge_expired_stays()                        from public, anon, authenticated;

grant execute on function public.check_in_guest(text, text, text, date, date) to authenticated;
grant execute on function public.check_out_guest(uuid)                        to authenticated;
grant execute on function public.cancel_stay(uuid, text)                      to authenticated;
grant execute on function public.import_stays(jsonb)                          to authenticated;
grant execute on function public.room_board()                                 to authenticated;
grant execute on function public.record_room_check(text, public.room_check_outcome, public.room_check_type, uuid, text) to authenticated;
grant execute on function public.trace_item_owners(uuid)                      to authenticated;
grant execute on function public.add_candidate_from_stay(uuid, uuid, text)    to authenticated;
