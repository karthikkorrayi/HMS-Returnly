-- HMS Returnly — daily clean-up job (Railway only)
--
-- On Supabase, purge_expired_stays() and purge_closed_requests() were meant to
-- be run daily by pg_cron. Railway has no pg_cron: a small scheduled service
-- (scripts/daily-cleanup.mjs, once a day) calls run_daily_cleanup() below,
-- which does all the clean-up in one go and records the run.
--
-- What it removes (nothing else):
--   * stays past the hotel's stay retention (purge_expired_stays);
--   * closed enquiries past the enquiry retention (purge_closed_requests);
--   * expired sign-in sessions and verification tokens;
--   * sign-in rate-limit counters and wrong-password counts older than a day
--     (never a lock that is still running).
-- Lost items and photos are NOT removed: disposal stays a manager's decision.
--
-- Every run is written to ops.job_runs, also a failed one (its changes are
-- undone, the failure is kept). A run that never happens is visible too:
-- managers see the last successful clean-up on Settings, with a warning when
-- it is more than a day and a half old.

create schema if not exists ops;
revoke all on schema ops from public;

create table ops.job_runs (
  id           bigint generated always as identity primary key,
  job          text not null check (job ~ '^[a-z_]{3,40}$'),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean not null default false,
  summary      jsonb not null default '{}'::jsonb
);
create index job_runs_job_idx on ops.job_runs (job, started_at desc);
revoke all on ops.job_runs from public;
comment on table ops.job_runs is 'One row per scheduled job run (daily clean-up). Written only by run_daily_cleanup().';

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
  n_sessions integer;
  n_verify   integer;
  n_limits   integer;
  n_failures integer;
begin
  -- Two runs at once (a manual run during the scheduled one): the second waits its turn.
  perform pg_advisory_xact_lock(hashtext('returnly.daily_cleanup'));
  insert into ops.job_runs (job) values ('daily_cleanup') returning id into v_run;

  begin
    n_stays    := public.purge_expired_stays();
    n_requests := public.purge_closed_requests();

    delete from auth.session where expires_at < now();
    get diagnostics n_sessions = row_count;
    delete from auth.verification where expires_at < now();
    get diagnostics n_verify = row_count;
    -- last_request is milliseconds since 1970 (Better Auth).
    delete from auth.rate_limit
     where last_request < (extract(epoch from now() - interval '1 day') * 1000)::bigint;
    get diagnostics n_limits = row_count;
    delete from auth.sign_in_failures
     where first_failed_at < now() - interval '1 day'
       and (locked_until is null or locked_until < now());
    get diagnostics n_failures = row_count;

    -- Keep a year of run history.
    delete from ops.job_runs where job = 'daily_cleanup' and started_at < now() - interval '1 year';
  exception when others then
    -- Everything in this block is undone; the failed run is still recorded.
    update ops.job_runs
       set finished_at = now(), ok = false, summary = jsonb_build_object('error', sqlstate)
     where id = v_run;
    return jsonb_build_object('ok', false, 'error', sqlstate);
  end;

  v_summary := jsonb_build_object(
    'stays', n_stays, 'closed_enquiries', n_requests, 'sessions', n_sessions,
    'verifications', n_verify, 'rate_limits', n_limits, 'sign_in_failures', n_failures);
  update ops.job_runs set finished_at = now(), ok = true, summary = v_summary where id = v_run;
  return v_summary || jsonb_build_object('ok', true);
end;
$$;
-- Only the owner may run it (the scheduled job connects as app_owner).
revoke all on function public.run_daily_cleanup() from public, anon, authenticated;

-- For the Settings page: when did the clean-up last succeed? Managers only.
create or replace function public.last_cleanup()
returns table (finished_at timestamptz, summary jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_property_id() is null or not public.has_role('{manager}') then
    raise exception 'Only managers can see the clean-up runs.' using errcode = '42501';
  end if;
  return query
    select r.finished_at, r.summary from ops.job_runs r
     where r.job = 'daily_cleanup' and r.ok
     order by r.finished_at desc limit 1;
end;
$$;
revoke all on function public.last_cleanup() from public, anon;
grant execute on function public.last_cleanup() to authenticated;
