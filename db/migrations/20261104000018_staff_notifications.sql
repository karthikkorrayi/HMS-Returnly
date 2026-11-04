-- Foundora — PR D: in-app notifications for hotel staff
--
-- Additive. Hotel staff are told about new reports, guest replies and
-- assignments inside the app (a bell with an unread count), not by email.
-- Notifications are written by a trigger on request_events, in the same
-- transaction as the event, like the customer emails (migration 017).
--
-- Who sees what (row-level security, same rules as the reports themselves):
--   recipient_id null  → every active manager of that hotel
--   recipient_id set   → that staff member only (e.g. "assigned to you")
-- Events:
--   submitted         → managers: "New lost/found item report LF-… · <item>"
--   customer_replied  → managers, and the assigned support member
--   assigned          → the person it was assigned to (unless they did it)
-- Read/unread is per person (staff_notification_reads). The text names the
-- reference and item only, never the customer's name, email or booking ID.
-- Notifications go with their report when the daily clean-up deletes it.

create table public.staff_notifications (
  id            bigint generated always as identity primary key,
  property_id   uuid not null references public.properties (id) on delete cascade,
  request_id    uuid not null references public.customer_requests (id) on delete cascade,
  recipient_id  uuid references public.staff (user_id) on delete cascade,
  kind          text not null check (kind in ('new_report', 'customer_replied', 'assigned')),
  message       text not null check (length(message) between 1 and 200),
  created_at    timestamptz not null default now()
);
create index staff_notifications_property_idx on public.staff_notifications (property_id, created_at desc);
create index staff_notifications_recipient_idx on public.staff_notifications (recipient_id, created_at desc) where recipient_id is not null;

create table public.staff_notification_reads (
  notification_id  bigint not null references public.staff_notifications (id) on delete cascade,
  user_id          uuid not null references public.staff (user_id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.staff_notifications enable row level security;
alter table public.staff_notification_reads enable row level security;
revoke all on public.staff_notifications, public.staff_notification_reads from public, anon, authenticated;
grant select on public.staff_notifications, public.staff_notification_reads to authenticated;

-- Can the signed-in staff member see this notification?
create or replace function public.can_see_notification(n public.staff_notifications)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select n.property_id = public.current_property_id()
     and (n.recipient_id = auth.uid() or (n.recipient_id is null and public.has_role('{manager}')))
$$;
revoke all on function public.can_see_notification(public.staff_notifications) from public, anon;
grant execute on function public.can_see_notification(public.staff_notifications) to authenticated;

create policy staff_notifications_select on public.staff_notifications
  for select to authenticated using (public.can_see_notification(staff_notifications));
create policy staff_notification_reads_select on public.staff_notification_reads
  for select to authenticated using (user_id = auth.uid());

-- Mark notifications read for the signed-in person. p_ids: comma-separated
-- ids, or null/'' for "all of mine". Only notifications they can see.
create or replace function public.mark_notifications_read(p_ids text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if me is null or public.current_property_id() is null then
    raise exception 'Sign in again' using errcode = '42501';
  end if;
  if p_ids is not null and p_ids <> '' and p_ids !~ '^[0-9]{1,18}(,[0-9]{1,18}){0,199}$' then
    raise exception 'Unknown notification' using errcode = '22023';
  end if;
  insert into public.staff_notification_reads (notification_id, user_id)
  select s.id, me from public.staff_notifications s
   where public.can_see_notification(s)
     and (p_ids is null or p_ids = '' or s.id = any(string_to_array(p_ids, ',')::bigint[]))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mark_notifications_read(text) from public, anon;
grant execute on function public.mark_notifications_read(text) to authenticated;

create or replace function public._notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.customer_requests;
  v_assignee public.staff;
  v_what text;
begin
  if new.action not in ('submitted', 'customer_replied', 'assigned') then
    return new;
  end if;
  select * into r from public.customer_requests where id = new.request_id;
  if not found then
    return new;
  end if;
  v_what := r.reference || ' · ' || left(r.item_name, 80);

  if new.action = 'submitted' then
    insert into public.staff_notifications (property_id, request_id, kind, message)
    values (r.property_id, r.id, 'new_report',
            case r.report_type when 'found' then 'New found item report ' else 'New lost item report ' end || v_what);
  elsif new.action = 'customer_replied' then
    insert into public.staff_notifications (property_id, request_id, kind, message)
    values (r.property_id, r.id, 'customer_replied',
            case r.report_type when 'found' then 'The finder replied on ' else 'The guest replied on ' end || v_what);
    select * into v_assignee from public.staff where user_id = r.assigned_to and active;
    if found and v_assignee.role = 'support' then
      insert into public.staff_notifications (property_id, request_id, recipient_id, kind, message)
      values (r.property_id, r.id, v_assignee.user_id, 'customer_replied',
              case r.report_type when 'found' then 'The finder replied on ' else 'The guest replied on ' end || v_what);
    end if;
  elsif new.action = 'assigned' and r.assigned_to is not null and r.assigned_to is distinct from new.actor then
    insert into public.staff_notifications (property_id, request_id, recipient_id, kind, message)
    values (r.property_id, r.id, r.assigned_to, 'assigned', 'Assigned to you: ' || v_what);
  end if;
  return new;
end;
$$;
revoke all on function public._notify_staff() from public, anon, authenticated;

create trigger request_events_notify_staff
  after insert on public.request_events
  for each row execute function public._notify_staff();
