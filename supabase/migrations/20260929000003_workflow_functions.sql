-- HMS Returnly — workflow functions
-- The only way status, storage location, value tier, matching and handovers
-- change. Each function checks role + property, validates the transition,
-- and writes the custody ledger in the same transaction.
--
-- Transitions:
--   logged            → stored                                 (any role, needs location)
--   stored/matched    → matched               via confirm_candidate   (front office, manager)
--   matched…awaiting  → stored                via unconfirm_candidate (front office, manager)
--   matched           → guest_contacted                         (front office, manager)
--   guest_contacted   → awaiting_collection | awaiting_shipping (front office, manager)
--   awaiting_*        ↔ awaiting_*                              (front office, manager)
--   awaiting_collection → returned            via record_handover in_person
--   awaiting_shipping   → returned            via record_handover courier
--   stored/matched/guest_contacted → disposed | donated
--                                             via record_handover (manager, after retention)

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public._require_staff()
returns public.staff
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.staff;
begin
  select * into s from public.staff where user_id = auth.uid() and active;
  if not found then
    raise exception 'Not an active staff member' using errcode = '42501';
  end if;
  return s;
end;
$$;

create or replace function public._lock_item(p_item_id uuid, p_property_id uuid)
returns public.lost_items
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.lost_items;
begin
  select * into i from public.lost_items
  where id = p_item_id and property_id = p_property_id
  for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  return i;
end;
$$;

create or replace function public._check_location(
  p_location_id uuid, p_property_id uuid, p_tier public.value_tier)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.storage_locations;
begin
  if p_location_id is null then
    raise exception 'Choose a storage location';
  end if;
  select * into l from public.storage_locations
  where id = p_location_id and property_id = p_property_id and active;
  if not found then
    raise exception 'Unknown storage location';
  end if;
  if p_tier <> 'standard' and not l.is_secure then
    raise exception 'Valuable and sensitive items must go in a secure location';
  end if;
end;
$$;

