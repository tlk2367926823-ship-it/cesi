insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-assets',
  'merchant-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read merchant assets" on storage.objects;
create policy "Public can read merchant assets"
on storage.objects
for select
using (bucket_id = 'merchant-assets');

drop policy if exists "Authenticated users can upload merchant assets" on storage.objects;
create policy "Authenticated users can upload merchant assets"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'merchant-assets');

drop policy if exists "Authenticated users can update merchant assets" on storage.objects;
create policy "Authenticated users can update merchant assets"
on storage.objects
for update
to authenticated
using (bucket_id = 'merchant-assets')
with check (bucket_id = 'merchant-assets');
