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
| `0013_finance_account_management.sql` | Kontoverwaltung: die additive Spalte `finance_accounts.archived_at` (`null` = aktiv, kein bestehendes Konto wird archiviert) plus Index `(user_id, archived_at)`, die Funktion `finance_account_dependency` (hängt Finanzhistorie an diesem Konto? — liest die Fremdschlüssel des Schemas aus `pg_constraint`, damit eine künftige Tabelle die Prüfung nicht stillschweigend aushebelt) und `finance_account_for_update` (Konto sperren + Eigentümer prüfen), die drei RPCs `finance_update_account` (Name/Anbieter jederzeit, Währung nur bei leerem Konto — sonst `FIN01`), `finance_set_account_archived` (archivieren/reaktivieren, ein bereits archiviertes Konto behält seinen Zeitstempel) und `finance_delete_empty_account` (löscht nur, wenn keine einzige Zeile per Fremdschlüssel zeigt — sonst `FIN02`; verlässt sich ausdrücklich **nicht** auf `on delete cascade`). Dieselben beiden Invarianten zusätzlich an der Tabelle, damit sie nicht am Aufrufweg hängen: Trigger `finance_accounts_guard_currency` (`before update of currency`, derselbe Satz und derselbe Code wie der RPC) und die Policy `finance_accounts_delete_own` aus 0008, verschärft um `finance_account_dependency(id) is null` — bewusst eine Policy und kein `before delete`-Trigger, damit der Cascade beim Löschen eines `auth.users`-Datensatzes unangetastet bleibt (E2E Fall P). Alle `security invoker`, `search_path = ''`, `execute` nur für `authenticated` |
| `0012_finance_ai_learning.sql` | Lernen aus Korrekturen: die Funktionen `finance_memory_key` (kanonische Vergleichsform eines Händlernamens, mit ausdrücklicher Kollation) und `finance_memory_example_key` (die Identität eines Beispiels), neue Tabelle `finance_ai_learning_memories` (drei Arten — `similar_example`, `merchant_rule`, `payment_provider` —, was das Modell vorschlug *und* was der Mensch daraus machte, `active` statt Löschen), ein eindeutiger Teilindex „höchstens eine aktive starke Regel je Händler" (über beide starken Arten hinweg) und einer gegen doppelte Beispiele, `finance_apply_ai_import` um das Merken erweitert (in derselben Transaktion, nur bei `human_review = 'corrected'` **und** einer fachlichen Abweichung vom Vorschlag — eine reine Notizänderung wird abgelehnt —, die gelernten Felder von der Datenbank bestimmt), Indizes, Constraints, RLS + Policies |
| `0011_finance_ai_import.sql` | Manuelle Buchung + KI-Import: `finance_imports.source_type` kennt zusätzlich `ai`, die additive Spalte `finance_transaction_overrides.merchant_name` (der von Hand benannte Händler als *Text*), neue Tabelle `finance_transaction_ai_suggestions` (was ein Sprachmodell zu einer Buchung vorgeschlagen hat — getrennt von Regel-Auflösung und Nutzerentscheidung, Händler ebenfalls als Text, damit weder Vorschlag noch Korrektur einen `finance_merchants`-Eintrag anlegt, mit `human_review` als `none`/`confirmed`/`corrected`), die Funktionen `finance_create_manual_transaction` (Buchung + Entscheidung in einer Transaktion, ohne Import-Zeile, und ohne Sperre, wenn der Mensch nichts eingeordnet hat) und `finance_apply_ai_import` (alles oder nichts, ein zweites Mal wirkungslos), Indizes, Constraints, RLS + Policies |
| `0010_finance_analytics_inclusion.sql` | Auswertungs-Zugehörigkeit: `finance_merchants.default_include_in_analytics`, die Funktionen `finance_unique_merchant` und `finance_effective_include_in_analytics`, die Sicht `finance_analytics_transactions` in ihrer vierstufigen Fassung |
| `0009_finance_import.sql` | Finanz-Import: `finance_transaction_observations` + `…_observation_sightings` (append-only, Evidenz einmal, Herkunft je Import), `finance_transaction_relations` + `…_relation_members` (Ablösung und Retouren-Vorschlag als Gruppe, 1↔1 bis n↔n, statusbewusst), `finance_import_review_items` + `…_review_item_transactions`, die Sicht `finance_analytics_transactions`, die Spalten `finance_imports.apply_result`/`period_start`/`period_end`, die Funktionen `finance_apply_reconciliation_plan`, `finance_resolve_relation` und `finance_resolve_review_item`, Indizes, Constraints, RLS + Policies |
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
keine zweite Buchung erzeugt, dass eine manuell entschiedene Buchung von keinem
Import stillschweigend deaktiviert wird — und dass ein Plan, der zwei beliebige
eigene Buchungen zur Ablösung erklärt, abgelehnt wird statt die Auswertung zu
verändern. Auch dieses Skript endet mit `ROLLBACK`.

