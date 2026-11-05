-- Optional dark-mode branding. All writes remain manager-only and hotel-scoped.
alter table public.properties add column dark_logo_key text
  check (dark_logo_key is null or dark_logo_key ~ '^[0-9a-f-]{36}/brand/[0-9a-f-]{36}\.jpg$');
create or replace function public.set_hotel_dark_logo(p_key text)
returns text language plpgsql security definer set search_path = public as $$
declare v_property uuid := public.current_property_id(); v_old text;
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can change the hotel’s logo.' using errcode = '42501';
  end if;
  if p_key is not null and p_key !~ ('^' || v_property::text || '/brand/[0-9a-f-]{36}\.jpg$') then
    raise exception 'Unknown logo.' using errcode = '22023';
  end if;
  select dark_logo_key into v_old from public.properties where id = v_property for update;
  update public.properties set dark_logo_key = p_key, logo_version = logo_version + 1 where id = v_property;
  return v_old;
end;
$$;
revoke all on function public.set_hotel_dark_logo(text) from public, anon;
grant execute on function public.set_hotel_dark_logo(text) to authenticated;
create or replace function public.public_hotel_dark_logo(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(dark_logo_key, logo_key) from public.properties
   where slug = lower(trim(coalesce(p_slug, '')))
$$;
revoke all on function public.public_hotel_dark_logo(text) from public, authenticated;
grant execute on function public.public_hotel_dark_logo(text) to anon;

-- A dark-only upload is still available as a default on a neutral plate.
create or replace function public.public_hotel_logo(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(logo_key, dark_logo_key) from public.properties
   where slug = lower(trim(coalesce(p_slug, '')))
$$;
revoke all on function public.public_hotel_logo(text) from public, authenticated;
grant execute on function public.public_hotel_logo(text) to anon;
create or replace function public.public_hotels()
returns table (inn_code text, name text, slug text, brand_colour text, has_logo boolean, logo_version integer)
language sql stable security definer set search_path = public as $$
  select p.inn_code, p.name, p.slug, p.brand_colour,
         p.logo_key is not null or p.dark_logo_key is not null, p.logo_version
    from public.properties p order by p.name
$$;
revoke all on function public.public_hotels() from public, authenticated;
grant execute on function public.public_hotels() to anon;
