-- Foundora — PR C: customer emails through an outbox
--
-- Additive. Nothing here sends anything: the database only RECORDS which
-- email is due, in the same transaction as the change that causes it, so a
-- report or status change can never be lost because email failed, and an
-- email can never exist without the change. A separate job
-- (scripts/email-dispatch.mjs, Railway cron) sends what is due through the
-- Brevo API, retries temporary failures and records the result.
--
--   * email_outbox: one row per customer email (queue + delivery log).
--     Unique (request, event) so the same event can never be emailed twice.
--     The stored copy of a sent email has the private link blanked out.
--   * request_access_tokens: each email carries its own tracking-link token
--     (the token is never stored, only its SHA-256); all of a report's tokens
--     follow the report's expiry (open, or closed under 30 days).
--   * email_suppressions: SHA-256 of addresses that bounced or complained
--     (filled from Brevo's reports later); never mailed again.
--
-- Which events email the customer (found reports never get "Matched"):
--   submitted → received · asked_customer → contact_required
--   messaged_customer → staff_message (says there is a message; the text
--   itself stays on the tracking page) · first move to under_investigation →
--   under_review · approved → matched · rejected → closed · resolved → resolved

create table public.email_outbox (
  id                   bigint generated always as identity primary key,
  property_id          uuid not null references public.properties (id) on delete cascade,
  request_id           uuid not null references public.customer_requests (id) on delete cascade,
  event_key            text not null check (event_key ~ '^[a-z0-9:_-]{1,60}$'),
  template             text not null check (template in
                         ('received', 'contact_required', 'staff_message', 'under_review', 'matched', 'closed', 'resolved')),
  recipient            text not null check (length(recipient) <= 254),
  status               text not null default 'queued' check (status in
                         ('queued', 'sending', 'retry', 'sent', 'previewed', 'skipped', 'suppressed', 'failed', 'expired')),
  attempts             integer not null default 0 check (attempts >= 0),
  next_attempt_at      timestamptz not null default now(),
  locked_until         timestamptz,
  provider             text,
  provider_message_id  text,
  last_error           text check (last_error is null or length(last_error) <= 200),
  sender               text,
  subject              text,
  body_text            text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  unique (request_id, event_key)
);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status in ('queued', 'retry', 'sending');
create index email_outbox_property_idx on public.email_outbox (property_id, created_at desc);
comment on table public.email_outbox is
  'Customer emails: queued by trigger in the same transaction as the event, sent by scripts/email-dispatch.mjs. body_text has the private link blanked.';

create table public.request_access_tokens (
  request_id  uuid not null references public.customer_requests (id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  primary key (request_id, token_hash)
);
comment on table public.request_access_tokens is
  'SHA-256 of tracking-link tokens issued in emails. The tokens themselves are never stored.';

create table public.email_suppressions (
  email_hash  text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  reason      text not null check (reason in ('bounce', 'complaint', 'manual')),
  created_at  timestamptz not null default now()
);

alter table public.email_outbox enable row level security;
alter table public.request_access_tokens enable row level security;
alter table public.email_suppressions enable row level security;
revoke all on public.email_outbox, public.request_access_tokens, public.email_suppressions from public, anon, authenticated;
-- Managers see their own hotel's email log (Settings → Emails). Nothing else.
grant select on public.email_outbox to authenticated;
create policy email_outbox_select on public.email_outbox
  for select to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'));

-- A tracking token is valid for its report if it is the one shown at
-- submission or one issued in an email, and the report is open or closed less
-- than 30 days ago. (Replaces the version in 016; same signature.)
create or replace function public._tracking_valid(r public.customer_requests, p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_token, '') ~ '^[0-9a-f]{64}$'
     and (r.status not in ('rejected', 'resolved')
          or coalesce(r.closed_at, r.updated_at) > now() - interval '30 days')
     and (r.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
          or exists (select 1 from public.request_access_tokens t
                      where t.request_id = r.id
                        and t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')))
$$;
revoke all on function public._tracking_valid(public.customer_requests, text) from public, anon, authenticated;

-- Queue the customer email for a report event, if any. Runs inside the
-- transaction that recorded the event.
create or replace function public._queue_customer_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.customer_requests;
  v_template text;
begin
  select * into r from public.customer_requests where id = new.request_id;
  if not found or r.customer_email is null then
    return new;
  end if;

  v_template := case
    when new.action = 'submitted' then 'received'
    when new.action = 'asked_customer' then 'contact_required'
    when new.action = 'messaged_customer' then 'staff_message'
    when new.action = 'approved' and r.report_type = 'lost' then 'matched'
    when new.action = 'status_changed' and new.to_status = 'rejected' then 'closed'
    when new.action = 'status_changed' and new.to_status = 'resolved' then 'resolved'
    when new.action = 'status_changed' and new.to_status = 'under_investigation'
         and new.from_status = 'pending_review'
         and not exists (select 1 from public.email_outbox o
                          where o.request_id = r.id and o.template = 'under_review') then 'under_review'
  end;
  if v_template is null then
    return new;
  end if;
  if exists (select 1 from public.email_suppressions s
              where s.email_hash = encode(sha256(convert_to(r.customer_email, 'UTF8')), 'hex')) then
    insert into public.email_outbox (property_id, request_id, event_key, template, recipient, status)
    values (r.property_id, r.id, 'event:' || new.id, v_template, r.customer_email, 'suppressed')
    on conflict (request_id, event_key) do nothing;
    return new;
  end if;

  insert into public.email_outbox (property_id, request_id, event_key, template, recipient)
  values (r.property_id, r.id, 'event:' || new.id, v_template, r.customer_email)
  on conflict (request_id, event_key) do nothing;
  return new;
end;
$$;
revoke all on function public._queue_customer_email() from public, anon, authenticated;

create trigger request_events_queue_email
  after insert on public.request_events
  for each row execute function public._queue_customer_email();
