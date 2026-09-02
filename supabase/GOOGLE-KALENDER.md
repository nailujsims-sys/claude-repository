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
                                            ▼
                                   Supabase (Postgres)
                                            │
                                        Realtime
                                            ▼
                                   alle offenen Geräte
```

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
   - **Google Calendar API** (Kalender und Termine)
   - **People API** (nur für Geburtstage: Google verwaltet die im Kontakt,
     nicht im Kalender — ohne diese API bleiben Geburtstage lesbar, aber nicht
     änderbar)

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
     https://www.googleapis.com/auth/contacts
     ```
     Mehr wird nicht verlangt: Kalender *lesen* (Liste, Farben, Rechte),
     Termine *lesen und schreiben*, Kontakte für Geburtstage.

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

## 6. Regelmäßiger Sync (empfohlen, wenn kein Push)

Ein Zeitplan als Sicherheitsnetz. Im SQL-Editor, mit einem eigenen Wert für
`<SERVICE_ROLE_KEY>` — **nicht** ins Repository schreiben:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'google-kalender-sync', '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://itnhcnyawiktvajqciqw.supabase.co/functions/v1/google-api',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
    body    := jsonb_build_object('action', 'sync')
  );
  $$
);
```

> Achtung: `google-api` leitet den Nutzer aus dem JWT ab. Ein Service-Role-JWT
> hat keinen Nutzer, deshalb ist dieser Aufruf für ein Konto gedacht, bei dem
> das JWT eines Nutzers verwendet wird — für ein Ein-Personen-Setup ist der
> einfachere Weg, den Bereich gelegentlich zu öffnen oder Push einzurichten.

## 7. Verbinden

*Profil → Integrationen → Google Kalender → **Mit Google verbinden***.
Danach: Google-Konto wählen, Zugriff bestätigen, zurück in der App.

Der Hauptkalender ist sofort aktiv, alle weiteren stehen in der Liste zum
Einschalten. Der erste Import holt **zwei Jahre Vergangenheit** und die
gesamte verfügbare Zukunft.

## 8. Was in welchem Kalender geht

Entscheidend ist Googles `accessRole`, **nicht** der Name des Kalenders.

| Kalender | Lesen | Schreiben | Wie |
|---|---|---|---|
| Privat, Familie (`owner`/`writer`) | ja | ja | Calendar API |
| Geteilt, nur lesbar (`reader`) | ja | nein | — |
| Feiertage (`reader`) | ja | nein | Google lässt es nicht zu, die App bietet es nicht an |
| Geburtstage | ja | ja | **People API** — der Geburtstag steht im Kontakt, nicht im Kalender |

## 9. Trennen

*Verbindung trennen* beendet die Synchronisierung, löscht Zugangsdaten,
Kalenderliste und Push-Kanäle — **und behält jeden Termin**. Aus
synchronisierten Terminen werden reine App-Termine. Es wird nichts gelöscht,
weder hier noch in Google.

## 10. Fehlerbilder

| Anzeige | Bedeutung | Was hilft |
|---|---|---|
| „Google-Integration ist auf dem Server noch nicht konfiguriert" | Secrets aus Abschnitt 3 fehlen | Secrets setzen |
| „Verbindung abgelaufen" | Google hat den Zugriff widerrufen oder das Passwort wurde geändert | *Verbindung erneuern* |
| „Letzte Synchronisierung fehlerhaft" | ein Kalender oder ein Termin scheiterte, der Rest lief | Fehlertext am betroffenen Kalender lesen |
| „Dieser Kalender ist in Google schreibgeschützt" | Schreibversuch auf `reader` | anderen Kalender wählen |
| „Für Geburtstage fehlt die Kontakte-Berechtigung" | Verbindung ohne `contacts`-Scope | People API aktivieren, neu verbinden |
| „In Google nicht mehr vorhanden — nur noch in der App" | der Termin wurde in Google gelöscht, während er hier bearbeitet wurde | nichts; der Termin bleibt als App-Termin erhalten |
