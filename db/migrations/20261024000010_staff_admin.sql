-- HMS Returnly — staff administration (Railway only)
--
-- On Supabase, a manager's staff changes were written by the server with the
-- service key, which bypasses row-level security: the app's own manager check
-- was the only gate. On Railway the web app has no such key (it runs as
-- authenticated, and public.staff has no insert or update policy), so these
-- two functions are the ONLY way the app can add a staff row or change access.
-- Each one checks, inside the database, that the caller is an active manager
-- and only touches staff of the caller's own hotel.
--
-- Logins themselves (auth.users, passwords, sessions) are written by Better
-- Auth through the auth_service role, never by these functions.

create or replace function public.add_staff_member(
  p_user_id      uuid,
  p_username     text,
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
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can add staff.' using errcode = '42501';
  end if;
  insert into public.staff (user_id, property_id, username, display_name, role)
  values (p_user_id, v_property, lower(trim(p_username)), trim(p_display_name), p_role);
end;
$$;

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
end;
$$;

revoke all on function public.add_staff_member(uuid, text, text, public.staff_role) from public, anon;
revoke all on function public.set_staff_active(uuid, boolean)                       from public, anon;
grant execute on function public.add_staff_member(uuid, text, text, public.staff_role) to authenticated;
grant execute on function public.set_staff_active(uuid, boolean)                       to authenticated;
