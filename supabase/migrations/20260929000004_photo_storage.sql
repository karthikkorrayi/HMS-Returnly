-- HMS Returnly — photo storage
-- Private bucket; objects live at {property_id}/{item_id}/{uuid}.jpg and are
-- served to staff through short-lived signed URLs only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy item_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );

create policy item_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = public.current_property_id()::text
    and exists (
      select 1 from public.lost_items i
      where i.id::text = (storage.foldername(name))[2]
        and i.property_id = public.current_property_id()
        and i.value_tier <> 'sensitive'
        and i.status not in ('returned', 'disposed', 'donated')
    )
  );

create policy item_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = public.current_property_id()::text
    and public.has_role('{manager}')
  );
