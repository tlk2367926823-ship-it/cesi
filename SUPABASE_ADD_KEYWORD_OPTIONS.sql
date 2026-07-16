alter table public.merchants
  add column if not exists service_keywords text[] default '{}',
  add column if not exists feature_keywords text[] default '{}',
  add column if not exists length_options text[] default '{}';
