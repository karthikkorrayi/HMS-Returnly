-- [Railway copy] Same as supabase/migrations/20261013000008_customer_requests.sql
-- except ONE block: the Supabase Storage policy item_photos_upload (upload rule
-- for the item-photos bucket, which also blocked the Support role). Plain
-- Postgres has no storage.objects table; photo rules move to the app plus a SQL
-- helper in Phase 5, tested against the same cases as supabase/tests/rls.test.mjs.
-- tests/migrations-sync.test.mjs fails if this copy drifts from the original.
-- (end of Railway note)
-- HMS Returnly — customer enquiries, support role permissions
--
-- Customers (not signed in) submit an enquiry from the public home page with
-- their name, booking ID and a description. They get a random reference
-- (LF-XXXXX-XXXXX) and can check status / answer staff questions with
-- reference + booking ID. They never see item records, matches, internal
-- notes or anyone else's enquiry.
--
-- Staff:
--   manager  = Admin: sees every enquiry, assigns, approves/rejects/resolves
--   support  = Support: sees enquiries assigned to them, investigates, adds
--              notes, asks the customer for information, marks ready for
--              admin. Can read items to investigate; cannot change them.
--
-- Matching is a ranked suggestion for staff only. Approval is always an
-- explicit manager action and never releases an item by itself — it adds the
-- booking as a possible owner on the item, and the existing confirm → ID
-- check → handover flow still applies.

-- ---------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------
create type public.request_status as enum (
  'pending_review',       -- new, nobody has looked yet
  'under_investigation',  -- staff are checking records
  'awaiting_customer',    -- staff asked the customer for more information
  'awaiting_admin',       -- support has finished; waiting for an admin decision
  'approved',             -- admin confirmed the match (item return follows the item workflow)
  'rejected',             -- admin decided it isn't a match / can't be verified
  'resolved'              -- closed: item returned, or customer told the outcome
);

alter table public.properties
  add column request_retention_days integer not null default 365
    check (request_retention_days between 30 and 1095);

