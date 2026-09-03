-- Mind Whiteboard — der automatische Google-Kalender-Sync im 5-Minuten-Takt.
--
-- Zwei Dinge, mehr braucht es nicht:
--
--   1. ein Schloss, damit sich zwei Läufe nie überschneiden;
--   2. ein Zeitplan, der alle fünf Minuten dieselbe Edge Function aufruft,
--      die auch der Knopf in der App aufruft.
--
-- Es entsteht dabei keine zweite Sync-Logik. `google-api` bekommt nur eine
-- Aktion mehr (`sync-all`), und die läuft durch dasselbe `runSync` wie alles
-- andere.

-- ── 1. Das Schloss ──────────────────────────────────────────────────────────
-- Wer einen Lauf beginnt, trägt hier ein, bis wann er ihn beansprucht; wer
-- fertig ist, räumt es weg. Der Anspruch wird als bedingtes UPDATE gestellt
-- ("nur wenn frei"), und das ist atomar: von zwei gleichzeitigen Ansprüchen
-- trifft der zweite null Zeilen und weiß damit, dass er zu spät kam.
--
-- Der Wert ist ein *Ablauf*, kein Flag. Eine Function, die mitten im Lauf
-- abgeräumt wird, kann so die Synchronisierung nicht dauerhaft blockieren:
-- nach der eingetragenen Zeit ist das Schloss von selbst wieder offen.
alter table public.google_connections
  add column if not exists sync_lock_until timestamptz;

comment on column public.google_connections.sync_lock_until is
  'Läuft gerade ein Sync? Zeitpunkt, bis zu dem der laufende Lauf die Verbindung beansprucht; null = frei. Wird ausschließlich vom Sync-Dienst (service_role) geschrieben.';

-- Lesen darf der eigene Nutzer wie bei jeder anderen Spalte dieser Tabelle
-- (Policy aus 0005). Schreiben kann sie weiterhin nur der Dienst — die
-- Tabelle hat für `authenticated` kein einziges Schreibrecht.

-- ── 2. Der Zeitplan ─────────────────────────────────────────────────────────
-- pg_cron ruft alle fünf Minuten `public.google_auto_sync_tick()` auf, und die
-- schickt per pg_net einen HTTP-Aufruf an die Edge Function `google-api` mit
-- der Aktion `sync-all`.
--
-- Der Service-Role-Key steht dafür **nicht** in dieser Datei und nicht im
-- Repository, sondern im Supabase-Vault. Fehlt er, tut die Funktion nichts —
-- die Migration lässt sich also überall anwenden, und der Zeitplan wird
-- schlicht wirkungslos, statt zu scheitern.
--
-- Einmalig zu setzen (SQL-Editor, mit den echten Werten):
--
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'google_sync_service_key');
--   select vault.create_secret('https://<projekt>.supabase.co/functions/v1',
--                              'google_sync_functions_url');

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron nicht verfügbar — der Zeitplan wird übersprungen: %', sqlerrm;
end
$$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net nicht verfügbar — der Zeitplan wird übersprungen: %', sqlerrm;
end
$$;

create or replace function public.google_auto_sync_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  service_key text;
  functions_url text;
begin
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'google_sync_service_key';
  select decrypted_secret into functions_url
    from vault.decrypted_secrets where name = 'google_sync_functions_url';

  -- Ohne Geheimnisse kein Aufruf. Das ist der Normalzustand einer frisch
  -- angewendeten Migration und ausdrücklich kein Fehler.
  if service_key is null or functions_url is null then
    return;
  end if;

  perform net.http_post(
    url     := rtrim(functions_url, '/') || '/google-api',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || service_key),
    body    := jsonb_build_object('action', 'sync-all'),
    timeout_milliseconds := 60000
  );
end
$$;

-- Sie ruft mit Service-Rechten auf; aus dem Browser hat niemand hier etwas zu
-- suchen.
revoke all on function public.google_auto_sync_tick() from public;
revoke all on function public.google_auto_sync_tick() from anon;
revoke all on function public.google_auto_sync_tick() from authenticated;

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron fehlt — google-kalender-auto-sync wurde nicht eingeplant.';
    return;
  end if;
  -- Idempotent: eine erneute Anwendung der Migration ersetzt den Eintrag,
  -- statt einen zweiten anzulegen.
  perform cron.unschedule('google-kalender-auto-sync')
    from cron.job where jobname = 'google-kalender-auto-sync';
  perform cron.schedule(
    'google-kalender-auto-sync',
    '*/5 * * * *',
    'select public.google_auto_sync_tick();'
  );
end
$$;
