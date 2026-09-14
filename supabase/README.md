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
| `0006_lists.sql` | Listen: Tabellen `lists` und `list_items` (Vorlage, Icon, Pin, Archiv, Menge/Einheit/Betrag/Kategorie), Indizes, Constraints, RLS + Policies, Realtime |
| `0007_expenses.sql` | Ausgaben: Tabelle `expenses` (Titel, Originalbetrag, Eingabewährung AUD/EUR, Transaktionsdatum, verwendeter AUD/EUR-Kurs), Indizes, Constraints, RLS + Policies, Realtime |
| `0009_finance_import.sql` | Finanz-Import: `finance_transaction_observations` (append-only), `finance_transaction_relations` + `finance_transaction_relation_members` (Ablösung und Retouren-Vorschlag als Gruppe, 1↔1 bis n↔n), `finance_import_review_items`, die Sicht `finance_analytics_transactions`, die Spalte `finance_imports.apply_result`, die Funktion `finance_apply_reconciliation_plan`, Indizes, Constraints, RLS + Policies |
| `0008_finance.sql` | Finanzen: `finance_accounts`, `finance_categories` (die fünf MVP-Kategorien, per Trigger pro Konto angelegt), `finance_merchants`, `finance_merchant_patterns`, `finance_category_rules`, `finance_imports`, `finance_transactions`, `finance_transaction_overrides`, die Funktion `finance_learn_merchant_rule`, Indizes, Constraints, RLS + Policies |

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

`tests/finance_import.sql` beweist daneben, was keine Policy prüfen kann: dass
ein Import ganz oder gar nicht ankommt, dass derselbe Export zweimal angewendet
keine zweite Buchung erzeugt, und dass eine manuell entschiedene Buchung von
keinem Import stillschweigend deaktiviert wird. Auch dieses Skript endet mit
`ROLLBACK`.

* In Supabase: SQL Editor → Inhalt von `tests/rls.sql`, danach
  `tests/finance_import.sql` ausführen.
* Lokal gegen ein Wegwerf-Postgres: `npm run test:rls`
  (legt einen temporären Cluster an, spielt alle Migrationen zweimal ein, führt
  beide Skripte aus und danach fünf Gegenproben: ohne RLS auf je einer Tabelle
  und ohne den Append-only-Trigger muss dasselbe Skript fehlschlagen).

Nach jeder Migration ausführen.

## 5. Echtzeit-Synchronisation

Damit ein zweites geöffnetes Gerät eine Änderung mitbekommt, muss die Tabelle in
der Publikation `supabase_realtime` stehen — Tabelle anlegen und Realtime dafür
freischalten sind zwei getrennte Schritte. `0004_realtime.sql` erledigt das für
`tasks` und `events`, `0005_google_calendar.sql` zusätzlich für
`google_connections` und `google_calendars` — damit ein Sync, der auf dem Handy
fertig wird, auch auf dem Mac zu sehen ist. `0006_lists.sql` nimmt `lists` und
`list_items` auf, damit ein im Laden abgehakter Artikel sofort auf dem zweiten
Gerät verschwindet. `0007_expenses.sql` nimmt `expenses` auf, damit eine am
Automaten erfasste Ausgabe sofort in der Gesamtsumme auf dem anderen Gerät
steht. Die Zugangsdaten, die Push-Kanäle
und die Grabsteine werden bewusst **nicht** veröffentlicht. Die `finance_*`-Tabellen aus `0008` und `0009` ebenfalls noch nicht: es gibt bislang keinen
Screen, der sie abonniert, und eine Tabelle in die Publikation aufzunehmen ist
ein eigener Einzeiler — der gehört in die Migration, die das Modul sichtbar
macht. Prüfen:

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

## 7. Finanzen

`0008_finance.sql` folgt demselben Muster wie alles andere, mit drei Punkten,
die beim Lesen Zeit sparen:

* **Beträge sind `bigint` in Minor Units.** 24,83 € steht als `2483` in
  `finance_transactions.amount_minor`, daneben immer die Währung. Kein Float,
  nirgends — und EUR ist ein Wert, keine Annahme.
* **Rohdaten und Interpretation sind getrennt.** `raw_description`,
  `amount_minor`, `currency`, `booking_date` schreibt der Import einmal;
  `merchant_id`, `category_id`, `include_in_analytics` sind jederzeit neu
  berechenbar. Eine bewusste Entscheidung des Nutzers steht in
  `finance_transaction_overrides` und überlebt jede Neuberechnung.
* **Eine Funktion statt fünf Client-Writes.**
  `finance_learn_merchant_rule(...)` legt Händler, Muster, Regel und Zuordnung
  in *einer* Transaktion an. Sie läuft mit den Rechten des Aufrufers
  (`security invoker`, kein Service-Role-Schlüssel im Client) und rührt keine
  Buchung an, die `manual_lock` trägt, bereits zugeordnet ist oder einen
  Override hat.
