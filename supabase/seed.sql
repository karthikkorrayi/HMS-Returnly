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
