-- Mind Whiteboard — Trading-Setups (eine Bibliothek von Setups aus Videos).
-- Follows the pattern documented in 0001_foundation exactly: own id, owner,
-- timestamps, indexes, RLS, grants, updated_at trigger, Realtime. Safe to run
-- twice, like every migration before it.
--
-- TWO TABLES AND ONE BUCKET
--   trading_assets  — the user's own list of instruments ("NQ", "EURUSD").
--                     A table rather than free text on the setup, because the
--                     form offers them as a choice and the library filters by
--                     them: "nq" and "NQ " must not become two filter chips.
--   trading_setups  — one setup: a name, a few facts, a screenshot.
--   storage bucket  — `trading-screenshots`, PRIVATE. The screenshot is the
--                     heart of a setup and personal data like every other row,
--                     so it is never reachable by a public URL; the client asks
--                     for short-lived signed URLs instead.
--
-- Deliberately NOT here: trades, outcomes, statistics, tags. The module is a
-- library to collect and compare setups, not a journal or a backtester — every
-- one of those would be a column nobody fills in while watching a video.

-- ── trading_assets ─────────────────────────────────────────────────────────
create table if not exists public.trading_assets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trading_assets_name_not_blank check (char_length(btrim(name)) > 0),
  constraint trading_assets_name_len check (char_length(name) <= 40),
  -- The target of the composite foreign key below: a setup may only point at an
  -- asset of the SAME user. RLS alone would not stop that — it checks the row
  -- being written, not the row it references.
  constraint trading_assets_id_user_key unique (id, user_id)
);

-- One spelling per asset and user. Case and surrounding spaces do not make a
-- second asset; the client trims, this is the guarantee.
create unique index if not exists trading_assets_user_name_idx
  on public.trading_assets (user_id, lower(btrim(name)));

alter table public.trading_assets enable row level security;

drop policy if exists "trading_assets_select_own" on public.trading_assets;
create policy "trading_assets_select_own" on public.trading_assets
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "trading_assets_insert_own" on public.trading_assets;
create policy "trading_assets_insert_own" on public.trading_assets
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "trading_assets_update_own" on public.trading_assets;
create policy "trading_assets_update_own" on public.trading_assets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "trading_assets_delete_own" on public.trading_assets;
create policy "trading_assets_delete_own" on public.trading_assets
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.trading_assets from anon;
grant select, insert, update, delete on public.trading_assets to authenticated;

drop trigger if exists trading_assets_set_updated_at on public.trading_assets;
create trigger trading_assets_set_updated_at
  before update on public.trading_assets
  for each row execute function public.set_updated_at();

-- ── trading_setups ─────────────────────────────────────────────────────────
create table if not exists public.trading_setups (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  description      text,
  -- The three sessions the library filters by. Nullable: a setup is often
  -- captured before it is clear when it trades, and a forced answer would be
  -- a wrong one.
  session          text,
  asset_id         uuid,
  timeframe        text,
  creator          text,
  youtube_url      text,
  is_favorite      boolean not null default false,
  -- Path inside the `trading-screenshots` bucket, always `<user_id>/<file>`.
  -- Null for a setup without a screenshot.
  screenshot_path  text,
  -- The image's own size, so a card can reserve the right box before the
  -- image has loaded. Informational only; null when it could not be read.
  screenshot_width  integer,
  screenshot_height integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trading_setups_name_not_blank check (char_length(btrim(name)) > 0),
  constraint trading_setups_name_len check (char_length(name) <= 120),
  constraint trading_setups_description_len check (description is null or char_length(description) <= 4000),
  constraint trading_setups_session_known check (session is null or session in ('asia', 'london', 'new_york')),
  -- Constrained like the session, so the filter and the chips in the form can
  -- never disagree with what is stored. A new timeframe is a one-line change
  -- here and in src/lib/trading.js — a decision, not an accident.
  constraint trading_setups_timeframe_known check (
    timeframe is null or timeframe in ('1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D', '1W')
  ),
  constraint trading_setups_creator_len check (creator is null or char_length(creator) <= 80),
  constraint trading_setups_youtube_len check (youtube_url is null or char_length(youtube_url) <= 500),
  -- The screenshot of a user lives in that user's folder, and nowhere else.
  -- Together with the storage policies below this means a row can never point
  -- at somebody else's file.
  constraint trading_setups_screenshot_own_folder check (
    screenshot_path is null or split_part(screenshot_path, '/', 1) = user_id::text
  ),
  constraint trading_setups_screenshot_size_positive check (
    (screenshot_width is null or screenshot_width > 0) and
    (screenshot_height is null or screenshot_height > 0)
  ),
  -- Only one's own asset. `restrict`: there is no "delete asset" in the app,
  -- and a database that silently emptied the asset of twenty setups would be
  -- the wrong answer to a future one.
  constraint trading_setups_asset_fk foreign key (asset_id, user_id)
    references public.trading_assets (id, user_id) on delete restrict
);

create index if not exists trading_setups_user_id_idx on public.trading_setups (user_id);
-- The library reads one user's setups newest first — the only order it asks for.
create index if not exists trading_setups_user_created_idx
  on public.trading_setups (user_id, created_at desc);
create index if not exists trading_setups_asset_idx on public.trading_setups (asset_id);

alter table public.trading_setups enable row level security;

drop policy if exists "trading_setups_select_own" on public.trading_setups;
create policy "trading_setups_select_own" on public.trading_setups
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "trading_setups_insert_own" on public.trading_setups;
create policy "trading_setups_insert_own" on public.trading_setups
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "trading_setups_update_own" on public.trading_setups;
create policy "trading_setups_update_own" on public.trading_setups
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "trading_setups_delete_own" on public.trading_setups;
create policy "trading_setups_delete_own" on public.trading_setups
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.trading_setups from anon;
grant select, insert, update, delete on public.trading_setups to authenticated;

drop trigger if exists trading_setups_set_updated_at on public.trading_setups;
create trigger trading_setups_set_updated_at
  before update on public.trading_setups
  for each row execute function public.set_updated_at();

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Same second step 0004 documents: a table outside the publication produces no
-- change events at all. RLS is re-checked per subscriber.
do $$
declare
  t text;
begin
  foreach t in array array['trading_assets', 'trading_setups'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ── Storage: the private screenshot bucket ─────────────────────────────────
-- 10 MB and three formats, enforced by Storage itself — the client checks the
-- same numbers first (src/lib/trading.js) so the user gets a German sentence
-- instead of a 413, but this is the guarantee.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trading-screenshots',
  'trading-screenshots',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Every object lives under `<user_id>/…`, and each policy checks exactly that
-- first folder against the signed-in user. Four policies, one per operation,
-- the same shape as the tables above.
drop policy if exists "trading_screenshots_select_own" on storage.objects;
create policy "trading_screenshots_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trading-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "trading_screenshots_insert_own" on storage.objects;
create policy "trading_screenshots_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trading-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "trading_screenshots_update_own" on storage.objects;
create policy "trading_screenshots_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'trading-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'trading-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "trading_screenshots_delete_own" on storage.objects;
create policy "trading_screenshots_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trading-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
