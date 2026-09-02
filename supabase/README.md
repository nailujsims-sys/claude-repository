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

**Weg A — Dashboard (kein Werkzeug nötig).** SQL Editor öffnen, die drei
Dateien nacheinander einfügen und ausführen.

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

## 5. Eine neue persönliche Tabelle anlegen

`0001_foundation.sql` beschreibt das Muster im Kopfkommentar: `id`, `user_id`
mit Foreign Key auf `auth.users`, `created_at`/`updated_at`, Index auf
`user_id`, RLS an, vier Policies, `revoke ... from anon`, `updated_at`-Trigger.
Projekte, Gewohnheiten, Notizen und Finanzen folgen genau diesem Muster —
eine Tabelle ohne RLS und ohne `user_id` ist ein Datenleck.