`tests/finance_import_upgrade_seed.sql` und `…_verify.sql` stellen die Frage,
die Produktion stellt: die vorige Migration liegt seit Wochen drauf, es stehen
Daten darunter, jetzt kommt die neue. Der Runner baut dafür eine zweite
Datenbank, spielt `0001`–`0008` ein, legt die unangenehmen Zeilen an (gesperrte
Buchung, selbst ausgeschlossene Buchung, Override, bereits angewendeter Import),
spielt `0009` zweimal ein und prüft, dass nichts davon sich verändert hat — bis
hin zu „jede Tabelle aus 0008 hat danach immer noch genau ihre vier Policies".

* In Supabase: SQL Editor → Inhalt von `tests/rls.sql`, danach
  `tests/finance_import.sql` ausführen.
* Lokal gegen ein Wegwerf-Postgres: `npm run test:rls`
  (legt einen temporären Cluster an, spielt alle Migrationen zweimal ein, führt
  die Upgrade-Probe und beide Skripte aus und danach zehn Gegenproben: ohne RLS
  auf je einer von sechs Tabellen, ohne die beiden Append-only-Trigger, ohne die
  Kohärenzprüfung der Relationen und ohne den Vorgänger-Index muss dasselbe
  Skript fehlschlagen).

Nach jeder Migration ausführen.

### Diese Suite fasst die Produktionsdatenbank nicht an

Sie baut ihren eigenen Cluster in einem temporären Verzeichnis, spielt die
Migrationen dort ein und löscht ihn danach wieder — egal ob sie grün oder rot
war. Es gibt in diesen Dateien keine Verbindung zu einem Supabase-Projekt, keine
Anmeldedaten und keinen Schreibzugriff nach außen. Wer sie laufen lässt, riskiert
nichts.

### Im Deployment ist sie Pflicht

`tools/rlsTest.mjs` und die sechs E2E-Suites **überspringen sich mit Exit 0**,
wenn die Maschine kein PostgreSQL hat. Auf einem Entwicklungsrechner ist das
richtig — niemand soll eine Datenbank installieren müssen, um einen Tippfehler
zu korrigieren. In einem Deployment ist es genau die Art von Grün, die nichts
bedeutet.

Deshalb setzt `.github/workflows/deploy.yml` im Schritt **Database / RLS tests**
die Variable `RLS_TEST_REQUIRED=1`. Damit wird aus jedem Überspringen ein
Fehler:

| Fall | ohne `RLS_TEST_REQUIRED` | mit `RLS_TEST_REQUIRED=1` |
|---|---|---|
| kein unterstütztes PostgreSQL (16, 15, 14) | übersprungen, Exit 0 | **Exit 1** |
| läuft als `root` ohne unprivilegiertes Konto | übersprungen, Exit 0 | **Exit 1** |
| Cluster startet nicht, Migration, Replay, RLS-Assertion, Upgrade-Probe oder E2E-Suite scheitert | Exit 1 | Exit 1 |

Der Runner bringt PostgreSQL 16 mit (Server deaktiviert — die Suite braucht ihn
nicht, sie startet ihren eigenen). Der Workflow-Schritt gibt vorher
`initdb --version` und `psql --version` aus, damit jeder Lauf selbst
dokumentiert, gegen welche echte Datenbank er gelaufen ist.

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

### Eine Buchung von Hand, und ein Auszug ohne Bank

`0011_finance_ai_import.sql` bringt die beiden Wege, die v1.23 sichtbar macht.
Sie ist rein additiv: keine Spalte verschwindet, keine Policy wird
umgeschrieben, kein Constraint gelockert, keine Zeile migriert. Drei Punkte,
und nur die drei, waren mit dem bestehenden Schema nicht zu machen:

* **Die Herkunft `ai`.** `finance_imports_source_type_known` kannte `manual`,
  `pdf` und `csv`. Einen KI-Import als `csv` einzutragen wäre eine
  Herkunftsangabe, die nicht stimmt — und die Herkunft ist hier kein Etikett,
  sondern die Grundlage jeder späteren Frage „woher weiß die App das
  eigentlich". Der Check bekommt einen vierten, ehrlichen Wert; jede Zeile, die
  den alten erfüllte, erfüllt auch den neuen.
