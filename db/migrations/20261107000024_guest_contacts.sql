-- Foundora — Phase 1, PR H: the guest contact record
--
-- Additive. One row per email address per hotel, never duplicated (the key is
-- hotel + email, and every email is already stored lower-case): when the
-- address was first and last used for a report, and how many reports it sent.
-- For the hotel's own records only — nothing here sends email or is used
-- for marketing.
--
--   * Filled automatically: a trigger adds or updates the row whenever a
--     report with an email is submitted (lost or found). Existing reports are
--     copied in once, below.
--   * Removed automatically: the daily clean-up deletes a contact the night
--     after the hotel no longer holds any report from that address — so it
--     follows the hotel's "closed requests" retention in Settings and is never
--     kept longer than the reports themselves.
--   * Managers only (Settings → Guest contacts). Opening the list is written
--     to guest_contact_views (who, when; at most once per 10 minutes; kept a
--     year), shown on Settings → Access log. Nobody can change either table
--     from the app.
--
-- run_daily_cleanup() is replaced with one added step (contacts); everything
-- else in it is unchanged from migration 015.

create table public.guest_contacts (
  property_id        uuid not null references public.properties (id) on delete cascade,
  email              text not null
    check (length(email) <= 254 and email = lower(email)
           and email ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'),
  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  reports_submitted  integer not null default 1 check (reports_submitted > 0),
  primary key (property_id, email),
  check (last_seen_at >= first_seen_at)
);
create index guest_contacts_recent_idx on public.guest_contacts (property_id, last_seen_at desc);
comment on table public.guest_contacts is
  'One row per guest email per hotel (no duplicates). Filled by a trigger on customer_requests; removed by the daily clean-up once no report from that address remains. Records only: never used to send email.';

alter table public.guest_contacts enable row level security;
revoke all on public.guest_contacts from public, anon, authenticated;
grant select on public.guest_contacts to authenticated;
create policy guest_contacts_select on public.guest_contacts
  for select to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'));

-- Every new report with an email: add the contact, or update it.
create or replace function public._record_guest_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.guest_contacts as c (property_id, email, first_seen_at, last_seen_at, reports_submitted)
  values (new.property_id, new.customer_email, new.created_at, new.created_at, 1)
  on conflict (property_id, email) do update
     set last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at),
         first_seen_at = least(c.first_seen_at, excluded.first_seen_at),
         reports_submitted = c.reports_submitted + 1;
  return null;
end;
$$;
revoke all on function public._record_guest_contact() from public, anon, authenticated;
create trigger customer_requests_guest_contact
  after insert on public.customer_requests
  for each row when (new.customer_email is not null)
  execute function public._record_guest_contact();

-- Reports already on file (staging: synthetic only).
insert into public.guest_contacts (property_id, email, first_seen_at, last_seen_at, reports_submitted)
select property_id, customer_email, min(created_at), max(created_at), count(*)::int
  from public.customer_requests
 where customer_email is not null
 group by property_id, customer_email
on conflict (property_id, email) do nothing;

comment on column public.customer_requests.customer_email is
  'Typed and confirmed on screen by the customer (not verified by email). For reference/status emails only. Deleted with the report; its guest_contacts row goes the night after the last report from that address.';

-- Contacts with no report left at their hotel (called by the daily clean-up).
create or replace function public.purge_orphan_guest_contacts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.guest_contacts c
   where not exists (select 1 from public.customer_requests r
                      where r.customer_email = c.email and r.property_id = c.property_id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_orphan_guest_contacts() from public, anon, authenticated;

-- Who opened the contacts list, and when.
create table public.guest_contact_views (
  id           bigint generated always as identity primary key,
  property_id  uuid not null references public.properties (id) on delete cascade,
  staff_id     uuid not null references public.staff (user_id),
  created_at   timestamptz not null default now()
);
create index guest_contact_views_property_idx on public.guest_contact_views (property_id, created_at desc);
alter table public.guest_contact_views enable row level security;
revoke all on public.guest_contact_views from public, anon, authenticated;
grant select on public.guest_contact_views to authenticated;
create policy guest_contact_views_select on public.guest_contact_views
  for select to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'));

create or replace function public.log_contacts_view()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_property uuid := public.current_property_id();
begin
  if me is null or v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can see guest contacts.' using errcode = '42501';
  end if;
  if exists (select 1 from public.guest_contact_views v
              where v.staff_id = me and v.property_id = v_property and v.created_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.guest_contact_views (property_id, staff_id) values (v_property, me);
  -- Keep a year.
  delete from public.guest_contact_views
   where property_id = v_property and created_at < now() - interval '1 year';
end;
$$;
revoke all on function public.log_contacts_view() from public, anon;
grant execute on function public.log_contacts_view() to authenticated;

-- The daily clean-up (migration 015) plus one step: contacts with no report left.
create or replace function public.run_daily_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run      bigint;
  v_summary  jsonb;
  n_stays    integer;
  n_requests integer;
  n_contacts integer;
  n_sessions integer;
  n_verify   integer;
  n_limits   integer;
  n_failures integer;
  n_hits     integer;
begin
  perform pg_advisory_xact_lock(hashtext('returnly.daily_cleanup'));
  insert into ops.job_runs (job) values ('daily_cleanup') returning id into v_run;

  begin
    n_stays    := public.purge_expired_stays();
    n_requests := public.purge_closed_requests();
    -- After the reports, so a contact whose last report just went goes tonight.
    n_contacts := public.purge_orphan_guest_contacts();

    delete from auth.session where expires_at < now();
    get diagnostics n_sessions = row_count;
    delete from auth.verification where expires_at < now();
    get diagnostics n_verify = row_count;
    delete from auth.rate_limit
     where last_request < (extract(epoch from now() - interval '1 day') * 1000)::bigint;
    get diagnostics n_limits = row_count;
    delete from auth.sign_in_failures
     where first_failed_at < now() - interval '1 day'
       and (locked_until is null or locked_until < now());
    get diagnostics n_failures = row_count;
    delete from ops.rate_hits where window_start < now() - interval '1 day';
    get diagnostics n_hits = row_count;

    delete from ops.job_runs where job = 'daily_cleanup' and started_at < now() - interval '1 year';
  exception when others then
    update ops.job_runs
       set finished_at = now(), ok = false, summary = jsonb_build_object('error', sqlstate)
     where id = v_run;
    return jsonb_build_object('ok', false, 'error', sqlstate);
  end;

  v_summary := jsonb_build_object(
    'stays', n_stays, 'closed_enquiries', n_requests, 'guest_contacts', n_contacts, 'sessions', n_sessions,
    'verifications', n_verify, 'rate_limits', n_limits, 'sign_in_failures', n_failures,
    'public_rate_hits', n_hits);
  update ops.job_runs set finished_at = now(), ok = true, summary = v_summary where id = v_run;
  return v_summary || jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.run_daily_cleanup() from public, anon, authenticated;
