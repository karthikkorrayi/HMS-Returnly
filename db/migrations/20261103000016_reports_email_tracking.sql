-- Foundora — PR B: lost AND found reports, the customer's email, tracking links
--
-- Additive. Existing enquiries are untouched (they are "lost" reports with a
-- name and booking ID, and keep working with reference + booking ID).
--
--   * report_type: 'lost' (a guest's enquiry, as before) or 'found' (someone
--     hands in a found item: short form, no booking ID or name needed; told
--     to hand the item in at reception; never shown any match).
--   * customer_email + email_confirmed_at: the address the customer typed and
--     confirmed on screen ("Is this your correct email address?"). Not
--     verified by email, by decision. Used for the reference and status
--     emails (PR C), deleted with the report by the daily clean-up.
--   * tracking token: 64 random hex characters returned ONCE at submission and
--     put in the tracking link (after '#', so it never reaches server logs).
--     Only its SHA-256 is stored. Separate from the reference. Valid while
--     the report is open and for 30 days after it closes; the database
--     enforces that. The tracking view shows the hotel, reference, item,
--     status and messages: never the email address, booking ID or notes.
--
-- customer_name and booking_ref become optional at column level (found
-- reports have neither); a check keeps them required for lost reports.

alter table public.customer_requests
  add column report_type text not null default 'lost' check (report_type in ('lost', 'found')),
  add column customer_email text
    check (customer_email is null or (length(customer_email) <= 254
           and customer_email = lower(customer_email)
           and customer_email ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$')),
  add column email_confirmed_at timestamptz,
  add column found_whereabouts text
    check (found_whereabouts is null or found_whereabouts in ('handed_in', 'with_finder', 'left_in_place')),
  add column tracking_token_hash text unique check (tracking_token_hash is null or tracking_token_hash ~ '^[0-9a-f]{64}$');

alter table public.customer_requests alter column customer_name drop not null;
alter table public.customer_requests alter column booking_ref drop not null;

alter table public.customer_requests
  add constraint lost_report_has_guest_details
    check (report_type = 'found' or (customer_name is not null and booking_ref is not null)),
  add constraint found_report_has_whereabouts
    check (report_type = 'lost' or found_whereabouts is not null);

create index customer_requests_email_idx on public.customer_requests (customer_email, created_at)
  where customer_email is not null;

comment on column public.customer_requests.customer_email is
  'Typed and confirmed on screen by the customer (not verified by email). For reference/status emails only. Deleted with the report.';
comment on column public.customer_requests.tracking_token_hash is
  'SHA-256 of the tracking-link token. The token itself is never stored.';

-- Is this tracking token valid for this report right now? (open, or closed
-- less than 30 days ago)
create or replace function public._tracking_valid(r public.customer_requests, p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r.tracking_token_hash is not null
     and coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
     and r.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and (r.status not in ('rejected', 'resolved')
          or coalesce(r.closed_at, r.updated_at) > now() - interval '30 days')
$$;
revoke all on function public._tracking_valid(public.customer_requests, text) from public, anon, authenticated;

-- The customer's view, shared by both ways in (booking ID or tracking link).
create or replace function public._customer_view(r public.customer_requests)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'reference', r.reference,
    'report_type', r.report_type,
    'hotel_name', (select p.name from public.properties p where p.id = r.property_id),
    'status', r.status,
    'item_name', r.item_name,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'can_reply', r.status not in ('rejected', 'resolved'),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.id)
      from public.request_messages m where m.request_id = r.id), '[]'::jsonb))
$$;
revoke all on function public._customer_view(public.customer_requests) from public, anon, authenticated;