* **Ein korrigierter Händler ist ein Name, kein Eintrag.** Korrigiert ein Mensch
  im Preview den Händler, gehört das in `finance_transaction_overrides` — nur
  heißt die Spalte dort `merchant_id` und zeigt auf `finance_merchants`, also auf
  die Wurzel der Pattern- und Lern-Engine. Einen Eintrag dort anzulegen, weil
  jemand „REWE" getippt hat, hieße aus einer Korrektur an EINER Zeile eine Regel
  für alle künftigen zu machen. Also eine zweite, additive Spalte:
  `merchant_name`. Danach stehen die drei Ebenen nebeneinander —
  `…ai_suggestions.merchant_name` (was das Modell sagte),
  `…overrides.merchant_name`/`_id` (was der Mensch sagte) und
  `finance_merchants` + `…patterns` (die globale Regel) — und bleiben einzeln
  lesbar.
* **Bestätigen ist nicht korrigieren.** `…ai_suggestions.human_review` hat drei
  Werte — `none`, `confirmed`, `corrected` — und keinen davon kann ein Boolean
  ausdrücken. Eine Zeile kann unsicher gemeldet und trotzdem richtig sein; sagt
  der Mensch „Passt so", ist das das wertvollste Signal, das v1.24 bekommen
  kann. Ein `user_edited`-Boolean hätte die Wahl gelassen, diese Bestätigung als
  „nie angefasst" zu verlieren oder sie als Korrektur zu buchen — und das zweite
  hieße, v1.24 beizubringen, ein richtiger Vorschlag sei falsch gewesen. Drei
  Werte in einer Spalte mit Check, weil zwei Booleans vier Zustände hätten und
  einer davon (geändert, aber nicht angesehen) keinen Sinn ergibt.
* **Ein Vorschlag ist weder Auflösung noch Entscheidung.**
  `finance_transactions` trägt, was die Regel-Engine gerade sagt;
  `finance_transaction_overrides` trägt, was ein Mensch festgelegt hat. Was ein
  Sprachmodell vorschlägt, ist eine dritte Meinung: sie darf keine
  Nutzerentscheidung überschreiben, und man muss sie später mit der
  tatsächlichen Entscheidung vergleichen können — daraus lernt v1.24. In eine
  der beiden bestehenden Tabellen geschrieben wäre sie hinterher nicht mehr von
  ihnen zu unterscheiden. Also `finance_transaction_ai_suggestions`, eine Zeile
  je (Buchung, Import), ohne Update-Recht. Der vorgeschlagene Händler ist
  **Text** und kein `merchant_id`: ein `finance_merchants`-Eintrag ist die
  Wurzel der Pattern- und Lern-Engine, und ihn aus einem Modellvorschlag heraus
  anzulegen wäre genau die automatische globale Lernregel, die v1.23 noch nicht
  erzeugen soll.
* **Ein Akt bleibt ein Akt.** Eine manuelle Buchung sind zwei Schreibvorgänge
  (Buchung + Entscheidung), ein KI-Import drei je Zeile. Als Einzelaufrufe aus
  dem Browser hinterlässt jeder Abbruch in der Mitte eine Buchung ohne ihre
  Notiz oder einen halben Auszug. Also zwei Funktionen mit Invoker-Rechten, wie
  `finance_learn_merchant_rule` und `finance_apply_reconciliation_plan`:
  `finance_create_manual_transaction` (die Buchung bekommt **keine**
  `import_id` — sie stammt aus keiner Datei — und `manual_lock` nur dann, wenn
  der Mensch Händler oder Kategorie gesetzt hat; hat er beides offen gelassen,
  entsteht auch kein leerer Override, und die Buchung darf ganz normal in der
  Zuordnung auftauchen — dieselbe Frage stellt auch der KI-Import, bevor er eine
  Bestätigung aus dem Preview speichert) und
  `finance_apply_ai_import` (sperrt die Import-Zeile; ein bereits angewendeter
  Import liefert sein gespeichertes Ergebnis mit `replayed: true` zurück und
  schreibt nichts). Beide prüfen das Konto selbst und glauben dem Aufrufer
  nichts, was zählt.

`tools/financeAiE2E.mjs` führt beide gegen ein Wegwerf-Postgres mit den echten
Migrationen aus — inklusive „dieselbe Buchung auf einem anderen Konto ist neu",
„derselbe Block zweimal erzeugt keine Zeile mehr", „die Notiz des Menschen
bleibt unverändert" und „ein anderer Benutzer sieht keinen einzigen Vorschlag".

Dazu kommt die Frage, die das Schema nicht beantwortet, aber ermöglicht: nach
einem Import werden Buchungen, Vorschläge, Overrides, Muster und Regeln
zurückgelesen und durch dieselbe Einordnungsregel geschickt, die die App
benutzt (`src/lib/finance/effectiveClassification.js`). Ein vollständiger,
unmarkierter Vorschlag lässt den Umsatz aus der Zuordnung verschwinden, ein
markierter nicht — und in keinem der beiden Fälle entsteht eine Zeile in
`finance_merchants` oder `finance_merchant_patterns`.