create table public.customer_requests (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.properties (id) on delete cascade,
  reference         text not null unique,
  customer_name     text not null check (length(trim(customer_name)) between 2 and 80),
  booking_ref       text not null check (booking_ref ~ '^[A-Z0-9-]{3,32}$'),
  item_name         text not null check (length(trim(item_name)) between 2 and 80),
  category          text check (category is null or category in (
                      'electronics', 'chargers_cables', 'clothing', 'shoes', 'bags',
                      'jewellery_watches', 'documents_cards', 'cash_wallets',
                      'toiletries', 'medication', 'toys', 'books', 'other')),
  colour            text check (colour is null or length(colour) <= 40),
  brand             text check (brand is null or length(brand) <= 60),
  description       text not null check (length(trim(description)) between 3 and 1000),
  lost_location     text check (lost_location is null or length(lost_location) <= 80),
  lost_date         date,
  status            public.request_status not null default 'pending_review',
  assigned_to       uuid references public.staff (user_id),
  approved_item_id  uuid references public.lost_items (id),
  decision_note     text check (decision_note is null or length(decision_note) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index customer_requests_property_status_idx on public.customer_requests (property_id, status, created_at desc);
create index customer_requests_assigned_idx        on public.customer_requests (assigned_to) where assigned_to is not null;
create index customer_requests_booking_idx         on public.customer_requests (property_id, booking_ref);

-- What the customer sees: their own messages and messages staff chose to send.
create table public.request_messages (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.customer_requests (id) on delete cascade,
  sender      text not null check (sender in ('customer', 'staff', 'system')),
  author_id   uuid references public.staff (user_id),
  body        text not null check (length(trim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index request_messages_request_idx on public.request_messages (request_id, id);

-- Staff only. Never returned by any customer function.
create table public.request_notes (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.customer_requests (id) on delete cascade,
  author_id   uuid not null references public.staff (user_id),
  body        text not null check (length(trim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index request_notes_request_idx on public.request_notes (request_id, id);

-- Audit trail. actor is null for customer/system actions.
create table public.request_events (
  id           bigint generated always as identity primary key,
  request_id   uuid not null references public.customer_requests (id) on delete cascade,
  actor        uuid references public.staff (user_id),
  action       text not null,
  from_status  public.request_status,
  to_status    public.request_status,
  detail       text,
  created_at   timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, id);

-- ---------------------------------------------------------------------------
-- Access: staff read under RLS; every write goes through the functions below
-- ---------------------------------------------------------------------------
alter table public.customer_requests enable row level security;
alter table public.request_messages  enable row level security;
alter table public.request_notes     enable row level security;
alter table public.request_events    enable row level security;

revoke all on public.customer_requests, public.request_messages,
              public.request_notes, public.request_events from anon, authenticated;
grant select on public.customer_requests, public.request_messages,
                public.request_notes, public.request_events to authenticated;

create or replace function public.can_see_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_requests r
    join public.staff s on s.user_id = auth.uid() and s.active and s.property_id = r.property_id
    where r.id = p_request_id
      and (s.role = 'manager' or (s.role = 'support' and r.assigned_to = s.user_id))
  )
$$;
revoke all on function public.can_see_request(uuid) from public, anon;
grant execute on function public.can_see_request(uuid) to authenticated;

create policy requests_select on public.customer_requests
  for select to authenticated
  using (
    property_id = public.current_property_id()
    and (public.has_role('{manager}')
         or (public.has_role('{support}') and assigned_to = auth.uid()))
  );

create policy request_messages_select on public.request_messages
  for select to authenticated using (public.can_see_request(request_id));
create policy request_notes_select on public.request_notes
  for select to authenticated using (public.can_see_request(request_id));
create policy request_events_select on public.request_events
  for select to authenticated using (public.can_see_request(request_id));

-- ---------------------------------------------------------------------------
-- Support staff: read items to investigate, never change them
-- ---------------------------------------------------------------------------
create or replace function public._block_support()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.staff where user_id = auth.uid() and role = 'support') then
    raise exception 'Support staff can view items but not change them' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public._block_support() from public, anon, authenticated;

create trigger lost_items_block_support
  before insert or update on public.lost_items
  for each row execute function public._block_support();
create trigger item_photos_block_support
  before insert or delete on public.item_photos
  for each row execute function public._block_support();
create trigger guest_candidates_block_support
  before insert or update or delete on public.guest_candidates
  for each row execute function public._block_support();
create trigger room_checks_block_support
  before insert on public.room_checks
  for each row execute function public._block_support();
create trigger stays_block_support
  before insert or update on public.stays
  for each row execute function public._block_support();

-- [Railway] Supabase Storage policy item_photos_upload removed here; see note at the top.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public._normalise_booking_ref(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'))
$$;

create or replace function public._new_request_reference()
returns text
language plpgsql
volatile
as $$
declare
  h text;
begin
  -- 40 random bits from gen_random_uuid (cryptographically random), not a sequence
  h := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  return 'LF-' || substr(h, 1, 5) || '-' || substr(h, 6, 5);
end;
$$;

create or replace function public._request_event(
  p_request_id uuid, p_actor uuid, p_action text,
  p_from public.request_status, p_to public.request_status, p_detail text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.request_events (request_id, actor, action, from_status, to_status, detail)
  values (p_request_id, p_actor, p_action, p_from, p_to, nullif(left(trim(coalesce(p_detail, '')), 500), ''))
$$;

-- Words worth comparing: lowercase, 3+ letters, minus filler.
create or replace function public._words(p text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct w), '{}')
  from regexp_split_to_table(lower(coalesce(p, '')), '[^a-z0-9]+') as w
  where length(w) >= 3
    and w not in ('the', 'and', 'with', 'for', 'was', 'were', 'that', 'this', 'have', 'has', 'had',
                  'lost', 'left', 'think', 'thought', 'maybe', 'please', 'hotel', 'stay', 'stayed',
                  'item', 'thing', 'something', 'some', 'there', 'here', 'when', 'where', 'which',
                  'what', 'would', 'could', 'about', 'been', 'from', 'into', 'our', 'your', 'you',
                  'its', 'can', 'not', 'any', 'all', 'one', 'very', 'also', 'just', 'got', 'did')
$$;

-- Locks and returns a request the caller may work on, or raises.
create or replace function public._require_request(p_request_id uuid)
returns public.customer_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r public.customer_requests;
begin
  select * into r from public.customer_requests
  where id = p_request_id and property_id = s.property_id
  for update;
  if not found or not (s.role = 'manager' or (s.role = 'support' and r.assigned_to = s.user_id)) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

revoke all on function public._normalise_booking_ref(text) from public, anon, authenticated;
revoke all on function public._new_request_reference() from public, anon, authenticated;
revoke all on function public._request_event(uuid, uuid, text, public.request_status, public.request_status, text) from public, anon, authenticated;
revoke all on function public._words(text) from public, anon, authenticated;
revoke all on function public._require_request(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer API (no sign-in) — validated, rate-limited, minimal disclosure
-- ---------------------------------------------------------------------------
create or replace function public.public_properties()
returns table (inn_code text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.inn_code, p.name from public.properties p order by p.name
$$;

create or replace function public.submit_customer_request(
  p_inn_code       text,
  p_customer_name  text,
  p_booking_ref    text,
  p_item_name      text,
  p_description    text,
  p_category       text default null,
  p_colour         text default null,
  p_brand          text default null,
  p_lost_location  text default null,
  p_lost_date      date default null)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p public.properties;
  v_ref text := public._normalise_booking_ref(p_booking_ref);
  v_reference text;
  v_id uuid;
  today date := (now() at time zone 'Europe/London')::date;
begin
  select * into p from public.properties where inn_code = upper(trim(coalesce(p_inn_code, '')));
  if not found then
    raise exception 'Choose the hotel you stayed at';
  end if;
  if length(trim(coalesce(p_customer_name, ''))) not between 2 and 80 then
    raise exception 'Enter your name as it appears on the booking';
  end if;
  if v_ref !~ '^[A-Z0-9-]{3,32}$' then
    raise exception 'Enter the booking ID from your confirmation (letters and numbers)';
  end if;
  if length(trim(coalesce(p_item_name, ''))) not between 2 and 80 then
    raise exception 'Say what the item is';
  end if;
  if length(trim(coalesce(p_description, ''))) not between 3 and 1000 then
    raise exception 'Describe the item in up to 1,000 characters';
  end if;
  if p_lost_date is not null and (p_lost_date > today or p_lost_date < today - 365) then
    raise exception 'The date must be within the last year';
  end if;

  -- Abuse limits: per booking per day, and per hotel per hour.
  if (select count(*) from public.customer_requests
      where property_id = p.id and booking_ref = v_ref and created_at > now() - interval '1 day') >= 5 then
    raise exception 'This booking already has several enquiries today. Use your reference number to add details instead.';
  end if;
  if (select count(*) from public.customer_requests
      where property_id = p.id and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'We are receiving a lot of enquiries. Please try again in an hour.';
  end if;

  loop
    v_reference := public._new_request_reference();
    exit when not exists (select 1 from public.customer_requests where reference = v_reference);
  end loop;

  insert into public.customer_requests
    (property_id, reference, customer_name, booking_ref, item_name, category, colour, brand,
     description, lost_location, lost_date)
  values
    (p.id, v_reference, trim(p_customer_name), v_ref, trim(p_item_name),
     case when p_category in ('electronics', 'chargers_cables', 'clothing', 'shoes', 'bags',
                              'jewellery_watches', 'documents_cards', 'cash_wallets', 'toiletries',
                              'medication', 'toys', 'books', 'other') then p_category end,
     nullif(left(trim(coalesce(p_colour, '')), 40), ''),
     nullif(left(trim(coalesce(p_brand, '')), 60), ''),
     trim(p_description),
     nullif(left(trim(coalesce(p_lost_location, '')), 80), ''),
     p_lost_date)
  returning id into v_id;

  insert into public.request_messages (request_id, sender, body)
  values (v_id, 'customer', left(trim(p_description), 1000)),
         (v_id, 'system', 'Enquiry received. A member of staff will check it against our records. '
                          || 'We never confirm that an item is yours until we have verified it.');
  perform public._request_event(v_id, null, 'submitted', null, 'pending_review', null);
  return v_reference;
end;
$$;

-- Status for the customer: reference + booking ID must both match.
-- Returns no item details, matches, notes, or staff names.
create or replace function public.customer_request_status(p_reference text, p_booking_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.customer_requests;
begin
  select * into r from public.customer_requests
  where reference = upper(trim(coalesce(p_reference, '')))
    and booking_ref = public._normalise_booking_ref(p_booking_ref);
  if not found then
    raise exception 'No enquiry matches that reference and booking ID';
  end if;

  return jsonb_build_object(
    'reference', r.reference,
    'status', r.status,
    'item_name', r.item_name,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'can_reply', r.status not in ('rejected', 'resolved'),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.id)
      from public.request_messages m where m.request_id = r.id), '[]'::jsonb));
end;
$$;

create or replace function public.customer_reply(p_reference text, p_booking_ref text, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.customer_requests;
  v_to public.request_status;
begin
  select * into r from public.customer_requests
  where reference = upper(trim(coalesce(p_reference, '')))
    and booking_ref = public._normalise_booking_ref(p_booking_ref)
  for update;
  if not found then
    raise exception 'No enquiry matches that reference and booking ID';
  end if;
  if r.status in ('rejected', 'resolved') then
    raise exception 'This enquiry is closed. Start a new enquiry if you need to.';
  end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Write a message of up to 1,000 characters';
  end if;
  if (select count(*) from public.request_messages
      where request_id = r.id and sender = 'customer' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many messages today. Staff will reply to what you have sent.';
  end if;

  insert into public.request_messages (request_id, sender, body) values (r.id, 'customer', trim(p_body));

  v_to := r.status;
  if r.status = 'awaiting_customer' then
    v_to := case when r.assigned_to is null then 'pending_review' else 'under_investigation' end;
  end if;
  update public.customer_requests set status = v_to, updated_at = now() where id = r.id;
  perform public._request_event(r.id, null, 'customer_replied', r.status, v_to, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff API
-- ---------------------------------------------------------------------------
create or replace function public.assign_request(p_request_id uuid, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r public.customer_requests;
  t public.staff;
begin
  if s.role <> 'manager' then
    raise exception 'Only an admin can assign requests' using errcode = '42501';
  end if;
  r := public._require_request(p_request_id);
  if r.status = 'resolved' then
    raise exception 'This request is closed';
  end if;
  if p_staff_id is not null then
    select * into t from public.staff
    where user_id = p_staff_id and property_id = s.property_id and active and role in ('support', 'manager');
    if not found then
      raise exception 'Assign to an active Support or Admin member of this hotel';
    end if;
  end if;
  update public.customer_requests set assigned_to = p_staff_id, updated_at = now() where id = r.id;
  perform public._request_event(r.id, s.user_id, case when p_staff_id is null then 'unassigned' else 'assigned' end,
                                r.status, r.status, t.display_name);
end;
$$;

create or replace function public.set_request_status(p_request_id uuid, p_to public.request_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r public.customer_requests;
  ok boolean := false;
begin
  r := public._require_request(p_request_id);
  if r.status = 'resolved' then
    raise exception 'This request is closed';
  end if;
  if r.status = p_to then
    return;
  end if;
  if p_to = 'approved' then
    raise exception 'Approve by choosing the matching item';
  end if;
  if p_to = 'awaiting_customer' then
    raise exception 'Ask the customer a question to wait for their reply';
  end if;

  if s.role = 'support' then
    ok := p_to in ('under_investigation', 'awaiting_admin')
          and r.status in ('pending_review', 'under_investigation', 'awaiting_customer');
  elsif s.role = 'manager' then
    ok := case p_to
      when 'pending_review'      then r.status in ('under_investigation', 'awaiting_customer', 'awaiting_admin')
      when 'under_investigation' then r.status in ('pending_review', 'awaiting_customer', 'awaiting_admin', 'approved', 'rejected')
      when 'awaiting_admin'      then r.status in ('pending_review', 'under_investigation', 'awaiting_customer')
      when 'rejected'            then r.status in ('pending_review', 'under_investigation', 'awaiting_customer', 'awaiting_admin', 'approved')
      when 'resolved'            then r.status in ('approved', 'rejected')
      else false
    end;
  end if;
  if not ok then
    raise exception 'You can''t move this request from % to %', r.status, p_to using errcode = '42501';
  end if;
  if p_to = 'rejected' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Give a reason for rejecting';
  end if;

  update public.customer_requests set
    status = p_to,
    decision_note = case when p_to = 'rejected' then left(trim(p_note), 500) else decision_note end,
    approved_item_id = case when p_to in ('rejected', 'under_investigation', 'pending_review') then null else approved_item_id end,
    closed_at = case when p_to = 'resolved' then now() else null end,
    updated_at = now()
  where id = r.id;
  perform public._request_event(r.id, s.user_id, 'status_changed', r.status, p_to, p_note);
end;
$$;

-- Admin approval: an explicit human decision tied to a specific item. Adds the
-- booking as a possible owner on that item; releasing the item still follows
-- the item's own confirm → ID check → handover steps.
create or replace function public.approve_request(p_request_id uuid, p_item_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r public.customer_requests;
  i public.lost_items;
begin
  if s.role <> 'manager' then
    raise exception 'Only an admin can approve requests' using errcode = '42501';
  end if;
  r := public._require_request(p_request_id);
  if r.status not in ('pending_review', 'under_investigation', 'awaiting_customer', 'awaiting_admin') then
    raise exception 'Only open requests can be approved (this one is %)', r.status;
  end if;
  select * into i from public.lost_items where id = p_item_id and property_id = s.property_id;
  if not found then
    raise exception 'Choose an item held at this hotel';
  end if;
  if i.status in ('returned', 'disposed', 'donated') then
    raise exception 'That item is already closed (%)', i.status;
  end if;

  update public.customer_requests set
    status = 'approved', approved_item_id = i.id,
    decision_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
    updated_at = now()
  where id = r.id;

  insert into public.guest_candidates (item_id, reservation_ref, added_by, note)
  values (i.id, r.booking_ref, s.user_id, 'From customer enquiry ' || r.reference)
  on conflict (item_id, reservation_ref) do nothing;

  perform public._request_event(r.id, s.user_id, 'approved', r.status, 'approved',
                                'Item ' || i.item_code || coalesce(': ' || nullif(trim(p_note), ''), ''));
end;
$$;

create or replace function public.add_request_note(p_request_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r public.customer_requests;
begin
  r := public._require_request(p_request_id);
  if length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Write a note of up to 2,000 characters';
  end if;
  insert into public.request_notes (request_id, author_id, body) values (r.id, s.user_id, trim(p_body));
  update public.customer_requests set updated_at = now() where id = r.id;
  perform public._request_event(r.id, s.user_id, 'note_added', r.status, r.status, null);
end;
$$;

-- Sends a message the customer will see on their status page. With
-- p_ask = true the request waits for the customer's reply.
create or replace function public.message_customer(p_request_id uuid, p_body text, p_ask boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  r public.customer_requests;
  v_to public.request_status;
begin
  r := public._require_request(p_request_id);
  if r.status = 'resolved' then
    raise exception 'This request is closed';
  end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Write a message of up to 1,000 characters';
  end if;
  if p_ask and r.status not in ('pending_review', 'under_investigation', 'awaiting_customer', 'awaiting_admin') then
    raise exception 'Can only ask for information while the request is open';
  end if;
  insert into public.request_messages (request_id, sender, author_id, body)
  values (r.id, 'staff', s.user_id, trim(p_body));
  v_to := case when p_ask then 'awaiting_customer'::public.request_status else r.status end;
  update public.customer_requests set status = v_to, updated_at = now() where id = r.id;
  perform public._request_event(r.id, s.user_id, case when p_ask then 'asked_customer' else 'messaged_customer' end,
                                r.status, v_to, null);
end;
$$;

-- Ranked possible matches, for staff only. A guide, never proof.
--   +30 same category        +20 brand matches          +15 colour matches
--   +5 per shared word (max 25)
--   +25 found in the room of this booking during or just after the stay
--   +10 found within 3 days of the date the customer gave
-- Bands: strong ≥ 60, partial 35–59, weak 15–34 (lower is not shown). Score shown capped at 100.
create or replace function public.match_request_items(p_request_id uuid)
returns table (
  item_id      uuid,
  item_code    text,
  description  text,
  category     text,
  colour       text,
  brand        text,
  room_number  text,
  area_label   text,
  found_spot   text,
  found_at     timestamptz,
  status       public.item_status,
  value_tier   public.value_tier,
  score        integer,
  band         text,
  reasons      text[])
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r public.customer_requests;
  rw text[];
begin
  -- read-only: no row lock needed, but the same visibility rule applies
  if not public.can_see_request(p_request_id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select * into r from public.customer_requests where id = p_request_id;
  rw := public._words(r.item_name || ' ' || r.description || ' ' || coalesce(r.brand, '') || ' ' || coalesce(r.colour, ''));

  return query
  with booking_rooms as (
    select st.room_number, public.stay_effective_in(st) as s_in, public.stay_effective_out(st) as s_out
    from public.stays st
    where st.property_id = r.property_id and st.reservation_ref = r.booking_ref and st.status <> 'cancelled'
  ),
  cand as (
    select i.*,
      public._words(i.description || ' ' || coalesce(i.brand, '') || ' ' || coalesce(i.colour, '') || ' ' || coalesce(i.found_spot, '')) as iw,
      (i.found_at at time zone 'Europe/London')::date as found_day
    from public.lost_items i
    where i.property_id = r.property_id
      and i.status not in ('returned', 'disposed', 'donated')
      and (
        (r.lost_date is null and i.found_at > now() - interval '120 days')
        or ((i.found_at at time zone 'Europe/London')::date between r.lost_date - 3 and r.lost_date + 60)
      )
  ),
  scored as (
    select c.*,
      (r.category is not null and c.category = r.category) as m_cat,
      (r.brand is not null and (lower(coalesce(c.brand, '')) like '%' || lower(r.brand) || '%'
                                or lower(c.description) like '%' || lower(r.brand) || '%')) as m_brand,
      (r.colour is not null and (lower(coalesce(c.colour, '')) like '%' || lower(r.colour) || '%'
                                 or lower(c.description) like '%' || lower(r.colour) || '%')) as m_colour,
      cardinality(array(select unnest(rw) intersect select unnest(c.iw))) as shared,
      (select br.room_number from booking_rooms br
        where c.found_area_type = 'room' and br.room_number = c.room_number
          and c.found_at between br.s_in - interval '1 day' and br.s_out + interval '7 days'
        limit 1) as booking_room,
      (r.lost_date is not null and abs(c.found_day - r.lost_date) <= 3) as m_date
    from cand c
  ),
  totals as (
    select sc.*,
      (case when sc.m_cat then 30 else 0 end
       + case when sc.m_brand then 20 else 0 end
       + case when sc.m_colour then 15 else 0 end
       + least(25, 5 * sc.shared)
       + case when sc.booking_room is not null then 25 else 0 end
       + case when sc.m_date then 10 else 0 end) as total
    from scored sc
  )
  select t.id, t.item_code, t.description, t.category, t.colour, t.brand, t.room_number, t.area_label,
    t.found_spot, t.found_at, t.status, t.value_tier,
    least(100, t.total),
    case when t.total >= 60 then 'strong' when t.total >= 35 then 'partial' else 'weak' end,
    array_remove(array[
      case when t.m_cat then 'Same type of item' end,
      case when t.m_brand then 'Brand matches' end,
      case when t.m_colour then 'Colour matches' end,
      case when t.shared > 0 then t.shared || ' matching word(s) in the description' end,
      case when t.booking_room is not null then 'Found in room ' || t.booking_room || ', where this booking stayed' end,
      case when t.m_date then 'Found within 3 days of the date given' end
    ], null)
  from totals t
  where t.total >= 15
  order by t.total desc, t.found_at desc
  limit 15;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention and settings
-- ---------------------------------------------------------------------------
create or replace function public.purge_closed_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.customer_requests r
  using public.properties p
  where p.id = r.property_id
    and r.status in ('resolved', 'rejected')
    and r.updated_at < now() - make_interval(days => p.request_retention_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.update_request_settings(p_request_retention_days integer)
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
  update public.properties set request_retention_days = p_request_retention_days where id = s.property_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.public_properties() from public;
revoke all on function public.submit_customer_request(text, text, text, text, text, text, text, text, text, date) from public;
revoke all on function public.customer_request_status(text, text) from public;
revoke all on function public.customer_reply(text, text, text) from public;
grant execute on function public.public_properties() to anon, authenticated;
grant execute on function public.submit_customer_request(text, text, text, text, text, text, text, text, text, date) to anon, authenticated;
grant execute on function public.customer_request_status(text, text) to anon, authenticated;
grant execute on function public.customer_reply(text, text, text) to anon, authenticated;

revoke all on function public.assign_request(uuid, uuid) from public, anon;
revoke all on function public.set_request_status(uuid, public.request_status, text) from public, anon;
revoke all on function public.approve_request(uuid, uuid, text) from public, anon;
revoke all on function public.add_request_note(uuid, text) from public, anon;
revoke all on function public.message_customer(uuid, text, boolean) from public, anon;
revoke all on function public.match_request_items(uuid) from public, anon;
revoke all on function public.update_request_settings(integer) from public, anon;
revoke all on function public.purge_closed_requests() from public, anon, authenticated;
grant execute on function public.assign_request(uuid, uuid) to authenticated;
grant execute on function public.set_request_status(uuid, public.request_status, text) to authenticated;
grant execute on function public.approve_request(uuid, uuid, text) to authenticated;
grant execute on function public.add_request_note(uuid, text) to authenticated;
grant execute on function public.message_customer(uuid, text, boolean) to authenticated;
grant execute on function public.match_request_items(uuid) to authenticated;
grant execute on function public.update_request_settings(integer) to authenticated;
