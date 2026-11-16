-- Foundora — Phase 1, PR L: hotel addresses without /h/, and the email sender's heartbeat
--
-- Additive.
--
-- 1. Hotel addresses. Each hotel is now at /<slug> (was /h/<slug>), so the
--    slug is the first part of the path and can never be a word the app uses
--    itself. _valid_slug() gains the app's remaining top-level addresses
--    (items, requests, staff, settings, account, notifications, branding) and
--    a few kept for Foundora's guidance pages (about, contact, privacy, terms,
--    logout, signout). Same list as RESERVED_SLUGS in src/lib/branding-paths.ts.
--    A hotel whose address is now reserved gets "-hotel" added (none on
--    staging or production today: they use their hotel codes).
--
-- 2. The email sender's heartbeat. scripts/email-dispatch.mjs records each run
--    in ops.job_runs (job 'email_dispatch', kept 2 days). last_email_dispatch()
--    tells managers when it last ran against THIS database and how many emails
--    are waiting, so Settings → Customer emails shows plainly when the sender
--    is looking at another database (or has stopped) instead of emails
--    silently waiting.

create or replace function public._valid_slug(p text)
returns boolean
language sql
immutable
as $$
  select coalesce(p, '') ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'
     and p !~ '--'
     and p not in ('www', 'app', 'api', 'admin', 'notify', 'mail', 'news', 'staging', 'status', 'h',
                   'found', 'track', 'login', 'signin', 'setup', 'brand', 'help', 'support', 'foundora',
                   'items', 'requests', 'staff', 'settings', 'account', 'notifications', 'branding',
                   'about', 'contact', 'privacy', 'terms', 'logout', 'signout')
$$;
revoke all on function public._valid_slug(text) from public, anon, authenticated;

-- An address that became reserved: keep the hotel reachable (code-based slugs never clash with "-hotel").
update public.properties
   set slug = left(slug, 34) || '-hotel'
 where not public._valid_slug(slug);

comment on table ops.job_runs is
  'One row per scheduled job run: daily_cleanup (run_daily_cleanup(), kept a year) and email_dispatch (scripts/email-dispatch.mjs, kept 2 days).';

create or replace function public.last_email_dispatch()
returns table (finished_at timestamptz, ok boolean, summary jsonb, waiting integer, oldest_waiting timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if v_property is null or not public.has_role('{manager}') then
    raise exception 'Only managers can see the email sender status.' using errcode = '42501';
  end if;
  return query
    select r.finished_at, r.ok, r.summary, w.n, w.oldest
      from (select count(*)::int as n, min(o.created_at) as oldest
              from public.email_outbox o
             where o.property_id = v_property and o.status in ('queued', 'retry')) w
      left join lateral (select j.finished_at, j.ok, j.summary from ops.job_runs j
                          where j.job = 'email_dispatch' and j.finished_at is not null
                          order by j.finished_at desc limit 1) r on true;
end;
$$;
revoke all on function public.last_email_dispatch() from public, anon;
grant execute on function public.last_email_dispatch() to authenticated;
