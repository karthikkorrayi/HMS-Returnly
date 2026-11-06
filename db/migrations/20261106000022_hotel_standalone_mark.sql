-- Independent standalone mark for the workspace sidebar footer.
alter table public.properties add column mark_logo_key text
 check (mark_logo_key is null or mark_logo_key ~ '^[0-9a-f-]{36}/brand/[0-9a-f-]{36}\.jpg$');
create or replace function public.set_hotel_mark_logo(p_key text)
returns text language plpgsql security definer set search_path = public as $$
declare v_property uuid := public.current_property_id(); v_old text;
begin
 if v_property is null or not public.has_role('{manager}') then
  raise exception 'Only managers can change the hotel’s logo.' using errcode = '42501';
 end if;
 if p_key is not null and p_key !~ ('^' || v_property::text || '/brand/[0-9a-f-]{36}\.jpg$') then
  raise exception 'Unknown logo.' using errcode = '22023';
 end if;
 select mark_logo_key into v_old from public.properties where id = v_property for update;
 update public.properties set mark_logo_key=p_key, logo_version=logo_version+1 where id=v_property;
 return v_old;
end;
$$;
revoke all on function public.set_hotel_mark_logo(text) from public, anon;
grant execute on function public.set_hotel_mark_logo(text) to authenticated;
create or replace function public.public_hotel_mark_logo(p_slug text)
returns text language sql stable security definer set search_path=public as $$
 select mark_logo_key from public.properties where slug=lower(trim(coalesce(p_slug,'')))
$$;
revoke all on function public.public_hotel_mark_logo(text) from public, authenticated;
grant execute on function public.public_hotel_mark_logo(text) to anon;
