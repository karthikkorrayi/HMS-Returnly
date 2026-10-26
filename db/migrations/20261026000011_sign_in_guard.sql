-- HMS Returnly — sign-in protection (Phase 6, Railway only)
--
-- 1. Wrong-password lock per USERNAME. The per-address limit alone cannot
--    tell staff apart on the hotel Wi-Fi (everyone shares one internet
--    address), so that limit is raised and this table limits guessing per
--    username instead: 10 wrong passwords within 15 minutes lock that
--    username for 15 minutes. Unknown usernames are counted the same way, so
--    the lock reveals nothing about which usernames exist. A manager setting a
--    new password clears the lock.
-- 2. Deactivated staff are refused at sign-in. auth.users.blocked mirrors
--    public.staff.active (kept in step by set_staff_active below); Better
--    Auth refuses to create a session for a blocked login, so a deactivated
--    person never gets a session at all, not even for a moment.
-- Both live in schema auth and are used only by auth_service (sign-in).

do $$
begin
  if not exists (select from pg_roles where rolname = 'auth_service') then
    raise exception 'Role auth_service is missing: re-run db/bootstrap/000_platform.sql first';
  end if;
end $$;

create table auth.sign_in_failures (
  username         text primary key check (length(username) between 1 and 64),
  failures         integer not null check (failures > 0),
  first_failed_at  timestamptz not null,
  locked_until     timestamptz
);
create index sign_in_failures_first_idx on auth.sign_in_failures (first_failed_at);
comment on table auth.sign_in_failures is
  'Wrong passwords per username in the current 15-minute window; locked_until set after 10. Used by auth_service only.';

alter table auth.users add column blocked boolean not null default false;
comment on column auth.users.blocked is
  'True while the staff member is deactivated (mirrors public.staff.active); sign-in refuses blocked logins.';

-- Existing deactivated staff start blocked.
update auth.users u set blocked = true
  from public.staff s
 where s.user_id = u.id and not s.active;

revoke all on auth.sign_in_failures from public;
grant select, insert, update, delete on auth.sign_in_failures to auth_service;

-- Same as migration 010, plus keeping auth.users.blocked in step.
create or replace function public.set_staff_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can change access.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own access.' using errcode = '42501';
  end if;
  update public.staff set active = p_active
  where user_id = p_user_id and property_id = v_property;
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  update auth.users set blocked = not p_active where id = p_user_id;
end;
$$;
