-- HMS Returnly — core schema
-- Hotel lost & found: housekeeping logs items, front office matches them to a
-- reservation reference and records how each item left the building.
--
-- Privacy rule for this schema: NO guest names, emails or phone numbers.
-- Guests are referenced only by the PMS reservation/confirmation number;
-- contacting them happens in the PMS, outside this app.


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('housekeeping', 'front_office', 'manager');

-- standard  = clothing, chargers, toiletries…
-- valuable  = phones, laptops, jewellery, cash → secure storage + witness at handover
-- sensitive = passports, ID, bank cards, medication → secure storage, witness, NO photos
create type public.value_tier as enum ('standard', 'valuable', 'sensitive');

create type public.item_status as enum (
  'logged',               -- just recorded by housekeeping
  'stored',               -- placed in a storage location
  'matched',              -- a reservation has been confirmed as the likely owner
  'guest_contacted',      -- front office reached the guest (via the PMS)
  'awaiting_collection',  -- guest will collect in person
  'awaiting_shipping',    -- guest asked for it to be posted
  'returned',             -- terminal: handed over or shipped
  'disposed',             -- terminal: destroyed after retention period
  'donated'               -- terminal: donated after retention period
);

create type public.handover_method as enum ('in_person', 'courier', 'disposed', 'donated');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.properties (
  id              uuid primary key default gen_random_uuid(),
  inn_code        text not null unique check (inn_code ~ '^[A-Z0-9]{3,10}$'),
  name            text not null,
  retention_days  integer not null default 90 check (retention_days between 7 and 730),
  created_at      timestamptz not null default now()
);

