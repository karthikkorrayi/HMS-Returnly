-- Foundora — audit log: staff opening a customer's report
--
-- Additive. Each time a staff member opens a report (lost or found) in the
-- app, which shows the customer's name, email and booking ID, a row is
-- written here: who, which report, when. Managers of the hotel can read their
-- hotel's log (Settings → Access log); nobody can change or delete it from
-- the app. Opening the same report again within 10 minutes isn't logged
-- twice. Entries are kept for a year; the report reference stays even after
-- the report itself is deleted by the daily clean-up.

create table public.customer_data_access (
  id           bigint generated always as identity primary key,
  property_id  uuid not null references public.properties (id) on delete cascade,
  request_id   uuid references public.customer_requests (id) on delete set null,
  reference    text not null,
  staff_id     uuid not null references public.staff (user_id),
  action       text not null check (action in ('viewed_report')),
  created_at   timestamptz not null default now()
);
create index customer_data_access_property_idx on public.customer_data_access (property_id, created_at desc);
create index customer_data_access_recent_idx on public.customer_data_access (staff_id, request_id, created_at desc);

alter table public.customer_data_access enable row level security;
revoke all on public.customer_data_access from public, anon, authenticated;
grant select on public.customer_data_access to authenticated;
create policy customer_data_access_select on public.customer_data_access
  for select to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'));

-- Records that the signed-in staff member opened this report. Only for a
-- report they are allowed to see (the same rule as the report itself).
create or replace function public.log_report_view(p_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.customer_requests;
begin
  if me is null or not public.can_see_request(p_request_id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select * into r from public.customer_requests where id = p_request_id;
  if exists (select 1 from public.customer_data_access a
              where a.staff_id = me and a.request_id = r.id and a.created_at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.customer_data_access (property_id, request_id, reference, staff_id, action)
  values (r.property_id, r.id, r.reference, me, 'viewed_report');
  -- Keep a year.
  delete from public.customer_data_access
   where property_id = r.property_id and created_at < now() - interval '1 year';
end;
$$;
revoke all on function public.log_report_view(uuid) from public, anon;
grant execute on function public.log_report_view(uuid) to authenticated;
