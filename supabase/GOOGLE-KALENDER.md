# Google Kalender — Einrichtung

Die Integration ist im Repository vollständig. Was hier steht, sind die
Schritte, die **außerhalb** des Repositorys einmalig gemacht werden müssen:
ein Google-Cloud-Projekt, ein OAuth-Client und drei Secrets in Supabase.
Solange sie fehlen, läuft die App normal weiter — der Bereich
*Profil → Integrationen → Google Kalender* meldet dann, dass der Server noch
nicht konfiguriert ist.

> **Keine Secrets ins Repository.** Client-Secret, Refresh-Token und der
> Service-Role-Key gehören ausschließlich in die Function-Secrets von Supabase.
> Nichts davon erreicht jemals den Browser.

---

## 1. Wie es aufgebaut ist

```
Google  ──(Push-Benachrichtigung)──►  Edge Function google-hooks
                                            │
Client ──(JWT)──► Edge Function google-api ─┤
                                            │
pg_cron (alle 5 Min) ──(pg_net)────────────►┤
                                            ▼
                                   Supabase (Postgres)
                                            │
                                        Realtime
                                            ▼
                                   alle offenen Geräte
```

Alle drei Pfeile münden in denselben Lauf (`_shared/sync.js`). Es gibt genau
eine Sync-Implementierung; der Zeitplan aus Abschnitt 6 ist nur ein weiterer
Auslöser dafür.

Der Browser spricht **nie** mit Google. Er liest zwei Tabellen
(`google_connections`, `google_calendars` — beide ohne Zugangsdaten) und ruft
für jede Änderung eine Edge Function auf. Die Tokens liegen in
`google_credentials`, worauf die Client-Rollen *kein einziges Recht* haben
(siehe `migrations/0005_google_calendar.sql` und `tests/rls.sql`).

| Function | `verify_jwt` | Wofür |
|---|---|---|
| `google-api` | **an** | Alles, was der angemeldete Nutzer auslöst: verbinden, synchronisieren, Kalender aktivieren, Standardkalender, trennen |
| `google-hooks` | aus | `…/callback` (OAuth-Rücksprung) und `…/push` (Googles Benachrichtigung). Beide prüfen sich selbst: signierter `state` bzw. Kanal-Token |

## 2. Google Cloud Console — einmalig

1. **Projekt anlegen** (oder ein vorhandenes wählen):
   <https://console.cloud.google.com/projectcreate>

2. **APIs aktivieren** — *APIs & Services → Library*:
   - **Google Calendar API** (Kalender und Termine) — das ist alles, was die
     Verbindung braucht.
   - **People API** — vorerst *nicht* nötig. Sie gehört zum Bearbeiten von
     Geburtstagen, und das bekommt einen eigenen Schalter; siehe
     „Geburtstage" unten.

3. **OAuth Consent Screen** — *APIs & Services → OAuth consent screen*:
   - User Type: **External**, Publishing status **Testing** genügt für ein
     privates Konto
   - Unter *Test users* die eigene Google-Adresse eintragen
   - Scopes eintragen (dieselben, die `_shared/google.js` anfordert):
     ```
     openid
     email
     https://www.googleapis.com/auth/calendar.calendarlist.readonly
     https://www.googleapis.com/auth/calendar.events
     ```
     Mehr wird nicht verlangt: Kalender *lesen* (Liste, Farben, Rechte) und
     Termine *lesen und schreiben*. **Kein Kontakte-Zugriff** — siehe unten.

4. **OAuth-Client anlegen** — *Credentials → Create credentials → OAuth client
   ID → Web application*:
   - **Authorized redirect URI** (exakt, ohne Schrägstrich am Ende):
     ```
     https://itnhcnyawiktvajqciqw.supabase.co/functions/v1/google-hooks/callback
     ```
   - Client-ID und Client-Secret notieren — beides kommt in Schritt 3.

## 3. Supabase — Secrets setzen

Dashboard → **Edge Functions → Secrets** (oder
`supabase secrets set NAME=wert`):

