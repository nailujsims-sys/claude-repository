-- The parts of a Supabase project the migrations depend on, so they can be
-- applied to a throwaway Postgres and the RLS assertions can be checked for
-- real (see tools/rlsTest.mjs). This file is NEVER run against Supabase —
-- there, all of this already exists and is owned by the platform.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

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
