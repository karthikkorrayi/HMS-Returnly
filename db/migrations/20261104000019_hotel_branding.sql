-- Foundora — PR E: hotel branding and hotel addresses (/h/<slug>)
--
-- Additive. Each hotel gets:
--   * slug: its address on Foundora, foundora.co.uk/h/<slug> now and, later,
--     <slug>.foundora.co.uk. Lower-case letters, digits and dashes; names
--     Foundora uses itself (www, app, api, …) can't be taken. Existing hotels
--     get their hotel code in lower case; new hotels the same at setup.
--   * brand_colour: optional, for emails (#RRGGBB). The app also checks it is
--     dark enough for white button text.
--   * brand_intro: optional welcome line in the "report received" email
--     (plain text, up to 300 characters; never HTML).
--   * logo: one JPEG in the photo bucket under <property_id>/brand/<uuid>.jpg,
--     re-encoded and cleaned like item photos. It is public on purpose (guest
--     pages and emails show it), served by the app at /brand/<slug>/logo.
-- Only managers change branding, through the functions below.

alter table public.properties
  add column slug          text,
  add column brand_colour  text check (brand_colour is null or brand_colour ~ '^#[0-9a-f]{6}$'),
  add column brand_intro   text check (brand_intro is null or length(brand_intro) between 1 and 300),
  add column logo_key      text check (logo_key is null or logo_key ~ '^[0-9a-f-]{36}/brand/[0-9a-f-]{36}\.jpg$'),
  add column logo_version  integer not null default 0 check (logo_version >= 0);

create or replace function public._valid_slug(p text)
returns boolean
language sql
immutable
as $$
  select coalesce(p, '') ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'
     and p !~ '--'
     and p not in ('www', 'app', 'api', 'admin', 'notify', 'mail', 'news', 'staging', 'status', 'h',
                   'found', 'track', 'login', 'signin', 'setup', 'brand', 'help', 'support', 'foundora')
$$;
revoke all on function public._valid_slug(text) from public, anon, authenticated;

-- A hotel code that happens to be a reserved word (e.g. APP) gets "-hotel".
create or replace function public._slug_for_code(p_code text)
returns text
language sql
immutable
as $$
  select case when public._valid_slug(lower(p_code)) then lower(p_code) else lower(p_code) || '-hotel' end
$$;
revoke all on function public._slug_for_code(text) from public, anon, authenticated;

update public.properties set slug = public._slug_for_code(inn_code) where slug is null;

-- New hotels (first-time setup) get their code in lower case (see above).
create or replace function public._default_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null then
    new.slug := public._slug_for_code(new.inn_code);
  end if;
  return new;
end;
$$;
create trigger properties_default_slug
  before insert on public.properties
  for each row execute function public._default_slug();

alter table public.properties alter column slug set not null;
alter table public.properties
  add constraint properties_slug_valid check (public._valid_slug(slug)),
  add constraint properties_slug_unique unique (slug);

-- Managers: address, colour and welcome line.
create or replace function public.update_hotel_branding(p_slug text, p_colour text, p_intro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_colour text := nullif(lower(trim(coalesce(p_colour, ''))), '');
  v_intro text := nullif(trim(coalesce(p_intro, '')), '');
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can change the hotel’s branding.' using errcode = '42501';
  end if;
  if not public._valid_slug(v_slug) then
    raise exception 'Web address: 3–40 lower-case letters, digits or dashes (not at the start or end), and not a reserved word.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.properties where slug = v_slug and id <> v_property) then
    raise exception 'That web address is already used by another hotel.' using errcode = 'P0001';
  end if;
  if v_colour is not null and v_colour !~ '^#[0-9a-f]{6}$' then
    raise exception 'Colour: use the form #1A2B3C.' using errcode = 'P0001';
  end if;
  if v_intro is not null and length(v_intro) > 300 then
    raise exception 'Welcome line: up to 300 characters.' using errcode = 'P0001';
  end if;
  update public.properties set slug = v_slug, brand_colour = v_colour, brand_intro = v_intro where id = v_property;
end;
$$;
revoke all on function public.update_hotel_branding(text, text, text) from public, anon;
grant execute on function public.update_hotel_branding(text, text, text) to authenticated;

-- Managers: point the hotel at a newly stored logo (or none). Returns the
-- previous key so the app can delete the old file.
create or replace function public.set_hotel_logo(p_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_old text;
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can change the hotel’s logo.' using errcode = '42501';
  end if;
  if p_key is not null and p_key !~ ('^' || v_property::text || '/brand/[0-9a-f-]{36}\.jpg$') then
    raise exception 'Unknown logo.' using errcode = '22023';
  end if;
  select logo_key into v_old from public.properties where id = v_property for update;
  update public.properties set logo_key = p_key, logo_version = logo_version + 1 where id = v_property;
  return v_old;
end;
$$;
revoke all on function public.set_hotel_logo(text) from public, anon;
grant execute on function public.set_hotel_logo(text) to authenticated;

-- Guests (no sign-in): the hotels with their public branding. Nothing else.
create or replace function public.public_hotels()
returns table (inn_code text, name text, slug text, brand_colour text, has_logo boolean, logo_version integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.inn_code, p.name, p.slug, p.brand_colour, p.logo_key is not null, p.logo_version
    from public.properties p order by p.name
$$;
revoke all on function public.public_hotels() from public, authenticated;
grant execute on function public.public_hotels() to anon;

-- The logo file to serve for /brand/<slug>/logo (null when there is none).
create or replace function public.public_hotel_logo(p_slug text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select logo_key from public.properties where slug = lower(trim(coalesce(p_slug, '')))
$$;
revoke all on function public.public_hotel_logo(text) from public, authenticated;
grant execute on function public.public_hotel_logo(text) to anon;
