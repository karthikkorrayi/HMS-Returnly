-- HMS Returnly — demo seed data (development only; no real hotel data)
-- Staff accounts are not seeded here: create the first manager with
--   npm run create-staff -- --property DEMO --username demo.manager --name "Demo Manager" --role manager

insert into public.properties (inn_code, name, retention_days)
values ('DEMO', 'Demo Hotel', 90)
on conflict (inn_code) do nothing;

insert into public.rooms (property_id, room_number, floor)
select p.id, f.floor::text || lpad(n::text, 2, '0'), f.floor::text
from public.properties p
cross join generate_series(1, 3) as f(floor)
cross join generate_series(1, 12) as n
where p.inn_code = 'DEMO'
on conflict do nothing;

insert into public.storage_locations (property_id, label, is_secure)
select p.id, l.label, l.is_secure
from public.properties p
cross join (values
  ('Housekeeping office — shelf A', false),
  ('Housekeeping office — shelf B', false),
  ('Front desk safe', true),
  ('Back office safe', true)
) as l(label, is_secure)
where p.inn_code = 'DEMO'
on conflict do nothing;

-- Railway only (migration 012 and later): floors, public areas, and "already
-- set up" for the demo hotel, so local development skips the first-time setup
-- screen. Skipped where those tables don't exist (the Supabase schema).
do $$
begin
  if to_regclass('public.installation') is null then
    return;
  end if;
  execute $sql$
    insert into public.floors (property_id, name, sort_order)
    select p.id, f.n::text, f.n from public.properties p cross join generate_series(1, 3) as f(n)
    where p.inn_code = 'DEMO'
    on conflict do nothing;

    update public.rooms r set floor_id = f.id
    from public.floors f, public.properties p
    where p.inn_code = 'DEMO' and r.property_id = p.id and f.property_id = p.id
      and f.name = r.floor and r.floor_id is null;

    insert into public.areas (property_id, label, sort_order)
    select p.id, a.label, a.n::int from public.properties p
    cross join unnest(array['Lobby', 'Restaurant', 'Bar', 'Gym', 'Pool', 'Meeting rooms',
                            'Car park', 'Lifts', 'Corridor']) with ordinality as a(label, n)
    where p.inn_code = 'DEMO'
    on conflict do nothing;

    insert into public.installation (property_id)
    select id from public.properties where inn_code = 'DEMO'
    on conflict do nothing;
  $sql$;
end $$;
