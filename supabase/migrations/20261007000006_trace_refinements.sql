-- HMS Returnly — refinements to stays, room checks and tracing
--
--  * Overdue room checks: a departure not checked within check_due_hours
--    shows as check_overdue on the room board, so a skipped check is visible
--    instead of silently looking like "not yet".
--  * Guests who leave without checking out: an in-house stay past its
--    check-out date no longer counts as "guest in the room" when tracing.
--  * Where in the room: found_spot + spot_hidden on items. A clean check
--    weighs less against a guest when the item was somewhere a quick check
--    would miss (under the bed, behind furniture).
--  * Stay history: every create/change/check-out/cancel of a stay is logged
--    (who, when, what changed) so corrections can't silently move ownership.
--  * Settings: managers change trace window, retention and check deadline.

-- ---------------------------------------------------------------------------
-- Settings and new item fields
-- ---------------------------------------------------------------------------
alter table public.properties
  add column check_due_hours integer not null default 4
    check (check_due_hours between 1 and 48);

alter table public.lost_items
  add column found_spot  text check (found_spot is null or length(trim(found_spot)) between 1 and 80),
  add column spot_hidden boolean not null default false;

-- ---------------------------------------------------------------------------
-- Stay history (never includes the guest surname)
-- ---------------------------------------------------------------------------
create table public.stay_changes (
  id           bigint generated always as identity primary key,
  stay_id      uuid not null references public.stays (id) on delete cascade,
  property_id  uuid not null references public.properties (id) on delete cascade,
  change       text not null check (change in ('created', 'updated', 'checked_out', 'cancelled')),
  old_values   jsonb,
  new_values   jsonb not null,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
create index stay_changes_stay_idx on public.stay_changes (stay_id, changed_at);

create or replace function public._stay_snapshot(s public.stays)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'room_number', s.room_number,
    'reservation_ref', s.reservation_ref,
    'check_in_date', s.check_in_date,
    'check_out_date', s.check_out_date,
    'checked_out_at', s.checked_out_at,
    'status', s.status,
    'source', s.source)
$$;

create or replace function public.stays_log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb := public._stay_snapshot(new);
  v_change text;
begin
  if tg_op = 'INSERT' then
    v_change := 'created';
  else
    v_old := public._stay_snapshot(old);
    if v_old = v_new then
      return new;                       -- e.g. only the surname was filled in
    end if;
    v_change := case
      when new.status = 'departed'  and old.status <> 'departed'  then 'checked_out'
      when new.status = 'cancelled' and old.status <> 'cancelled' then 'cancelled'
      else 'updated'
    end;
  end if;

  insert into public.stay_changes (stay_id, property_id, change, old_values, new_values, changed_by)
  values (new.id, new.property_id, v_change, v_old, v_new, auth.uid());
  return new;
end;
$$;

create trigger stays_log_change
  after insert or update on public.stays
  for each row execute function public.stays_log_change();

alter table public.stay_changes enable row level security;
revoke all on public.stay_changes from anon, authenticated;
grant select on public.stay_changes to authenticated;

create policy stay_changes_select on public.stay_changes
  for select to authenticated
  using (property_id = public.current_property_id()
         and public.has_role('{front_office,manager}'));

revoke all on function public._stay_snapshot(public.stays) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Room board: adds check_overdue
-- ---------------------------------------------------------------------------
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
  p public.properties;
  today date := (now() at time zone 'Europe/London')::date;
begin
  select * into p from public.properties where id = s.property_id;

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
      when ld.id is not null and (lc.checked_at is null or lc.checked_at < ld.checked_out_at)
           and ld.checked_out_at < now() - make_interval(hours => p.check_due_hours) then 'check_overdue'
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

-- ---------------------------------------------------------------------------
-- Tracing: overdue in-house stays, hidden spots
-- ---------------------------------------------------------------------------
-- Score (highest first; staff decide):
--   98  item found during the departure check that followed this stay
--   95  guest was in the room when the item was found
--   90  otherwise, minus 20 per later stay before the find, minus 25 per
--       clean check since this guest left (10 if the item was in a hidden
--       spot a quick check would miss), minimum 5
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
  v_found_day date;
  v_penalty integer;
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
  v_found_day := (i.found_at at time zone 'Europe/London')::date;
  v_penalty := case when i.spot_hidden then 10 else 25 end;

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
      (c.status = 'in_house' and c.check_out_date >= v_found_day)
        or (c.status = 'departed' and c.eff_out > i.found_at) as in_room,
      (c.status = 'in_house' and c.check_out_date < v_found_day) as overdue_in_house,
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
      else greatest(5, 90 - 20 * sc.later_stays - v_penalty * sc.clean_checks)
    end,
    array_remove(array[
      case when sc.found_on_departure_check then 'Found during the room check after this guest left' end,
      case when sc.in_room and not sc.found_on_departure_check
           then 'Guest is checked in to this room — return it to them, it may not be lost' end,
      case when sc.overdue_in_house
           then 'Still marked in house but past the check-out date — may have left without checking out' end,
      case when not sc.in_room and not sc.found_on_departure_check and sc.later_stays = 0
           then 'Last guest in the room before it was found' end,
      case when not sc.found_on_departure_check and sc.later_stays > 0
           then sc.later_stays || ' later stay(s) before it was found' end,
      case when not sc.found_on_departure_check and sc.clean_checks > 0
           then 'Room checked clean ' || sc.clean_checks || ' time(s) since this guest left'
                || case when i.spot_hidden then ' (item was in a hidden spot, so this counts for less)' else '' end end,
      case when not sc.in_room and not sc.found_on_departure_check
           then 'Left ' || greatest(0, (v_found_day - sc.eff_out::date)) || ' day(s) before it was found' end
    ], null)
  from scored sc
  order by 5 desc, sc.eff_out desc
  limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings (managers)
-- ---------------------------------------------------------------------------
create or replace function public.update_property_settings(
  p_trace_window_days    integer,
  p_stay_retention_days  integer,
  p_check_due_hours      integer,
  p_retention_days       integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
begin
  if s.role <> 'manager' then
    raise exception 'Only managers can change settings' using errcode = '42501';
  end if;
  update public.properties set
    trace_window_days   = p_trace_window_days,
    stay_retention_days = p_stay_retention_days,
    check_due_hours     = p_check_due_hours,
    retention_days      = p_retention_days
  where id = s.property_id;
end;
$$;

revoke all on function public.update_property_settings(integer, integer, integer, integer) from public, anon;
grant execute on function public.update_property_settings(integer, integer, integer, integer) to authenticated;
