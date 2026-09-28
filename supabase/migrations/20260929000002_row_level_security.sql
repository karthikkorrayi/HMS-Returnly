-- HMS Returnly — row-level security
-- Every row is scoped to the signed-in staff member's property.
-- Workflow changes (status, storage, matching, handover) go through the
-- security-definer functions in the next migration, never direct writes.

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can read staff without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_property_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select property_id from public.staff
  where user_id = auth.uid() and active
$$;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff
  where user_id = auth.uid() and active
$$;

create or replace function public.has_role(roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() = any (roles), false)
$$;

create or replace function public.item_in_my_property(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.lost_items
    where id = p_item_id and property_id = public.current_property_id()
  )
$$;

revoke all on function public.current_property_id()          from public, anon;
revoke all on function public.current_staff_role()           from public, anon;
revoke all on function public.has_role(public.staff_role[])  from public, anon;
revoke all on function public.item_in_my_property(uuid)      from public, anon;
grant execute on function public.current_property_id()          to authenticated;
grant execute on function public.current_staff_role()           to authenticated;
grant execute on function public.has_role(public.staff_role[])  to authenticated;
grant execute on function public.item_in_my_property(uuid)      to authenticated;

-- Nothing in this app is public.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.properties         enable row level security;
alter table public.staff              enable row level security;
alter table public.rooms              enable row level security;
alter table public.storage_locations  enable row level security;
alter table public.lost_items         enable row level security;
alter table public.item_photos        enable row level security;
alter table public.guest_candidates   enable row level security;
alter table public.custody_events     enable row level security;
alter table public.handovers          enable row level security;

-- ---------------------------------------------------------------------------
-- properties / staff: read-only for staff; staff accounts are created by the
-- server with the service key after checking the caller is a manager.
-- ---------------------------------------------------------------------------
create policy properties_select on public.properties
  for select to authenticated
  using (id = public.current_property_id());

create policy staff_select on public.staff
  for select to authenticated
  using (property_id = public.current_property_id());

-- ---------------------------------------------------------------------------
-- rooms / storage locations: everyone reads, managers maintain
-- ---------------------------------------------------------------------------
create policy rooms_select on public.rooms
  for select to authenticated
  using (property_id = public.current_property_id());

create policy rooms_manage on public.rooms
  for all to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'))
  with check (property_id = public.current_property_id() and public.has_role('{manager}'));

create policy locations_select on public.storage_locations
  for select to authenticated
  using (property_id = public.current_property_id());

create policy locations_manage on public.storage_locations
  for all to authenticated
  using (property_id = public.current_property_id() and public.has_role('{manager}'))
  with check (property_id = public.current_property_id() and public.has_role('{manager}'));

-- ---------------------------------------------------------------------------
-- lost_items
-- ---------------------------------------------------------------------------
create policy items_select on public.lost_items
  for select to authenticated
  using (property_id = public.current_property_id());

-- Any active staff member logs items for their own property, as themselves.
create policy items_insert on public.lost_items
  for insert to authenticated
  with check (
    property_id = public.current_property_id()
    and found_by = auth.uid()
  );

-- Front office / managers may correct descriptive fields; the guard trigger
-- blocks workflow columns.
create policy items_update on public.lost_items
  for update to authenticated
  using (property_id = public.current_property_id()
         and public.has_role('{front_office,manager}'))
  with check (property_id = public.current_property_id());

-- No delete policy: items are closed through a handover, never deleted.

-- ---------------------------------------------------------------------------
-- item_photos
-- ---------------------------------------------------------------------------
create policy photos_select on public.item_photos
  for select to authenticated
  using (public.item_in_my_property(item_id));

create policy photos_insert on public.item_photos
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.lost_items i
      where i.id = item_id
        and i.property_id = public.current_property_id()
        and i.value_tier <> 'sensitive'
        and i.status not in ('returned', 'disposed', 'donated')
    )
  );

create policy photos_delete on public.item_photos
  for delete to authenticated
  using (public.item_in_my_property(item_id) and public.has_role('{manager}'));

-- ---------------------------------------------------------------------------
-- guest_candidates: front office adds/removes unconfirmed candidates;
-- confirming goes through confirm_candidate()
-- ---------------------------------------------------------------------------
create policy candidates_select on public.guest_candidates
  for select to authenticated
  using (public.item_in_my_property(item_id));

create policy candidates_insert on public.guest_candidates
  for insert to authenticated
  with check (
    public.has_role('{front_office,manager}')
    and added_by = auth.uid()
    and confirmed = false
    and confirmed_by is null
    and confirmed_at is null
    and exists (
      select 1 from public.lost_items i
      where i.id = item_id
        and i.property_id = public.current_property_id()
        and i.status not in ('returned', 'disposed', 'donated')
    )
  );

create policy candidates_delete on public.guest_candidates
  for delete to authenticated
  using (
    public.has_role('{front_office,manager}')
    and confirmed = false
    and public.item_in_my_property(item_id)
  );

-- ---------------------------------------------------------------------------
-- custody_events / handovers: read-only to clients (written by functions)
-- ---------------------------------------------------------------------------
create policy custody_select on public.custody_events
  for select to authenticated
  using (public.item_in_my_property(item_id));

create policy handovers_select on public.handovers
  for select to authenticated
  using (public.item_in_my_property(item_id));
