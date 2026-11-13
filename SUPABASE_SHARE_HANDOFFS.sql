create extension if not exists pgcrypto;

create table if not exists public.share_handoffs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 8000),
  tags jsonb not null check (jsonb_typeof(tags) = 'array'),
  image_url text not null check (char_length(image_url) between 1 and 2048),
  source text not null default 'unknown' check (source in ('nfc', 'qrcode', 'qr', 'direct', 'unknown')),
  status text not null default 'created' check (status in ('created', 'opened')),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists share_handoffs_expires_at_idx
  on public.share_handoffs (expires_at);

alter table public.share_handoffs enable row level security;
revoke all on table public.share_handoffs from public, anon, authenticated;
grant select, insert, update, delete on table public.share_handoffs to service_role;

comment on table public.share_handoffs is
  'Short-lived server-only drafts used to hand H5 content to the Xiaohongshu miniapp.';
