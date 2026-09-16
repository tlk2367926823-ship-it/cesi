-- REVIEW AND RUN MANUALLY IN THE PRODUCT'S SUPABASE SQL EDITOR.
-- This file is not executed by the app, build, or tests.
--
-- Keep XHS_SHARE_ENABLED unset/false until the SDK application is approved,
-- this migration is installed, and an authorized staging integration passes.
-- Mini-program filing alone is not evidence of web sharing API entitlement.
-- Server-only Netlify variables:
--   XHS_SHARE_ENABLED=true
--   XHS_APP_KEY=<web sharing application key>
--   XHS_APP_SECRET=<web sharing application secret>
--   SUPABASE_URL=<the shared Supabase project URL>
--   SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
-- Never prefix secrets with VITE_ or put them in frontend files.
--
-- Origins come from Netlify URL, DEPLOY_PRIME_URL, and the comma/space-separated
-- XHS_ALLOWED_ORIGINS variable. Explicit HTTPS origins only; no wildcards.
-- For local Netlify Dev, explicitly include http://localhost:8888, and the
-- actual Vite origin (for example http://localhost:5173) when cross-origin.
-- Do not add localhost to the production allowlist. Configure SDK platform
-- domain restrictions separately. CORS is not authentication or rate limiting.
--
-- All deployments using an appKey must use THIS SAME cache. Disable any other
-- token refresh jobs first. A new official token invalidates the old token.
-- Claiming starts refresh only after all previously issued signatures expire
-- (token expiry minus 60 seconds); the lease lasts 60 seconds and HTTP 10.
-- Do not manually clear a live row or rotate a token while signatures are valid.
--
-- Contract source: https://agora.xiaohongshu.com/doc/js
-- Verified public page bundle: main.e465c74.js.
-- Token expires_in is an absolute millisecond deadline, not a duration.
-- Its Java example sorts appKey/nonce/timeStamp, joins raw key=value pairs
-- with &, appends the secret directly, and computes SHA-256 UTF-8 hex.
-- The public guide lists access_token/expires_in but does not show a complete
-- success JSON envelope. The server accepts those documented top-level fields;
-- unknown envelopes FAIL CLOSED. Before enabling production, verify an actual
-- authorized response, add a redacted fixture if its wrapper differs, and test
-- SDK sharing on a real device. No live request has been claimed by this file.

begin;

create table if not exists public.xhs_share_token_cache (
  app_key text primary key check (length(app_key) between 1 and 256),
  access_token text check (access_token is null or length(access_token) between 1 and 8192),
  expires_at_ms bigint not null default 0,
  lease_owner uuid,
  lease_until_ms bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.xhs_share_token_cache enable row level security;
revoke all on table public.xhs_share_token_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.xhs_share_token_cache to service_role;

create or replace function public.xhs_share_token_claim(p_app_key text, p_lease_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cached public.xhs_share_token_cache%rowtype;
  now_ms bigint;
begin
  if p_app_key is null or length(p_app_key) not between 1 and 256 or p_lease_owner is null then
    raise exception 'Invalid cache claim' using errcode = '22023';
  end if;

  insert into public.xhs_share_token_cache (app_key)
  values (p_app_key)
  on conflict (app_key) do nothing;

  select * into cached from public.xhs_share_token_cache
  where app_key = p_app_key for update;
  now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  if cached.access_token is not null and cached.expires_at_ms > now_ms + 60000 then
    return jsonb_build_object(
      'state', 'ready',
      'access_token', cached.access_token,
      'expires_at_ms', cached.expires_at_ms
    );
  end if;
  if cached.lease_until_ms > now_ms then
    return jsonb_build_object('state', 'busy');
  end if;

  update public.xhs_share_token_cache
  set access_token = null, expires_at_ms = 0,
      lease_owner = p_lease_owner, lease_until_ms = now_ms + 60000,
      updated_at = clock_timestamp()
  where app_key = p_app_key;
  return jsonb_build_object('state', 'refresh');
end;
$$;

create or replace function public.xhs_share_token_store(
  p_app_key text, p_lease_owner uuid, p_access_token text, p_expires_at_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cached public.xhs_share_token_cache%rowtype;
  now_ms bigint;
begin
  if p_access_token is null or length(p_access_token) not between 1 and 8192 then
    raise exception 'Invalid cache token' using errcode = '22023';
  end if;
  select * into cached from public.xhs_share_token_cache
  where app_key = p_app_key for update;
  if not found then return false; end if;
  now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  if p_lease_owner is null or cached.lease_owner is distinct from p_lease_owner
    or cached.lease_until_ms <= now_ms then
    return false;
  end if;
  if p_expires_at_ms is null or p_expires_at_ms <= now_ms + 60000
    or p_expires_at_ms > now_ms + 86400000 then
    raise exception 'Invalid cache expiry' using errcode = '22023';
  end if;

  update public.xhs_share_token_cache
  set access_token = p_access_token, expires_at_ms = p_expires_at_ms,
      lease_owner = null, lease_until_ms = 0, updated_at = clock_timestamp()
  where app_key = p_app_key;
  return true;
end;
$$;

create or replace function public.xhs_share_token_fail(p_app_key text, p_lease_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Preserve lease_until_ms as a cooldown when upstream outcome is uncertain.
  update public.xhs_share_token_cache
  set access_token = null, expires_at_ms = 0,
      lease_owner = null, updated_at = clock_timestamp()
  where app_key = p_app_key and lease_owner = p_lease_owner;
end;
$$;

revoke all on function public.xhs_share_token_claim(text, uuid) from public, anon, authenticated;
revoke all on function public.xhs_share_token_store(text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.xhs_share_token_fail(text, uuid) from public, anon, authenticated;
grant execute on function public.xhs_share_token_claim(text, uuid) to service_role;
grant execute on function public.xhs_share_token_store(text, uuid, text, bigint) to service_role;
grant execute on function public.xhs_share_token_fail(text, uuid) to service_role;

commit;
