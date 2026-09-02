# Supabase — Einrichtung und Betrieb

Die App hat genau eine Datenquelle: dieses Supabase-Projekt. Es gibt keinen
lokalen Ersatzspeicher. Ohne Konfiguration startet die App in den Zustand
„Keine Datenbank verbunden" und speichert nichts.

Produktivprojekt: **Leben App** (Region West EU, Ireland).

---

## 1. Schema anlegen

Die Migrationen in `migrations/` sind die einzige Quelle der Wahrheit für das
Schema. Sie laufen in dieser Reihenfolge und sind idempotent — ein zweiter
Durchlauf ändert nichts und zerstört nichts.

| Datei | Inhalt |
|---|---|
| `0001_foundation.sql` | `set_updated_at()`, Tabelle `profiles`, Trigger `handle_new_user`, RLS + Policies |
| `0002_tasks.sql` | Tabelle `tasks`, Indizes, Constraints, RLS + Policies |
| `0003_events.sql` | Tabelle `events`, Indizes, Constraints, RLS + Policies |
| `0004_realtime.sql` | `tasks` und `events` in die Publikation `supabase_realtime` aufnehmen |
| `0005_google_calendar.sql` | Google-Kalender: `google_connections`, `google_credentials` (für Clients gesperrt), `google_calendars`, `google_channels`, `google_event_tombstones`, die Google-Spalten an `events`, die Sync-Trigger, RLS + Grants |

**Weg A — Dashboard (kein Werkzeug nötig).** SQL Editor öffnen, die Dateien
nacheinander einfügen und ausführen.

**Weg B — Supabase CLI (bevorzugt, sobald verfügbar).**

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Beides führt exakt dieselben Dateien aus. Schema-Änderungen entstehen ab jetzt
immer als neue Migrationsdatei im Repository — nie direkt im Dashboard, sonst
weiß niemand mehr, was in Production steht.

## 2. Benutzer anlegen

Dashboard → Authentication → Users → **Add user**: E-Mail und Passwort setzen,
Haken bei „Auto Confirm User". Der Trigger `handle_new_user` legt die zugehörige
Zeile in `profiles` automatisch an.

Es gibt bewusst keine Registrierung in der App. Wer ein Konto braucht, bekommt
es hier.

Für die Passwort-zurücksetzen-Mail muss die Rücksprung-Adresse erlaubt sein:
Authentication → URL Configuration → **Redirect URLs**:

```
https://nailujsims-sys.github.io/claude-repository/*
http://localhost:5173/*
```

## 3. App verbinden

Zwei öffentliche Werte, zu finden unter Project Settings → API:

| Variable | Wert | Wo eintragen |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`) | GitHub-Repository-Variable **und** lokale `.env` |
| `VITE_SUPABASE_ANON_KEY` | anon / public key | GitHub-Repository-Variable **und** lokale `.env` |

**Production:** Repository → Settings → Secrets and variables → Actions →
Variables → *New repository variable*. Der Deploy-Workflow bricht ab, wenn einer
der beiden Werte fehlt — lieber ein roter Build als eine App ohne Datenbank.
(Wer sie lieber als *Secret* hinterlegt: der Workflow akzeptiert beides.)

**Lokal:** `cp .env.example .env`, beide Werte eintragen, `npm run dev`.

> Der anon key gehört in den Client — er ist die Identität des Browsers vor dem
> Login und wird von RLS begrenzt. Der **service-role key** und das
> **Datenbank-Passwort** dürfen niemals in den Client, ins Repository oder in
> eine GitHub-Variable.

## 4. Sicherheit prüfen

`tests/rls.sql` beweist gegen das echte Schema, dass ein angemeldeter Benutzer
genau seine eigenen Zeilen erreicht und sonst nichts. Das Skript legt zwei
Testkonten an, prüft SELECT/INSERT/UPDATE/DELETE für eigene und fremde Daten
sowie den unauthentifizierten Zugriff — und endet mit `ROLLBACK`, hinterlässt
also nichts.

* In Supabase: SQL Editor → Inhalt von `tests/rls.sql` ausführen.
* Lokal gegen ein Wegwerf-Postgres: `npm run test:rls`
  (legt einen temporären Cluster an, spielt alle Migrationen zweimal ein und
  führt danach eine Gegenprobe: ohne RLS muss dasselbe Skript fehlschlagen).

Nach jeder Migration ausführen.

## 5. Echtzeit-Synchronisation

Damit ein zweites geöffnetes Gerät eine Änderung mitbekommt, muss die Tabelle in
der Publikation `supabase_realtime` stehen — Tabelle anlegen und Realtime dafür
freischalten sind zwei getrennte Schritte. `0004_realtime.sql` erledigt das für
`tasks` und `events`, `0005_google_calendar.sql` zusätzlich für
`google_connections` und `google_calendars` — damit ein Sync, der auf dem Handy
fertig wird, auch auf dem Mac zu sehen ist. Die Zugangsdaten, die Push-Kanäle
und die Grabsteine werden bewusst **nicht** veröffentlicht. Prüfen:

```sql
select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime';
```

Am Datenmodell ändert sich dadurch nichts, und RLS bleibt in voller Stärke:
Realtime prüft jedes INSERT und UPDATE noch einmal gegen dieselben Policies, als
Rolle des abonnierenden Clients — wer eine Zeile nicht lesen darf, bekommt sie
auch hier nicht.

Eine dokumentierte Ausnahme gibt es: **DELETE-Events werden von Supabase weder
per RLS noch per Filter eingeschränkt.** Postgres kann nachträglich nicht mehr
belegen, wer eine gelöschte Zeile sehen durfte, deshalb geht an alle Abonnenten
der Tabelle der Primärschlüssel — und sonst nichts. Der Client verwirft jede ID,
die er nicht ohnehin schon hält (`src/lib/realtimeSync.js`); fremde Daten können
darüber also nicht sichtbar werden. Aus demselben Grund bleibt `replica
identity` auf `default`: bei aktivem RLS enthält der alte Datensatz ohnehin nur
den Primärschlüssel, `full` würde nichts hinzufügen und nur jeden WAL-Eintrag
verbreitern.

Eine neue persönliche Tabelle, die geräteübergreifend live sein soll, gehört in
eine eigene Migration mit demselben Muster:

```sql
alter publication supabase_realtime add table public.<tabelle>;
```

## 6. Google Kalender

Die Verbindung zu Google braucht außerhalb dieses Repositorys ein
Google-Cloud-Projekt und drei Secrets. Alles dazu — Scopes, Redirect-URI,
Secrets, Ausrollen der Edge Functions, Push-Benachrichtigungen — steht in
[`GOOGLE-KALENDER.md`](GOOGLE-KALENDER.md).

Die eine Regel, die hier wiederholt gehört: die Google-Tokens liegen in
`google_credentials`, und `anon` wie `authenticated` haben auf diese Tabelle
**kein Recht** — kein SELECT, keine Policy, nichts. Nur die Edge Functions
(`service_role`) kommen daran. `tests/rls.sql` beweist genau das, zusammen mit
der Nutzerisolation der übrigen Google-Tabellen.

## 7. Eine neue persönliche Tabelle anlegen

`0001_foundation.sql` beschreibt das Muster im Kopfkommentar: `id`, `user_id`
mit Foreign Key auf `auth.users`, `created_at`/`updated_at`, Index auf
`user_id`, RLS an, vier Policies, `revoke ... from anon`, `updated_at`-Trigger.
Projekte, Gewohnheiten, Notizen und Finanzen folgen genau diesem Muster —
eine Tabelle ohne RLS und ohne `user_id` ist ein Datenleck.