| Secret | Wert | Zweck |
|---|---|---|
| `GOOGLE_CLIENT_ID` | aus Schritt 2.4 | identifiziert die App bei Google |
| `GOOGLE_CLIENT_SECRET` | aus Schritt 2.4 | **geheim**, verlässt den Server nie |
| `GOOGLE_STATE_SECRET` | selbst erzeugte Zufallszeichenkette, z. B. `openssl rand -hex 32` | signiert den OAuth-`state`. Ohne ihn könnte jemand ein fremdes Google-Konto an dieses App-Konto hängen |
| `GOOGLE_APP_REDIRECTS` | `https://nailujsims-sys.github.io/claude-repository/,http://localhost:5173/` | Positivliste der Rücksprungadressen. Alles andere lehnt der Callback ab (Open-Redirect-Schutz) |
| `GOOGLE_PUSH_ENDPOINT` | *optional*, siehe Abschnitt 5 | Adresse für Googles Push-Benachrichtigungen |

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` setzt Supabase selbst — die
müssen und dürfen nicht eingetragen werden.

## 4. Functions ausrollen

Sind bereits ausgerollt. Nach einer Änderung an `supabase/functions/`:

```bash
supabase functions deploy google-api                     # verify_jwt an (Standard)
supabase functions deploy google-hooks --no-verify-jwt   # muss ohne JWT erreichbar sein
```

Das `--no-verify-jwt` bei `google-hooks` ist kein Versehen: Google schickt
weder eine Supabase-Sitzung noch kann es eine haben. Die Prüfung passiert im
Code — signierter `state` beim Callback, Kanal-Token beim Push.

## 5. Push-Benachrichtigungen (optional)

Ohne Push funktioniert alles; Änderungen aus Google kommen dann beim nächsten
Sync-Lauf an (beim Öffnen des Bereichs, beim Verbinden, beim Aktivieren eines
Kalenders, per *Jetzt synchronisieren* oder per Cron aus Abschnitt 6). Mit Push
meldet Google die Änderung sofort, die Function schreibt sie nach Supabase, und
die bestehende Realtime-Verbindung bringt sie auf alle offenen Geräte.

**Die Einschränkung, weswegen es optional ist:** Google verlangt für
Push-Empfänger eine *domain-verifizierte* HTTPS-Adresse (Search Console →
Domain-Inhaberschaft, dann Cloud Console → *Domain verification*).
`*.supabase.co` gehört uns nicht und lässt sich nicht verifizieren. Wer Push
will, braucht also eine eigene Domain, die auf
`…/functions/v1/google-hooks/push` weiterleitet, und trägt sie als
`GOOGLE_PUSH_ENDPOINT` ein. Ist das Secret leer, werden schlicht keine Kanäle
geöffnet.

## 6. Automatischer Sync alle 5 Minuten

Der Sync läuft von selbst, ungefähr alle fünf Minuten. Es ist derselbe Lauf,
den auch *Jetzt synchronisieren* auslöst — dieselbe Edge Function, dieselbe
Sync-Logik, dieselben Konfliktregeln. Automatisiert ist nur der Auslöser.

### Wie es zusammenhängt

```
pg_cron (*/5 * * * *)
   └─► public.google_auto_sync_tick()      (Migration 0007)
          └─► pg_net → google-api  { "action": "sync-all" }
                 └─► für jede Verbindung: runSync()   ← derselbe Lauf wie der Knopf
```

Der Zeitplan ist **serverseitig**: er braucht kein offenes Fenster, kein
angemeldetes Gerät und keinen Browser. Zusätzlich stößt eine geöffnete App
denselben Lauf im selben Takt an (Aktion `auto-sync`) — als Netz für den Fall,
dass der Zeitplan unten noch nicht eingerichtet ist.

Damit sich daraus keine doppelten Läufe ergeben, prüft der Server jeden
*automatischen* Auslöser gegen zwei Bedingungen (`_shared/autoSyncPolicy.js`):

* **Es läuft schon einer?** `google_connections.sync_lock_until` wird per
  bedingtem UPDATE beansprucht — atomar, also gewinnt immer genau einer. Der
  Anspruch verfällt nach zehn Minuten von selbst, damit ein abgebrochener Lauf
  nichts dauerhaft blockiert.
* **Lief gerade erst einer?** Weniger als vier Minuten seit `last_sync_at`
  heißt: nicht noch einmal. Zehn offene Tabs lösen deshalb genauso viele Läufe
  aus wie einer.

Der **manuelle** Sync kennt keinen Mindestabstand und keine dieser Pausen. Er
wartet nur, solange tatsächlich ein Lauf unterwegs ist — und der schreibt
ohnehin gerade das, was der Knopf holen würde.

Eine **abgelaufene Verbindung** (`needs_reauth`) wird nicht automatisch
nachgefasst: das würde Google alle fünf Minuten mit einem toten Token
behelligen. Der Bereich zeigt „Verbindung abgelaufen", *Verbindung erneuern*
und *Jetzt synchronisieren* funktionieren weiter.

### Einrichten (einmalig)

Die Migration `0007_google_auto_sync.sql` legt Spalte, Funktion und Zeitplan
an. Der Zeitplan tut allerdings **nichts**, solange die beiden Werte fehlen,
die er dafür braucht — und die gehören nicht ins Repository, sondern in den
Supabase-Vault. Einmal im SQL-Editor:

```sql
select vault.create_secret('<SERVICE_ROLE_KEY>', 'google_sync_service_key');
select vault.create_secret(
  'https://itnhcnyawiktvajqciqw.supabase.co/functions/v1',
  'google_sync_functions_url');
```

Danach läuft der Zeitplan. Prüfen:

```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time
  from cron.job_run_details
  where jobname = 'google-kalender-auto-sync'
  order by start_time desc limit 5;

select user_id, last_sync_at, last_sync_status, sync_lock_until
  from public.google_connections;
