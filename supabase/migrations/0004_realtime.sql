-- Mind Whiteboard — cross-device sync: publish tasks and events to Realtime.
--
-- Realtime reads the WAL through one logical publication, `supabase_realtime`.
-- A table that is not in it produces no change events at all — creating the
-- table and letting Realtime see it are two separate steps, and this file is
-- the second one. Nothing about the tables themselves changes.
--
-- Security is unchanged and unweakened: Realtime re-checks every INSERT and
-- UPDATE against the same RLS policies a SELECT would go through, as the
-- subscribing user. A client that may not read a row never receives it.
--
-- DELETE is the documented exception — Postgres cannot prove after the fact
-- who was allowed to see a row that no longer exists, so delete events are
-- neither RLS-filtered nor filterable. They carry the primary key and nothing
-- else, and the client drops any id it does not already hold
-- (src/lib/realtimeSync.js). `replica identity` therefore stays at its default:
-- with RLS enabled the old record is limited to the primary key regardless, so
-- `full` would buy nothing and only widen every WAL record.
--
-- Idempotent, like every migration here: `alter publication ... add table`
-- errors if the table is already published, so each one is guarded.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end
$$;
