-- HMS Returnly — guest support details on the public pages (Railway only)
--
-- The hotel's contact and support details (migration 012) are entered at setup
-- and edited by managers. Guests see them on the public enquiry page. Like
-- public_properties(), this returns only what is meant for the public: never
-- addresses of staff, settings or anything else.

create or replace function public.public_hotel_contacts()
returns table (inn_code text, contact_phone text, contact_email text, support_hours text, support_note text)
language sql
stable
security definer
set search_path = public
as $$
  select p.inn_code, p.contact_phone, p.contact_email, p.support_hours, p.support_note
    from public.properties p
   order by p.name
$$;
revoke all on function public.public_hotel_contacts() from public;
grant execute on function public.public_hotel_contacts() to anon;