-- New way in: one function for lost and found reports. Returns the reference
-- and the tracking token (the token is never retrievable again).
create or replace function public.submit_customer_report(
  p_inn_code        text,
  p_report_type     text,
  p_customer_email  text,
  p_email_confirmed boolean,
  p_item_name       text,
  p_description     text,
  p_category        text default null,
  p_colour          text default null,
  p_brand           text default null,
  p_location        text default null,
  p_date            date default null,
  p_customer_name   text default null,
  p_booking_ref     text default null,
  p_whereabouts     text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p          public.properties;
  v_type     text := lower(trim(coalesce(p_report_type, '')));
  v_email    text := lower(trim(coalesce(p_customer_email, '')));
  v_booking  text;
  v_name     text;
  v_desc     text := trim(coalesce(p_description, ''));
  v_item     text := trim(coalesce(p_item_name, ''));
  v_where    text;
  v_reference text;
  v_token    text;
  v_id       uuid;
  today      date := (now() at time zone 'Europe/London')::date;
begin
  select * into p from public.properties where inn_code = upper(trim(coalesce(p_inn_code, '')));
  if not found then
    raise exception 'Choose the hotel';
  end if;
  if v_type not in ('lost', 'found') then
    raise exception 'Choose whether you lost or found an item';
  end if;
  if length(v_email) > 254 or v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_email_confirmed is not true then
    raise exception 'Please confirm your email address';
  end if;
  if length(v_item) not between 2 and 80 then
    raise exception 'Say what the item is';
  end if;
  if v_type = 'found' and v_desc = '' then
    v_desc := v_item;
  end if;
  if length(v_desc) not between 2 and 1000 then
    raise exception 'Describe the item in up to 1,000 characters';
  end if;
  if p_date is not null and (p_date > today or p_date < today - 365) then
    raise exception 'The date must be within the last year';
  end if;

  if v_type = 'lost' then
    v_name := trim(coalesce(p_customer_name, ''));
    v_booking := public._normalise_booking_ref(p_booking_ref);
    if length(v_name) not between 2 and 80 then
      raise exception 'Enter your name as it appears on the booking';
    end if;
    if coalesce(v_booking, '') !~ '^[A-Z0-9-]{3,32}$' then
      raise exception 'Enter the booking ID from your confirmation (letters and numbers)';
    end if;
    if (select count(*) from public.customer_requests
        where property_id = p.id and booking_ref = v_booking and created_at > now() - interval '1 day') >= 5 then
      raise exception 'This booking already has several enquiries today. Use your reference number to add details instead.';
    end if;
  else
    v_where := lower(trim(coalesce(p_whereabouts, '')));
    if v_where not in ('handed_in', 'with_finder', 'left_in_place') then
      raise exception 'Say where the item is now';
    end if;
  end if;

  -- Abuse limits: per email address per day, and per hotel per hour.
  if (select count(*) from public.customer_requests
      where customer_email = v_email and created_at > now() - interval '1 day') >= 5 then
    raise exception 'This email address already has several reports today. Use your tracking link to add details instead.';
  end if;
  if (select count(*) from public.customer_requests
      where property_id = p.id and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'We are receiving a lot of reports. Please try again in an hour.';
  end if;

  loop
    v_reference := public._new_request_reference();
    exit when not exists (select 1 from public.customer_requests where reference = v_reference);
  end loop;
  -- 2 × 122 random bits from gen_random_uuid() (cryptographically random).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.customer_requests
    (property_id, reference, report_type, customer_name, booking_ref, customer_email, email_confirmed_at,
     item_name, category, colour, brand, description, lost_location, lost_date, found_whereabouts,
     tracking_token_hash)
  values
    (p.id, v_reference, v_type, v_name, v_booking, v_email, now(),
     v_item,
     case when p_category in ('electronics', 'chargers_cables', 'clothing', 'shoes', 'bags',
                              'jewellery_watches', 'documents_cards', 'cash_wallets', 'toiletries',
                              'medication', 'toys', 'books', 'other') then p_category end,
     nullif(left(trim(coalesce(p_colour, '')), 40), ''),
     nullif(left(trim(coalesce(p_brand, '')), 60), ''),
     v_desc,
     nullif(left(trim(coalesce(p_location, '')), 80), ''),
     p_date,
     v_where,
     encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  returning id into v_id;

  insert into public.request_messages (request_id, sender, body)
  values (v_id, 'customer', left(v_desc, 1000)),
         (v_id, 'system', case v_type
            when 'lost' then 'Report received. A member of staff will check it against the items the hotel holds. '
                          || 'We never confirm that an item is yours until we have verified it.'
            else 'Thank you for reporting a found item. If you have not handed it in yet, please take it to '
                 || 'the hotel reception. Staff will update this report.'
          end);
  perform public._request_event(v_id, null, 'submitted', null, 'pending_review', v_type || ' report');
  return jsonb_build_object('reference', v_reference, 'token', v_token);
end;
$$;

-- Status by tracking link (reference + token). One message for "wrong" and
-- "expired", so the page can't be used to test tokens.
create or replace function public.customer_report_status(p_reference text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.customer_requests;
begin
  select * into r from public.customer_requests where reference = upper(trim(coalesce(p_reference, '')));
  if not found or not public._tracking_valid(r, p_token) then
    raise exception 'This tracking link is not valid or has expired';
  end if;
  return public._customer_view(r);
end;
$$;

create or replace function public.customer_report_reply(p_reference text, p_token text, p_body text)
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
  for update;
  if not found or not public._tracking_valid(r, p_token) then
    raise exception 'This tracking link is not valid or has expired';
  end if;
  if r.status in ('rejected', 'resolved') then
    raise exception 'This report is closed. Start a new report if you need to.';
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

-- The existing booking-ID lookup now returns the same view (adds the report
-- type and hotel name). Same signature, same checks.
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
  return public._customer_view(r);
end;
$$;

revoke all on function public.submit_customer_report(text, text, text, boolean, text, text, text, text, text, text, date, text, text, text) from public, authenticated;
revoke all on function public.customer_report_status(text, text) from public, authenticated;
revoke all on function public.customer_report_reply(text, text, text) from public, authenticated;
grant execute on function public.submit_customer_report(text, text, text, boolean, text, text, text, text, text, text, date, text, text, text) to anon;
grant execute on function public.customer_report_status(text, text) to anon;
grant execute on function public.customer_report_reply(text, text, text) to anon;

-- Staff workflow for found reports. A found report is not a claim: it can't
-- be approved against an item (that adds the booking as a possible owner,
-- and a finder has none). A manager resolves it once the item has reached
-- reception (and is logged as a found item), from any open status.
-- Lost reports behave exactly as before.
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
  if r.report_type = 'found' then
    raise exception 'A found-item report can''t be approved. Log the item, then resolve the report.';
  end if;
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
                                      or (r.report_type = 'found'
                                          and r.status in ('pending_review', 'under_investigation', 'awaiting_customer', 'awaiting_admin'))
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
