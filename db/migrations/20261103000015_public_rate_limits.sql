-- HMS Returnly — rate limits for the public (no sign-in) pages (PR A, finding F5)
--
-- The customer functions already limit per booking, per hotel and per enquiry
-- (migration 008). What was missing is a limit per visitor: nothing stopped
-- one connection from trying reference/booking pairs on /track, or filling a
-- hotel's hourly enquiry allowance so real guests were refused.
--
-- The app calls hit_rate_limit() in its OWN transaction before each public
-- action, so a failed lookup still counts (inside the same transaction its
-- rollback would undo the count). It passes a keyed hash of the visitor's IP
-- address, made in the app with a server secret: the database never sees or
-- stores an IP address, and the hash can't be reversed without the secret.
--
-- Limits live here, not in the app, so nobody can raise them by calling the
-- function differently. They are generous on purpose: guests on hotel wifi
-- share one public IP address.
--   submit  10 enquiries per hour
--   lookup  60 status checks per hour
--   reply   30 messages per hour
-- Counters are fixed one-hour windows; the daily clean-up removes windows
-- older than a day (run_daily_cleanup() is replaced below with that addition).

create table ops.rate_hits (
  bucket        text not null check (bucket in ('submit', 'lookup', 'reply')),
  key_hash      text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start  timestamptz not null,
  hits          integer not null default 1 check (hits > 0),
  primary key (bucket, key_hash, window_start)
);
create index rate_hits_window_idx on ops.rate_hits (window_start);
revoke all on ops.rate_hits from public;
comment on table ops.rate_hits is
  'Public-page rate limit counters: keyed hash of the visitor (never the IP itself), one row per bucket per hour. Written only by hit_rate_limit().';

-- true = allowed, false = over the limit for this hour.
create or replace function public.hit_rate_limit(p_bucket text, p_key_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit  integer;
  v_start  timestamptz := date_trunc('hour', now());
  v_hits   integer;
begin
  v_limit := case p_bucket
    when 'submit' then 10
    when 'lookup' then 60
    when 'reply'  then 30
  end;
  if v_limit is null then
    raise exception 'unknown rate-limit bucket' using errcode = '22023';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'rate-limit key must be a 64-character hex hash' using errcode = '22023';
  end if;

  insert into ops.rate_hits as h (bucket, key_hash, window_start)
  values (p_bucket, p_key_hash, v_start)
  on conflict (bucket, key_hash, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;
  return v_hits <= v_limit;
end;
$$;
revoke all on function public.hit_rate_limit(text, text) from public, authenticated;
grant execute on function public.hit_rate_limit(text, text) to anon;

-- The daily clean-up (migration 014) plus one step: rate-limit windows older
-- than a day. Everything else is unchanged.
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
  n_hits     integer;
begin
  perform pg_advisory_xact_lock(hashtext('returnly.daily_cleanup'));
  insert into ops.job_runs (job) values ('daily_cleanup') returning id into v_run;

  begin
    n_stays    := public.purge_expired_stays();
    n_requests := public.purge_closed_requests();

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
    'stays', n_stays, 'closed_enquiries', n_requests, 'sessions', n_sessions,
    'verifications', n_verify, 'rate_limits', n_limits, 'sign_in_failures', n_failures,
    'public_rate_hits', n_hits);
  update ops.job_runs set finished_at = now(), ok = true, summary = v_summary where id = v_run;
  return v_summary || jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.run_daily_cleanup() from public, anon, authenticated;