```

`last_sync_at` sollte danach nie älter als ein paar Minuten sein.

Anhalten oder wieder starten, ohne etwas zu löschen:

```sql
update cron.job set active = false where jobname = 'google-kalender-auto-sync';
```

> Warum der Service-Role-Key: der Zeitplan ist kein Nutzer. `google-api` leitet
> den Nutzer sonst aus dem JWT ab; für `sync-all` erkennt die Function den
> Service-Role-Key und arbeitet dann alle Verbindungen der Reihe nach ab. Der
> Key verlässt dabei die Datenbank nur in Richtung der eigenen Function.

## 7. Verbinden

*Profil → Integrationen → Google Kalender → **Mit Google verbinden***.
Danach: Google-Konto wählen, Zugriff bestätigen, zurück in der App.

Der Hauptkalender ist sofort aktiv, alle weiteren stehen in der Liste zum
Einschalten. Der erste Import holt **zwei Jahre Vergangenheit** und die
gesamte verfügbare Zukunft.

## 8. Geburtstage und der Kontakte-Zugriff

Die Verbindung fragt **keinen Zugriff auf die Google-Kontakte** an. Das war
einmal anders, und es war ein Fehler: Google verwaltet einen Geburtstag im
Kontakt, nicht im Kalender, also brauchte das *Bearbeiten* eines Geburtstags
den Scope `contacts` — und weil er Teil der normalen Verbindung war, wurde der
Zugriff auf das gesamte Adressbuch zur Bedingung dafür, den Kalender überhaupt
zu benutzen. Wer ihn auf dem Zustimmungsbildschirm abwählte, bekam ein Token
ohne die nötigen Rechte und danach „Request had insufficient authentication
scopes".

Was heute gilt:

* **Geburtstage lesen: ja.** Der Geburtstagskalender kommt wie jeder andere
  über `calendar.events` und erscheint ganz normal in der App.
* **Geburtstage in Google ändern: noch nicht.** Der Versuch meldet
  „Geburtstage in Google ändern ist noch nicht freigegeben"; der Termin bleibt
  in der App erhalten und unverändert in Google.

Der Weg dorthin steht schon im Code: `BIRTHDAY_SCOPES` in
`_shared/google.js` ist der Satz, den ein späterer, ausdrücklich aktivierter
Zustimmungsbildschirm anfordern wird — die Kalenderrechte plus `contacts`.
Erst dann werden auch die People API und der zusätzliche Scope im Consent
Screen gebraucht.

## 9. Was in welchem Kalender geht

Entscheidend ist Googles `accessRole`, **nicht** der Name des Kalenders.

| Kalender | Lesen | Schreiben | Wie |
|---|---|---|---|
| Privat, Familie (`owner`/`writer`) | ja | ja | Calendar API |
| Geteilt, nur lesbar (`reader`) | ja | nein | — |
| Feiertage (`reader`) | ja | nein | Google lässt es nicht zu, die App bietet es nicht an |
| Geburtstage | ja | noch nicht | Bearbeiten braucht die People API und einen eigenen Zustimmungsbildschirm (Abschnitt 8) |

## 10. Trennen

*Verbindung trennen* beendet die Synchronisierung, löscht Zugangsdaten,
Kalenderliste und Push-Kanäle — **und behält jeden Termin**. Aus
synchronisierten Terminen werden reine App-Termine. Es wird nichts gelöscht,
weder hier noch in Google.

## 11. Fehlerbilder

| Anzeige | Bedeutung | Was hilft |
|---|---|---|
| „Google-Integration ist auf dem Server noch nicht konfiguriert" | Secrets aus Abschnitt 3 fehlen | Secrets setzen |
| „Verbindung abgelaufen" | Google hat den Zugriff widerrufen oder das Passwort wurde geändert | *Verbindung erneuern* |
| „Letzte Synchronisierung fehlerhaft" | ein Kalender oder ein Termin scheiterte, der Rest lief | Fehlertext am betroffenen Kalender lesen |
| „Dieser Kalender ist in Google schreibgeschützt" | Schreibversuch auf `reader` | anderen Kalender wählen |
| „Geburtstage in Google ändern ist noch nicht freigegeben" | erwartet — die Verbindung fragt keine Kontakte an (Abschnitt 8) | nichts; Lesen funktioniert weiter |
| „Es fehlen Berechtigungen" beim Verbinden | auf dem Zustimmungsbildschirm wurde ein Kalender-Häkchen entfernt | erneut verbinden und alle Häkchen gesetzt lassen |
| „Die Kalender konnten nicht geladen werden" | Google hat zugestimmt, aber die Kalenderliste nicht geliefert | der unvollständige Zugang wurde automatisch entfernt; in einem Moment erneut versuchen |
| „In Google nicht mehr vorhanden — nur noch in der App" | der Termin wurde in Google gelöscht, während er hier bearbeitet wurde | nichts; der Termin bleibt als App-Termin erhalten |