### Ein Import wird angewendet

`0009_finance_import.sql` legt dazu, was ein zweiter Kontoauszug mit dem
anstellt, was schon da ist. Vier Regeln, die als Struktur dastehen und nicht als
Konvention:

* **Das Original wird nie überschrieben.** Ein späterer Export, der dieselbe
  Buchung besser beschreibt („REWE" wird zu „REWE.Mohamed.Boufo/Frankfurt"),
  landet als Zeile in `finance_transaction_observations` — append-only, per
  Trigger, nicht nur per Absprache. Der Einfrier-Trigger aus `0008` würde alles
  andere ohnehin ablehnen. Die Identität einer Beobachtung ist ihr *Inhalt*,
  damit ein erneut eingelesener Export keine Kopien erzeugt; **wer** sie gesehen
  hat, steht in `finance_transaction_observation_sightings`, eine Zeile je
  Import. Ohne die wäre nur der erste Import je wieder auffindbar.
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
  Entscheidung im Weg stand. Die betroffenen Buchungen hängen über
  `finance_import_review_item_transactions` mit echten Fremdschlüsseln daran;
  der `payload` hält daneben den eingefrorenen Stand, sodass eine später
  gelöschte Buchung die Verknüpfung verliert, aber nicht die Geschichte.
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

**Was die Datenbank selbst nachprüft.** Der Plan wird im Browser berechnet, also
ist die spannende Frage nicht, was er behauptet, sondern was ihm geglaubt wird.
Geprüft wird serverseitig: dass jede genannte Buchung dem Nutzer *und* dem
Konto des Imports gehört; dass jede gespeicherte Buchung innerhalb des
Zeitraums liegt, den der Auszug selbst angibt; dass eine Ablösung dieselbe
Zahlung meint — **gleicher Betrag, gleiche Währung auf beiden Seiten**, denn
alles andere ist keine Ablösung; dass Kauf und Retoure sich rechnerisch
ausgleichen; dass keine Buchung auf beiden Seiten derselben Relation steht; und
dass eine bereits abgelöste Buchung nicht ein zweites Mal abgelöst wird.

Diese Regeln stehen absichtlich **nicht** nur in der RPC. `authenticated` hält
INSERT auf diesen Tabellen und muss es halten, weil die Funktion mit
Aufruferrechten läuft — eine Invariante nur in der Funktion wäre eine, um die
ein fehlerhafter Client herumläuft. Sie hängen deshalb als aufgeschobener
Constraint-Trigger an den Mitgliedern und gelten für jeden Schreibweg. Die RPC
löst sie am Ende ausdrücklich aus, damit ein Fehler dort auftaucht, wo er
entstanden ist, und der Import nicht erst beim Commit scheitert.

**Der Rückweg.** `finance_resolve_relation(relation_id, status, note)` steht
neben dem Anwenden: `rejected` heißt „doch nicht dieselbe Zahlung", schaltet
genau die Buchungen wieder ein, die *diese* Relation ausgeschaltet hatte
(`evidence.analytics_deactivated`), und lässt alles andere in Ruhe — eine vom
Nutzer selbst ausgeschlossene Buchung kommt dadurch nie zurück. `confirmed`
über eine gesperrte Buchung wird **abgelehnt**, mit dem Hinweis, erst die
Sperre oder den Override aufzuheben: „manuell schlägt automatisch" gilt auch
innerhalb dieser Funktion. Abgelehnte Relationen bleiben als Historie stehen
und blockieren über `relation_status` keine spätere, richtige Ablösung mehr.
`finance_resolve_review_item(...)` schließt, verwirft oder öffnet einen
Review-Eintrag wieder; sie ändert bewusst keine Buchung.

`tests/finance_import.sql` beweist das gegen ein echtes Postgres: Atomarität,
Wiederholung desselben Exports, die Kette A → B → C, n↔n, `manual_lock`,
Override, Retouren-Vorschlag, Kontotrennung, Zeitraum, Betrags- und
Währungsgleichheit, direkte Schreibwege an der RPC vorbei, Zurücknehmen und
erneutes Ablösen, Provenienz der Beobachtungen, Nutzerisolation und `anon`.

## 8. Eine neue persönliche Tabelle anlegen

`0001_foundation.sql` beschreibt das Muster im Kopfkommentar: `id`, `user_id`
mit Foreign Key auf `auth.users`, `created_at`/`updated_at`, Index auf
`user_id`, RLS an, vier Policies, `revoke ... from anon`, `updated_at`-Trigger.
Projekte, Gewohnheiten, Notizen und Finanzen folgen genau diesem Muster —
eine Tabelle ohne RLS und ohne `user_id` ist ein Datenleck.
