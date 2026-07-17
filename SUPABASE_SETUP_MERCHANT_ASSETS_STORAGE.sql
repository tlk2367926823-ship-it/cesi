-- Run this once in Supabase SQL Editor after creating the merchant-assets bucket.
-- It lets logged-in merchants/admins upload images and lets the app read public image URLs.

create policy if not exists "merchant assets public read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'merchant-assets');

create policy if not exists "authenticated users can upload merchant assets"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'merchant-assets');

create policy if not exists "authenticated users can update merchant assets"
on storage.objects
for update
to authenticated
using (bucket_id = 'merchant-assets')
with check (bucket_id = 'merchant-assets');

create policy if not exists "authenticated users can delete merchant assets"
on storage.objects
for delete
to authenticated
using (bucket_id = 'merchant-assets');