create table public.staff (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  property_id   uuid not null references public.properties (id),
  username      text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name  text not null check (length(trim(display_name)) between 1 and 80),
  role          public.staff_role not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index staff_property_idx on public.staff (property_id);

create table public.rooms (
  property_id   uuid not null references public.properties (id) on delete cascade,
  room_number   text not null check (room_number ~ '^[A-Za-z0-9-]{1,10}$'),
  floor         text,
  primary key (property_id, room_number)
);

create table public.storage_locations (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete cascade,
  label         text not null check (length(trim(label)) between 1 and 60),
  is_secure     boolean not null default false,
  active        boolean not null default true,
  unique (property_id, label)
);

-- ---------------------------------------------------------------------------
-- Lost items
-- ---------------------------------------------------------------------------
create sequence public.lost_item_code_seq;

create table public.lost_items (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties (id),
  item_code            text not null unique,  -- set by trigger: DEMO-260929-0042
  found_area_type      text not null check (found_area_type in ('room', 'public_area')),
  room_number          text,
  area_label           text check (area_label is null or length(trim(area_label)) between 1 and 60),
  found_at             timestamptz not null,
  found_by             uuid not null references public.staff (user_id),
  category             text not null check (category in (
                         'electronics', 'chargers_cables', 'clothing', 'shoes', 'bags',
                         'jewellery_watches', 'documents_cards', 'cash_wallets',
                         'toiletries', 'medication', 'toys', 'books', 'other')),
  description          text not null check (length(trim(description)) between 3 and 500),
  brand                text check (brand is null or length(brand) <= 60),
  colour               text check (colour is null or length(colour) <= 40),
  value_tier           public.value_tier not null default 'standard',
  status               public.item_status not null default 'logged',
  storage_location_id  uuid references public.storage_locations (id),
  dispose_after        date not null,          -- set by trigger from property retention
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint room_required_for_rooms
    check (found_area_type <> 'room' or room_number is not null),
  constraint area_required_for_public
    check (found_area_type <> 'public_area' or (area_label is not null and room_number is null)),
  constraint room_exists
    foreign key (property_id, room_number) references public.rooms (property_id, room_number),
  constraint found_not_in_future
    check (found_at <= created_at + interval '5 minutes')
);

create index lost_items_property_status_idx on public.lost_items (property_id, status);
create index lost_items_property_found_idx  on public.lost_items (property_id, found_at desc);
create index lost_items_room_idx            on public.lost_items (property_id, room_number);

create table public.item_photos (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.lost_items (id) on delete cascade,
  storage_path  text not null unique,   -- {property_id}/{item_id}/{uuid}.jpg in bucket item-photos
  uploaded_by   uuid not null references public.staff (user_id),
  uploaded_at   timestamptz not null default now()
);
create index item_photos_item_idx on public.item_photos (item_id);

-- The "estimated guest" is a list of candidate reservations, not a single link.
create table public.guest_candidates (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.lost_items (id) on delete cascade,
  reservation_ref  text not null check (reservation_ref ~ '^[A-Za-z0-9-]{3,32}$'),
  departure_date   date,
  added_by         uuid not null references public.staff (user_id),
  added_at         timestamptz not null default now(),
  confirmed        boolean not null default false,
  confirmed_by     uuid references public.staff (user_id),
  confirmed_at     timestamptz,
  note             text check (note is null or length(note) <= 300),
  unique (item_id, reservation_ref)
);
create unique index guest_candidates_one_confirmed
  on public.guest_candidates (item_id) where confirmed;

-- Append-only chain of custody.
create table public.custody_events (
  id                   bigint generated always as identity primary key,
  item_id              uuid not null references public.lost_items (id) on delete cascade,
  from_status          public.item_status,
  to_status            public.item_status not null,
  storage_location_id  uuid references public.storage_locations (id),
  actor                uuid not null references public.staff (user_id),
  note                 text check (note is null or length(note) <= 500),
  created_at           timestamptz not null default now()
);
create index custody_events_item_idx on public.custody_events (item_id, created_at);

-- How the item left the building (one per item).
create table public.handovers (
  item_id           uuid primary key references public.lost_items (id) on delete cascade,
  method            public.handover_method not null,
  id_checked        boolean,          -- that ID was checked — never the ID number itself
  courier_tracking  text check (courier_tracking is null or length(courier_tracking) <= 64),
  handed_over_by    uuid not null references public.staff (user_id),
  witness           uuid references public.staff (user_id),
  note              text check (note is null or length(note) <= 500),
  handed_over_at    timestamptz not null default now(),

  constraint in_person_needs_id_check
    check (method <> 'in_person' or id_checked is true),
  constraint courier_needs_tracking
    check (method <> 'courier' or courier_tracking is not null),
  constraint witness_is_someone_else
    check (witness is null or witness <> handed_over_by)
);

-- ---------------------------------------------------------------------------
-- Triggers: item code, retention date, updated_at, first custody event
-- ---------------------------------------------------------------------------
create or replace function public.lost_items_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.properties;
begin
  select * into p from public.properties where id = new.property_id;
  if not found then
    raise exception 'Unknown property';
  end if;

  new.item_code := p.inn_code || '-' || to_char(new.found_at at time zone 'Europe/London', 'YYMMDD')
                   || '-' || lpad(nextval('public.lost_item_code_seq')::text, 4, '0');
  new.dispose_after := (new.found_at at time zone 'Europe/London')::date + p.retention_days;
  new.status := 'logged';
  new.storage_location_id := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger lost_items_before_insert
  before insert on public.lost_items
  for each row execute function public.lost_items_before_insert();

create or replace function public.lost_items_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.custody_events (item_id, from_status, to_status, actor, note)
  values (new.id, null, 'logged', new.found_by, 'Item logged');
  return new;
end;
$$;

create trigger lost_items_after_insert
  after insert on public.lost_items
  for each row execute function public.lost_items_after_insert();

-- Clients may edit descriptive fields only. Status, storage, tier, ownership
-- and dates change exclusively through the workflow functions (which run as
-- the table owner, not as the `authenticated` role).
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
  ) then
    raise exception 'These fields can only be changed through the item workflow';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger lost_items_guard_update
  before update on public.lost_items
  for each row execute function public.lost_items_guard_update();