* **Sie glaubt dem Client nicht.** Die mitgeschickten Buchungs-IDs werden einzeln
  gegen die gespeicherten Tokens der jeweiligen Buchung geprüft
  (`finance_pattern_matches` auf `finance_transactions.normalized_tokens`),
  bevor irgendetwas geschrieben wird. Das Tokenisieren selbst steht bewusst
  **nicht** in SQL — `upper('ß')` ist in Postgres `ß` und in JavaScript `SS`,
  und zwei fast gleiche Normalisierer sind schlimmer als einer. Tokenisiert wird
  genau einmal, in `src/lib/finance/normalize.js`, beim Anlegen der Buchung; die
  Tokens gehören danach zur eingefrorenen Rohhälfte.

Die fünf Kategorien (`lebensmittel`, `restaurant`, `klamotten`, `drogerie`,
`sonstige`) legt ein Trigger auf `auth.users` an, genau wie das Profil in
`0001`; bestehende Konten bekommen sie am Ende der Migration nachgetragen.
Eine Kategorie „Events" aus der alten Excel-Tabelle gibt es hier bewusst nicht.

### Ein Import wird angewendet

`0009_finance_import.sql` legt dazu, was ein zweiter Kontoauszug mit dem
anstellt, was schon da ist. Vier Regeln, die als Struktur dastehen und nicht als
Konvention:

* **Das Original wird nie überschrieben.** Ein späterer Export, der dieselbe
  Buchung besser beschreibt („REWE" wird zu „REWE.Mohamed.Boufo/Frankfurt"),
  landet als Zeile in `finance_transaction_observations` — append-only, per
  Trigger, nicht nur per Absprache. Der Einfrier-Trigger aus `0008` würde alles
  andere ohnehin ablehnen.
* **Eine Ablösung ist keine Spalte.** Zwei vorgemerkte −60,65-€-Buchungen und
  zwei abgerechnete, und in keinem der beiden Auszüge steht, welche welche
  ablöst. Eine Spalte `superseded_by_transaction_id` könnte darauf nur raten.
  Also: eine Relation mit Mitgliedern und Rollen (`predecessor`/`replacement`,
  für Retouren `purchase`/`refund`), in der 1↔1, 1↔n und n↔n gleich aussehen.
  Zwei Teil-Indizes — je einer pro Rolle — sorgen dafür, dass eine Buchung
  höchstens einmal abgelöst wird und höchstens einmal ablöst; die Kette
  A → B → C bleibt dabei erlaubt, weil B beides sein darf.
* **Ein Konflikt ist keine Logzeile.** Was der Abgleich nicht entscheiden
  konnte, steht mit der vollständigen eingehenden Buchung in
  `finance_import_review_items` — inklusive der Fälle, in denen eine manuelle
  Entscheidung im Weg stand.
* **Ein Import ist ein Akt.** `finance_apply_reconciliation_plan(...)` schreibt
  Buchungen, Beobachtungen, Relationen, Analytics-Flags und Review-Items in
  *einer* Transaktion. Sie sperrt die Import-Zeile, und ein bereits
  angewendeter Import liefert sein gespeichertes Ergebnis mit `replayed: true`
  zurück, statt ein zweites Mal zu schreiben. Auch sie läuft mit den Rechten
  des Aufrufers und glaubt dem Plan nichts, was zählt: ob eine Buchung manuell
  geschützt ist, liest sie selbst nach; ein Plan, der über eine Kontogrenze
  greift, wird abgelehnt statt stillschweigend gefiltert.

**Was nach einer bestätigten Ablösung in der Auswertung zählt**, steht einmal
da: die Sicht `finance_analytics_transactions` (`security_invoker`) zeigt jede
Buchung, die `include_in_analytics` trägt und nicht `predecessor` einer
bestätigten Ablösung ist. Die RPC setzt zusätzlich `include_in_analytics =
false` auf jeden Vorgänger — der schnelle Weg für einfache Abfragen. Beide
stimmen konstruktionsbedingt überein, und wo sie es je nicht täten, ist die
Sicht die strengere von beiden. Doppelt zählen ist der Fehler, den dieses Modul
verhindern soll.

`tests/finance_import.sql` beweist das gegen ein echtes Postgres: Atomarität,
Wiederholung desselben Exports, die Kette A → B → C, n↔n, `manual_lock`,
Override, Retouren-Vorschlag, Kontotrennung, Nutzerisolation und `anon`.

## 8. Eine neue persönliche Tabelle anlegen

`0001_foundation.sql` beschreibt das Muster im Kopfkommentar: `id`, `user_id`
mit Foreign Key auf `auth.users`, `created_at`/`updated_at`, Index auf
`user_id`, RLS an, vier Policies, `revoke ... from anon`, `updated_at`-Trigger.
Projekte, Gewohnheiten, Notizen und Finanzen folgen genau diesem Muster —
eine Tabelle ohne RLS und ohne `user_id` ist ein Datenleck.
