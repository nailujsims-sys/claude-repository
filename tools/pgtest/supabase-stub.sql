-- The parts of a Supabase project the migrations depend on, so they can be
-- applied to a throwaway Postgres and the RLS assertions can be checked for
-- real (see tools/rlsTest.mjs). This file is NEVER run against Supabase —
-- there, all of this already exists and is owned by the platform.

-- Roles belong to the cluster, not to a database, so a second database in the
-- same cluster finds them already there. Created only if missing, which is what
-- lets the upgrade probe build its own database beside the main one.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

-- Supabase ships this publication with every project; Realtime reads the WAL
-- through it, and 0004_realtime.sql adds tables to it. A throwaway cluster has
-- no such publication, so `alter publication ... add table` aborted the whole
-- run before it reached a single assertion — which is why this file has to
-- create it too. Empty on purpose: the migrations put the tables in.
create publication supabase_realtime;

create schema if not exists auth;

-- Only the columns the app and the migrations actually touch.
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Supabase derives the current user from the request's JWT claims. The claims
-- are set with set_config() in the tests, exactly as PostgREST sets them.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase Storage, as far as 0016 leans on it: the bucket table it inserts
-- into, the object table its policies guard, and `storage.foldername()`, the
-- helper those policies call. On Supabase all three ship with the project and
-- `storage.objects` already has Row Level Security switched on — so it is
-- switched on here too, or the policies would be decoration.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                  text primary key,
  name                text not null,
  public              boolean not null default false,
  file_size_limit     bigint,
  allowed_mime_types  text[],
  created_at          timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text not null,
  owner       uuid,
  created_at  timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Supabase's definition: every path segment except the file name.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
