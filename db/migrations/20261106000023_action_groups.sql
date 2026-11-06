-- Work organisation is independent of custody status and business transitions.
alter table public.properties add column action_board_version integer not null default 0 check (action_board_version >= 0);
create table public.action_groups (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 title text not null check (length(trim(title)) between 1 and 60), position bigint not null,
 unique(id,property_id)
);
create unique index action_groups_title on public.action_groups(property_id,lower(title));
create table public.action_group_items (
 item_id uuid primary key references public.lost_items(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 group_id uuid, position bigint not null,
 foreign key(group_id,property_id) references public.action_groups(id,property_id) on delete cascade
);
create index action_group_items_order on public.action_group_items(property_id,group_id,position,item_id);
alter table public.action_groups enable row level security;
alter table public.action_group_items enable row level security;
revoke all on public.action_groups,public.action_group_items from public,anon,authenticated;
grant select on public.action_groups,public.action_group_items to authenticated;
create policy action_groups_read on public.action_groups for select to authenticated using
 (property_id=public.current_property_id() and public.has_role('{housekeeping,front_office,manager}'));
create policy action_group_items_read on public.action_group_items for select to authenticated using
 (property_id=public.current_property_id() and public.has_role('{housekeeping,front_office,manager}'));
create or replace function public.organise_action_board(p_expected integer,p_kind text,p_group uuid default null,p_item uuid default null,p_before uuid default null,p_title text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_prop uuid:=public.current_property_id(); v_version integer; v_position bigint; v_max bigint;
begin
 if v_prop is null or not public.has_role('{housekeeping,front_office,manager}') then
  raise exception 'Your role cannot organise found items.' using errcode='42501';
 end if;
 select action_board_version into v_version from public.properties where id=v_prop for update;
 if p_expected is null or p_expected<>v_version then
  raise exception 'The board changed in another session. Refresh it and try again.' using errcode='P0001';
 end if;
 if p_kind not in ('create_group','rename_group','delete_group','move_group','move_item') or p_kind is null then
  raise exception 'Unknown board action.' using errcode='22023';
 end if;
 if p_kind<>'move_item' and not public.has_role('{manager}') then
  raise exception 'Only managers can change action groups.' using errcode='42501';
 end if;
 if p_kind in ('create_group','rename_group') and (p_title is null or length(trim(p_title)) not between 1 and 60) then
  raise exception 'Use a group name of 1–60 characters.' using errcode='22023';
 end if;
 if p_kind in ('rename_group','delete_group','move_group') and not exists(select 1 from public.action_groups where id=p_group and property_id=v_prop) then
  raise exception 'Group not found at your hotel.' using errcode='22023';
 end if;
 if p_kind='create_group' then
  insert into public.action_groups(property_id,title,position) values(v_prop,trim(p_title),coalesce((select max(position) from public.action_groups where property_id=v_prop),0)+1);
 elsif p_kind='rename_group' then
  update public.action_groups set title=trim(p_title) where id=p_group and property_id=v_prop;
 elsif p_kind='delete_group' then
  -- Deleting the mapping returns items to Unassigned; it never deletes lost items.
  delete from public.action_groups where id=p_group and property_id=v_prop;
 elsif p_kind='move_group' then
  if p_before=p_group then return v_version; end if;
  if p_before is null then select coalesce(max(position),0)+1 into v_position from public.action_groups where property_id=v_prop;
  else
   select position into v_position from public.action_groups where id=p_before and property_id=v_prop;
   if not found then raise exception 'Target group not found at your hotel.' using errcode='22023'; end if;
  end if;
  update public.action_groups set position=position+1 where property_id=v_prop and position>=v_position and id<>p_group;
  update public.action_groups set position=v_position where id=p_group and property_id=v_prop;
 else
  if not exists(select 1 from public.lost_items where id=p_item and property_id=v_prop) then
   raise exception 'Item not found at your hotel.' using errcode='22023';
  end if;
  if p_group is not null and not exists(select 1 from public.action_groups where id=p_group and property_id=v_prop) then
   raise exception 'Group not found at your hotel.' using errcode='22023';
  end if;
  if p_before=p_item then return v_version; end if;
  -- Initialise new arrivals after existing unassigned cards. Serialised by the hotel version lock.
  select coalesce(max(position),0) into v_max from public.action_group_items where property_id=v_prop and group_id is null;
  insert into public.action_group_items(item_id,property_id,group_id,position)
   select i.id,v_prop,null,v_max+row_number() over(order by i.found_at desc,i.id)
   from public.lost_items i where i.property_id=v_prop and not exists(select 1 from public.action_group_items b where b.item_id=i.id)
   on conflict(item_id) do nothing;
  if p_before is null then
   select coalesce(max(position),0)+1 into v_position from public.action_group_items where property_id=v_prop and group_id is not distinct from p_group;
  else
   select position into v_position from public.action_group_items where item_id=p_before and property_id=v_prop and group_id is not distinct from p_group;
   if not found then raise exception 'Target item is not in this group.' using errcode='22023'; end if;
  end if;
  update public.action_group_items set position=position+1 where property_id=v_prop and group_id is not distinct from p_group and position>=v_position and item_id<>p_item;
  update public.action_group_items set group_id=p_group,position=v_position where item_id=p_item and property_id=v_prop;
 end if;
 update public.properties set action_board_version=action_board_version+1 where id=v_prop returning action_board_version into v_version;
 return v_version;
end;
$$;
revoke all on function public.organise_action_board(integer,text,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.organise_action_board(integer,text,uuid,uuid,uuid,text) to authenticated;