revoke all on function public._require_staff()                                   from public, anon, authenticated;
revoke all on function public._lock_item(uuid, uuid)                             from public, anon, authenticated;
revoke all on function public._check_location(uuid, uuid, public.value_tier)     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- change_status: simple forward moves
-- ---------------------------------------------------------------------------
create or replace function public.change_status(
  p_item_id              uuid,
  p_to                   public.item_status,
  p_storage_location_id  uuid default null,
  p_note                 text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  i public.lost_items;
  ok boolean := false;
begin
  i := public._lock_item(p_item_id, s.property_id);

  if p_to in ('matched', 'returned', 'disposed', 'donated') then
    raise exception 'Use matching or handover for this step';
  end if;

  if i.status = 'logged' and p_to = 'stored' then
    perform public._check_location(p_storage_location_id, s.property_id, i.value_tier);
    ok := true;
  elsif s.role in ('front_office', 'manager') then
    ok := (i.status = 'matched'             and p_to = 'guest_contacted')
       or (i.status = 'guest_contacted'     and p_to in ('awaiting_collection', 'awaiting_shipping'))
       or (i.status = 'awaiting_collection' and p_to = 'awaiting_shipping')
       or (i.status = 'awaiting_shipping'   and p_to = 'awaiting_collection');
  end if;

  if not ok then
    raise exception 'Cannot move item from % to %', i.status, p_to;
  end if;

  update public.lost_items
     set status = p_to,
         storage_location_id = case when p_to = 'stored' then p_storage_location_id
                                    else storage_location_id end
   where id = i.id;

  insert into public.custody_events (item_id, from_status, to_status, storage_location_id, actor, note)
  values (i.id, i.status, p_to,
          case when p_to = 'stored' then p_storage_location_id else i.storage_location_id end,
          s.user_id, nullif(trim(p_note), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- move_item: change storage location without changing status
-- ---------------------------------------------------------------------------
create or replace function public.move_item(
  p_item_id              uuid,
  p_storage_location_id  uuid,
  p_note                 text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  i public.lost_items;
begin
  i := public._lock_item(p_item_id, s.property_id);

  if i.status in ('logged', 'returned', 'disposed', 'donated') then
    raise exception 'Item cannot be moved while %', i.status;
  end if;
  if i.storage_location_id = p_storage_location_id then
    raise exception 'Item is already in that location';
  end if;
  perform public._check_location(p_storage_location_id, s.property_id, i.value_tier);

  update public.lost_items set storage_location_id = p_storage_location_id where id = i.id;

  insert into public.custody_events (item_id, from_status, to_status, storage_location_id, actor, note)
  values (i.id, i.status, i.status, p_storage_location_id, s.user_id,
          coalesce(nullif(trim(p_note), ''), 'Moved'));
end;
$$;

-- ---------------------------------------------------------------------------
-- set_value_tier: re-classify an item (e.g. housekeeping under-rated it)
-- ---------------------------------------------------------------------------
create or replace function public.set_value_tier(
  p_item_id  uuid,
  p_tier     public.value_tier,
  p_note     text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  i public.lost_items;
  l public.storage_locations;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can change the value tier' using errcode = '42501';
  end if;
  i := public._lock_item(p_item_id, s.property_id);

  if i.status in ('returned', 'disposed', 'donated') then
    raise exception 'Item is closed';
  end if;
  if i.value_tier = p_tier then
    return;
  end if;
  if p_tier = 'sensitive' and exists (select 1 from public.item_photos where item_id = i.id) then
    raise exception 'Sensitive items cannot have photos — a manager must delete them first';
  end if;
  if p_tier <> 'standard' and i.storage_location_id is not null then
    select * into l from public.storage_locations where id = i.storage_location_id;
    if not l.is_secure then
      raise exception 'Move the item to a secure location first';
    end if;
  end if;

  update public.lost_items set value_tier = p_tier where id = i.id;

  insert into public.custody_events (item_id, from_status, to_status, storage_location_id, actor, note)
  values (i.id, i.status, i.status, i.storage_location_id, s.user_id,
          'Value tier ' || i.value_tier || ' → ' || p_tier
          || coalesce(': ' || nullif(trim(p_note), ''), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_candidate / unconfirm_candidate
-- ---------------------------------------------------------------------------
create or replace function public.confirm_candidate(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  c public.guest_candidates;
  i public.lost_items;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can confirm a match' using errcode = '42501';
  end if;

  select * into c from public.guest_candidates where id = p_candidate_id;
  if not found then
    raise exception 'Candidate not found' using errcode = 'P0002';
  end if;
  i := public._lock_item(c.item_id, s.property_id);

  if c.confirmed then
    return;
  end if;
  if i.status not in ('stored', 'matched') then
    raise exception 'Only stored items can be matched (item is %)', i.status;
  end if;

  update public.guest_candidates
     set confirmed = false, confirmed_by = null, confirmed_at = null
   where item_id = i.id and confirmed;

  update public.guest_candidates
     set confirmed = true, confirmed_by = s.user_id, confirmed_at = now()
   where id = c.id;

  update public.lost_items set status = 'matched' where id = i.id;

  insert into public.custody_events (item_id, from_status, to_status, storage_location_id, actor, note)
  values (i.id, i.status, 'matched', i.storage_location_id, s.user_id,
          'Matched to reservation ' || c.reservation_ref);
end;
$$;

create or replace function public.unconfirm_candidate(p_candidate_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  c public.guest_candidates;
  i public.lost_items;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can undo a match' using errcode = '42501';
  end if;

  select * into c from public.guest_candidates where id = p_candidate_id;
  if not found or not c.confirmed then
    raise exception 'Candidate is not confirmed';
  end if;
  i := public._lock_item(c.item_id, s.property_id);

  if i.status not in ('matched', 'guest_contacted', 'awaiting_collection', 'awaiting_shipping') then
    raise exception 'Cannot undo a match while item is %', i.status;
  end if;

  update public.guest_candidates
     set confirmed = false, confirmed_by = null, confirmed_at = null
   where id = c.id;

  update public.lost_items set status = 'stored' where id = i.id;

  insert into public.custody_events (item_id, from_status, to_status, storage_location_id, actor, note)
  values (i.id, i.status, 'stored', i.storage_location_id, s.user_id,
          'Match to ' || c.reservation_ref || ' undone'
          || coalesce(': ' || nullif(trim(p_note), ''), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_handover: the only way an item is closed
-- ---------------------------------------------------------------------------
create or replace function public.record_handover(
  p_item_id           uuid,
  p_method            public.handover_method,
  p_id_checked        boolean default null,
  p_courier_tracking  text default null,
  p_witness           uuid default null,
  p_note              text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff := public._require_staff();
  i public.lost_items;
  v_to public.item_status;
begin
  if s.role not in ('front_office', 'manager') then
    raise exception 'Only front office or managers can record a handover' using errcode = '42501';
  end if;
  if p_method in ('disposed', 'donated') and s.role <> 'manager' then
    raise exception 'Only a manager can approve disposal or donation' using errcode = '42501';
  end if;

  i := public._lock_item(p_item_id, s.property_id);

  if p_method = 'in_person' then
    if i.status <> 'awaiting_collection' then
      raise exception 'Item is not awaiting collection';
    end if;
    if p_id_checked is not true then
      raise exception 'Confirm the guest''s ID was checked';
    end if;
    v_to := 'returned';
  elsif p_method = 'courier' then
    if i.status <> 'awaiting_shipping' then
      raise exception 'Item is not awaiting shipping';
    end if;
    if nullif(trim(p_courier_tracking), '') is null then
      raise exception 'Enter the courier tracking number';
    end if;
    v_to := 'returned';
  else
    if i.status not in ('stored', 'matched', 'guest_contacted') then
      raise exception 'Cannot % an item that is %', p_method, i.status;
    end if;
    if current_date < i.dispose_after then
      raise exception 'Retention period runs until %', i.dispose_after;
    end if;
    v_to := p_method::text::public.item_status;
  end if;

  if p_method in ('in_person', 'courier')
     and not exists (select 1 from public.guest_candidates where item_id = i.id and confirmed) then
    raise exception 'No confirmed reservation for this item';
  end if;

  if i.value_tier <> 'standard' or p_method in ('disposed', 'donated') then
    if p_witness is null then
      raise exception 'A second staff member must witness this handover';
    end if;
  end if;
  if p_witness is not null then
    if p_witness = s.user_id then
      raise exception 'The witness must be someone else';
    end if;
    if not exists (select 1 from public.staff
                   where user_id = p_witness and property_id = s.property_id and active) then
      raise exception 'Witness is not active staff at this hotel';
    end if;
  end if;

  insert into public.handovers
    (item_id, method, id_checked, courier_tracking, handed_over_by, witness, note)
  values
    (i.id, p_method,
     case when p_method = 'in_person' then true else p_id_checked end,
     nullif(trim(p_courier_tracking), ''),
     s.user_id, p_witness, nullif(trim(p_note), ''));

  update public.lost_items set status = v_to where id = i.id;

  insert into public.custody_events (item_id, from_status, to_status, storage_location_id, actor, note)
  values (i.id, i.status, v_to, i.storage_location_id, s.user_id,
          case p_method
            when 'in_person' then 'Handed to guest (ID checked)'
            when 'courier'   then 'Shipped, tracking ' || trim(p_courier_tracking)
            when 'disposed'  then 'Disposed after retention period'
            when 'donated'   then 'Donated after retention period'
          end
          || coalesce(': ' || nullif(trim(p_note), ''), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.change_status(uuid, public.item_status, uuid, text) from public, anon;
revoke all on function public.move_item(uuid, uuid, text)                        from public, anon;
revoke all on function public.set_value_tier(uuid, public.value_tier, text)      from public, anon;
revoke all on function public.confirm_candidate(uuid)                            from public, anon;
revoke all on function public.unconfirm_candidate(uuid, text)                    from public, anon;
revoke all on function public.record_handover(uuid, public.handover_method, boolean, text, uuid, text) from public, anon;

grant execute on function public.change_status(uuid, public.item_status, uuid, text) to authenticated;
grant execute on function public.move_item(uuid, uuid, text)                        to authenticated;
grant execute on function public.set_value_tier(uuid, public.value_tier, text)      to authenticated;
grant execute on function public.confirm_candidate(uuid)                            to authenticated;
grant execute on function public.unconfirm_candidate(uuid, text)                    to authenticated;
grant execute on function public.record_handover(uuid, public.handover_method, boolean, text, uuid, text) to authenticated;
