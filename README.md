# 🧠 Mind Whiteboard

A premium, dark, mobile-first personal productivity app for **Julian**. Version 1
ships five fully functional modules — the **Startseite** (home dashboard), the
**Aufgaben** task manager, the **Kalender**, **Listen** and **Ausgaben** — on top
of a navigation architecture (bottom bar, sidebar, action sheet) built to be
extended module by module.

Built with **React + Vite + Tailwind CSS** on a single central data source:
**Supabase**, with email/password login and Row Level Security. Tasks and events
belong to an account, not to a browser — the same data on every device. There is
no local fallback store: without a configured backend the app says so and holds
nothing (see *Supabase* below).

---

## ✨ What's in V1

- **Startseite** — a calm overview of the day: a greeting that follows the clock
  (Morgen / Tag / Abend), the date, one motivation line per calendar day, the
  day's calendar entries and the open tasks (Heute / Diese Woche). Both lists
  are live, complete, and scroll inside their own height budget, so the page
  keeps its shape whether the day holds two entries or twenty.
- **Aufgaben** — sectioned task list (HEUTE · MORGEN · DIESE WOCHE · DIESEN MONAT ·
  SPÄTER), category tabs, search, filters (favorites / completed / deleted),
  complete & favorite with animations, and **drag-and-drop** reordering — including
  dragging a task into another section to reschedule it.
- **Aufgabe-Detail** — full task view with edit & soft-delete (Papierkorb).
- **Neue Aufgabe / Bearbeiten** — slide-up form with a custom inline calendar that
  supports **day / week (KW) / month** due dates plus an optional time.
- **Kalender** — a full calendar module with **Tag / Woche / Monat** views, a live
  red time indicator that keeps ticking on its own, stacked multi-day event bars and
  a Google-style month grid.
  Parallel events are packed like Google Calendar — placed side by side, widened
  into the space their neighbours leave free, and collapsed into a **"+X weitere"**
  chip once a column would get too narrow to read — while event titles wrap over
  several lines and are only ever cut off when the card truly runs out of room.
  The header keeps the same structure and position in all three views, so
  switching Tag / Woche / Monat never makes the top of the screen jump.
  It **reuses the existing task data** (day list, per-day counts, month dots) — no
  duplicate storage — on a scalable event model (title, description, location,
  start/end, all-day, recurrence, reminder, birthday, timezone). **Swipe** left/right
  to change day/week/month, **search** across title, location and notes with live
  results, **long-press** a timed event to move it and **drag its handles** to
  reschedule start/end (saved instantly), plus friendly empty states — all using the
  same animations, dialogs and toasts as the Aufgaben app.
- **Termine** — create, edit and delete calendar events through a compact
  **Neuer Termin** sheet (title, Termin/Geburtstag, all-day toggle, multi-day
  start/end with times, recurrence, reminder, location, notes) and a read-only
  detail sheet with the same Bearbeiten / Löschen actions as tasks. Birthdays are
  all-day + yearly and render as **🎂 Name**. The event model maps 1:1 to Google
  Calendar (RRULE recurrence, minute-based reminders) for a future sync.
- **Echtzeit-Synchronisation** — the app is open on the phone and on the Mac at
  the same time, and both stay current on their own. A task or an event created,
  edited, completed or deleted on one device appears on the other within a
  moment, over Supabase Realtime — no manual refresh, no polling, and no full
  reload: exactly the one row that changed is folded into the list. A dropped
  connection is caught up as soon as it comes back.
- **Google Kalender** — the calendar can be connected to a Google account, and
  then runs in both directions: Google's appointments appear here, this app's
  appointments appear in Google, and a change on either side reaches the other
  without anybody pressing refresh. Google's own calendars keep their names,
  their colours and their rights — a holiday calendar is read-only because
  Google says so. Birthdays are read like any other calendar; *editing* one
  writes to Google Contacts, where Google actually keeps it, and that gets its
  own opt-in — connecting a calendar never asks for the address book.
  Recurring appointments stay one rule, not three hundred rows. The newest
  change wins, whichever side made it. Every appointment carries a switch: off
  means it lives only here, and Google never sees it. **Nothing about a Google
  event is a second kind of event** — it is a row in the same `events` table
  with an external identity, so every screen, search and drag in the calendar
  works on it unchanged. Setup: [`supabase/GOOGLE-KALENDER.md`](supabase/GOOGLE-KALENDER.md).
- **Listen** — lightweight collections that are deliberately *not* tasks,
  calendar entries or projects. Three templates: **Standard** (a plain
  checklist), **Einkauf** (optional quantity and unit, plus optional manual
  categories) and **Geld** (open amounts per person, with a quiet total of what
  is still open). One line adds a whole entry — "Äpfel 6 Stück", "Max 25" — and
  everything else is two taps away in the entry sheet. Ticking an entry off
  moves it into **Erledigt** and putting it back returns it to the open group;
  there are no counters and no progress bars anywhere. A list is pinned,
  renamed, re-iconed from a curated set, reordered by press-and-hold, archived
  (reversibly, with undo) or deleted (irreversibly, with a confirmation), and
  the archive is one quiet row at the foot of the overview.
- **Ausgaben** — a deliberately small expense tracker for the semester abroad in
  Australia. An expense is a description, an amount, the currency it was paid in
  (**AUD or EUR**) and a date that starts on today and can be moved afterwards —
  four fields and "Erstellen", because it is filled in while standing at a till.
  The overview leads with the **total** and a **AUD / EUR switch**: flipping it
  converts every number on the screen, and every expense is converted with the
  **rate that was stored on it when it was booked**, so switching the display
  currency never rewrites what a March coffee cost. The AUD/EUR rate comes from
  the European Central Bank via the free, keyless **Frankfurter** API, is asked
  for when the tracker opens and again when an expense is saved, and is shown as
  one quiet line under the total. If that request fails, the last rate the
  account actually used stands in (it is on the newest expense) and the line
  says so — nothing about capturing an expense stops working. No categories, no
  budgets, no charts: that is the point.
- **Profil** — the account, and *Integrationen → Google Kalender*: connect,
  choose which calendars sync, set the default calendar for new appointments,
  see when the last sync ran, disconnect. Disconnecting keeps every
  appointment; the synced ones simply become app-only.
- **Mehr** placeholder route, with a preview of upcoming modules.

Everything else (Morning Briefing, schedule, greeting quote) is intentionally
static per the spec.

**Not a module yet: Finanzen.** The database model, the classification engine and
the DKB PDF import
exist (`supabase/migrations/0008_finance.sql`, `src/lib/finance/`), the rules are
unit-tested, and no screen renders any of it. What is there is the foundation the
future module stands on: a booking keeps its original text and its original
amount forever, money is an integer in minor units, merchants are recognised by
patterns a human confirmed, and categories come from rules — no AI, no fuzzy
matching, and an honest "unresolved" whenever the software cannot tell. See
*Finanzen — das Datenmodell und die Regel-Engine* below.

---

## ▶️ Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The app needs a backend to do anything: copy `.env.example` to `.env` and fill
in the two public Supabase values first (see *Supabase* below). Without them it
starts into "Keine Datenbank verbunden".

```bash
npm run build        # production build → dist/
npm run preview      # preview the production build
npm run smoke        # headless runtime smoke test (jsdom) across all routes
npm run test:logic   # pure-logic tests: drag/resize math, search, timezone-safety,
                     # greeting boundaries, the quote-per-day rotation, the
                     # currency conversion and rate fallback of the Ausgaben
                     # module, and the Google sync (mapping, conflicts, two-way
                     # create/update/delete, DST, duplicates) against a fake
                     # Google
npm run test:rls     # the RLS policies and the import end-to-end against a
                     # throwaway Postgres
npm run test:layout  # the import preview and the Zuordnung screen in a real
                     # Chromium at 390 px, with hostile content (build first)
```

---

## 🔌 Supabase (required)

One project holds everything; the app is a client to it. Full setup, including
the redirect URLs for password resets and how to add a new personal table:
[`supabase/README.md`](supabase/README.md).

**1. Create the schema.** Run
[`supabase/migrations/`](supabase/migrations/) `0001` → … → `0007` in the SQL
Editor (or `supabase db push`). They create `profiles`, `tasks` and `events`,
each with indexes, constraints, an `updated_at` trigger, and Row Level Security
policies that scope every statement to `auth.uid()`; `0004` publishes `tasks`
and `events` to Supabase Realtime so open devices hear about changes; `0005`
adds the Google-Kalender tables and the Google columns on `events`; `0006` adds
the Listen tables; `0007` adds `expenses` for the Ausgaben module.

**2. Create the user.** Dashboard → Authentication → Users → *Add user*. There
is no registration screen; the profile row is created by a trigger.

**3. Point the app at the project.** Copy `.env.example` to `.env`:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**4. Connect Google (optional).** The Google-Kalender integration needs a
Google Cloud project and three Edge-Function secrets, none of which belong in
this repository. The complete, exact list of manual steps is in
[`supabase/GOOGLE-KALENDER.md`](supabase/GOOGLE-KALENDER.md). Until they are
set the app runs normally and the integration screen says it is not configured
yet.

**5. Verify the policies.** `npm run test:rls`, or run
[`supabase/tests/rls.sql`](supabase/tests/rls.sql) in the SQL Editor. It proves
against the real schema that one user cannot read, change or delete another
user's rows, that an unauthenticated client gets nothing, and that **no client
role can reach the Google tokens at all** — not another user's, not even its
own.

> Both values are public and belong in the client: the URL names the project,
> the anon key is the browser's identity before login, and RLS decides the rest.
> The **service-role key** and the **database password** must never appear in
> this repository, in the bundle, or in a GitHub variable.

---

## 🚀 Deploy (GitHub Pages)

The included workflow (`.github/workflows/deploy.yml`) builds the app and
publishes `dist/` on every push to the repository's **default branch**
(`claude/zen-mayer-bKTbe`; `main`/`master` are listed too). It runs nowhere
else on purpose: the `github-pages` environment refuses deployments from any
other branch, so a feature-branch trigger would only produce failing runs.

1. Repo **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
2. **Required:** Repo **Settings → Secrets and variables → Actions → Variables**
   (secrets work too): add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   The workflow checks both before building and fails the run if either is
   missing — a deployed app without a database is worse than a red build.
3. Merge into the default branch — the workflow prints the live URL.

**Releasing a feature branch**, in order: `npm run verify` (`test:logic` →
`smoke` → `build`, exactly the checks CI gates on), push, open a PR against the
default branch, merge, then wait for that workflow run and read its conclusion.
The run's last step polls the live `version.json` and fails unless the site
serves the commit it just built, so a green run is proof the live site is
current — and `/version` in the app shows the same commit. A red build or red
tests are never deployed. The binding procedure is written down in
[`CLAUDE.md`](CLAUDE.md) → *Deployment*.

The site is served from `/claude-repository/` (set as Vite's `base`), and routing
uses a hash router so deep links work on Pages without server rewrites.

---

## 🗂️ Project structure

```
index.html                  Vite entry
vite.config.js              base path + React plugin
tailwind.config.js          design tokens (colors, radii, animations)
supabase/migrations/        SQL: profiles + tasks + events + Google + lists + expenses
                            + finance, indexes, RLS policies
supabase/functions/         Edge Functions — the only place Google tokens exist
  _shared/                  the sync engine, in plain JS so the Node tests run it
  google-api/               everything the signed-in app asks for (verify_jwt)
  google-hooks/             OAuth callback + Google push (public, self-verifying)
supabase/tests/rls.sql      proves the policies against the real schema
tools/supabaseStub.mjs      PostgREST-shaped backend the smoke test runs against
tools/realtimeStub.mjs      Phoenix-speaking Realtime server for the smoke test
tools/smoke.mjs             jsdom runtime smoke test (incl. calendar views, Listen flows
                            and two-device sync)
tools/googleSyncFake.mjs    a fake Google Calendar + in-memory database, so the
                            real sync engine can be run without a network
src/
  main.jsx                  bootstrap (HashRouter)
  App.jsx                   providers, auth gate, routes, app shell
  index.css                 Tailwind + base styles + keyframes
  config/navigation.js      bottom nav / sidebar / action-sheet / modules (config arrays)
  config/listTemplates.js   the three Listen templates + the Einkauf categories (data only)
  config/listIcons.js       the curated 24-icon set a list picks from
  config/finance.js         the Finanzen vocabulary: the five MVP categories,
                            pattern types, review modes, transaction types
  lib/
    config.js               the two public Supabase values, read at build time
    supabase.js             the shared Supabase client (null without config)
    realtimeSync.js         pure rules for folding a Realtime change into a row list
    googleCalendar.js       calendar colours, labels and — shared with the Edge
                            Functions — which calendars may be written to
    useRealtimeSync.js      the subscription's life cycle (one channel per table)
    auth.js                 pure auth logic: the gate's phases, error messages
    date.js                 dates, ISO weeks, section grouping, formatting
    calendar.js             event geometry: parsing, overlap layout, bar packing, drag/resize math,
                            plus the day-as-a-list helpers the Heute agenda reads
    greeting.js             the time-of-day greeting and its boundaries
    quotes.js               the ten motivation lines + the day-of-year rotation
    eventOptions.js         recurrence + reminder option lists and labels
    eventSearch.js          calendar search (title / location / notes, upcoming-first)
    useNow.js               ticking clock hook for the live time indicator
    taskSelectors.js        derive grouped/filtered views (incl. tasksForDay)
    listSelectors.js        the Listen views: pinned/others, open above done,
                            category groups, the open-amount total, formatting
    listParsing.js          reads "Äpfel 6 Stück" / "Max 25,00 €" from one line
    exchangeRate.js         the AUD/EUR rate: the source, reading its answer,
                            and the fallback chain when the request fails
    expenses.js             the Ausgaben views: converting with the rate stored
                            per row, the totals in either currency, formatting
    finance/                the Finanzen engine — pure, no React, no Supabase:
      normalize.js          raw booking text → tokens (and nothing else: no city,
                            no company suffix and no number is ever removed)
      merchantMatching.js   which merchant a booking is, or why it cannot be said
      categoryRules.js      which category that means, incl. the amount rules
      backtest.js           what a new pattern would do to existing bookings
      learning.js           one marked token + one chosen category → one request
      importFlow.js         the import as a person reads it: the three pipeline
                            calls wired once, and outcomes turned into German
      types.js              the row and result shapes, as JSDoc typedefs
      dkb/                  the DKB Umsatzexport importer, stage 1:
        layout.js           the coordinates of the real export, as measured
        lines.js            PDF.js items → printed lines (spaces included)
        amount.js           "-54.80" → -5480, via BigInt and never a float
        glyphs.js           positions the file does not encode → U+FFFD + warning
        parse.js            blocks, the twelve checks, the parsed bookings
        reference.js        the merchant reference, read off its position
        reconcile.js        a second export against what is already stored
        plan.js             a confirmed plan → the payload the database applies
        fingerprint.js      dedupe candidates and their collisions
        sourceHash.js       the identity of the file, without the file
        extract.js          the only file that touches pdfjs
  data/
    taskRepository.js       tasks in Supabase (+ taskDefaults.js: writable columns)
    eventRepository.js      events in Supabase (+ eventDefaults.js)
    profileRepository.js    the signed-in user's profile row
    googleRepository.js     reads the two token-free Google tables; every write
                            goes through an Edge Function
    listRepository.js       lists and their entries (+ listDefaults.js)
    expenseRepository.js    expenses in Supabase (+ expenseDefaults.js)
    financeRepository.js    the finance tables + the atomic learning RPC
                            (+ financeDefaults.js: writable columns per table)
  context/                  Auth · Tasks · Events · Lists · Expenses · Finance ·
                            Google · UI (overlays) · Toast
  components/               TopBar (the global header of every main area),
                            BottomNav, Sidebar, ActionSheet, BottomSheet, TaskForm,
                            EventForm, InlineCalendar, MiniCalendar, FilterSheet,
                            TaskRow, EventDetailSheet, ConfirmDialog, ScrollList
                            (a list that scrolls inside its own height budget),
                            ListForm, ListActionsSheet, ListItemSheet, ListRow,
                            ListItemRow, ExpenseForm, ExpenseRow,
                            CurrencySwitch, FinanceImportSheet, …
  screens/                  Home, TasksList, TaskDetail, Kalender, Listen,
                            ListeDetail, ListenArchiv, Ausgaben, Finanzen, Mehr,
                            Profil, ProfilGoogle, Login, NewPassword,
                            BackendMissing
    home/                   HomeGreeting, AgendaCard, TasksCard and the HomeCard
                            shell every Heute block is built from
    calendar/               DayView, WeekView, MonthView, parts (shared grid pieces),
                            useSwipe (period navigation), useTimedGesture (move/resize),
                            useElementWidth (measured column width for the layout)
```

### Extending the navigation
Adding a nav item, sidebar link, action-sheet entry, or "coming soon" module is a
one-line edit to the arrays in **`src/config/navigation.js`** — no component
changes required. Build a new module by adding its `<Route>` in `App.jsx` and
flipping it from `futureModules` into the active nav lists.

A new main area gets the app's header for free: render
**`<TopBar title="…" />`** as the first element of the screen and put the
screen's own content below it. `title` is the only prop — height, insets, the
hamburger, the title's typography and the notification/profile pair live in
`src/components/TopBar.jsx`, so no screen can shift them. Controls that belong
to one screen (a search, a filter, the calendar's period switch and its date)
go into that screen's first content row, under the bar.

---

## 💶 Finanzen — das Datenmodell und die Regel-Engine

The first stage of the Finanzen module: everything except a screen. It replaces
a personal Excel expense tracker, and it is built around four rules that do not
bend.

**The original booking is never rewritten.** An imported booking keeps its
`raw_description`, its `amount_minor`, its currency and its dates forever — not
by convention but by a trigger that refuses the UPDATE, whoever sends it.
Merchant, category, transaction type and "counts in the analytics" are separate,
nullable columns — interpretation, re-computable at any time. A Retoure is its
own booking of type `refund` that points back at the original; it never corrects
the original's amount.

**Money is an integer.** `amount_minor bigint` holds minor units — 24,83 € is
`2483` — and every amount is stored next to its currency. There is no float
anywhere in this module, and EUR is a value, not an assumption. The column is
bounded to ±(2^53−1): PostgREST sends bigint as a JSON number and JavaScript
reads it as a float64, so what the database accepts is exactly what the client
can read back, and anything that is not an exact integer decides nothing.

**Merchant and category are two questions.** `finance_merchants` +
`finance_merchant_patterns` answer *who was this?*; `finance_category_rules`
answers *what kind of spending is that?*. That separation is what lets EDEKA be
one merchant with two categories that depend on the amount (≤ 12,00 € →
Restaurant, > 12,00 € → Lebensmittel), and what lets a merchant be recognised
without its category being decided.

**Nothing is guessed.** Matching is deterministic: Unicode, case and whitespace
are unified, punctuation is a token boundary, and a pattern is either a whole
token (`REWE` matches `REWE TROISDORF SAGT DANKE 8407`, never `REWERT`) or a
contiguous phrase (`MAX UND MORITZ`, not `MORITZ UND MAX`). No Levenshtein, no
semantic matching, no LLM, and no city name or company suffix is ever quietly
removed. Two merchants matching the same booking is a **conflict**, and a
conflict stays one — the software never picks a winner. When in doubt the answer
is `unresolved`.

A pattern only ever comes from a human: the user marks `REWE` in a booking text
and picks *Lebensmittel*. Before saving, `backtestPattern` says what that would
do — *"dieses Muster trifft 34 bestehende Buchungen, davon 2 mit einem anderen
Händler"*. Saving it is one database function, `finance_learn_merchant_rule`, so
merchant + pattern + rule + this booking + the bookings the pattern now explains
either all happen or none of them do. It runs with the caller's own rights (no
service role, no elevated function).

**And it verifies instead of believing.** The client sends the ids its backtest
found; the database re-checks every one of them against that booking's own
stored tokens (`normalized_tokens`, derived from `raw_description` once, by the
same normaliser, and frozen with it) before touching a single row — plus the
three conditions that protect a decision somebody already made: not assigned,
not `manual_lock`ed, no override. A bug in the client's match set can therefore
narrow what gets re-labelled, never widen it, and the result reports
`requested_count` next to `applied_count` so the difference is visible rather
than silent. The same check decides whether the pattern may be learned from the
booking at all: if it does not occur in it, it was not marked in it.

**Learning a rule and correcting one booking are two different acts.** Marking
`REWE` → *Lebensmittel* creates merchant, pattern and rule, and that booking
follows the rule from then on like every other. Correcting a single booking
writes a row in `finance_transaction_overrides` (or sets `manual_lock`), and
that decision wins against every rule, now and after every future rule change —
including the one being learned: the rule is still created, the booking keeps
what the user set, and `transaction_updated: false` says so.

The rules live in `src/lib/finance/` and are pure; `tools/financeLogic.mjs`
covers them (177 assertions, incl. the EDEKA cent boundary in both directions
and both signs). Atomicity, the constraints and the account isolation are
database behaviour and are proved in `supabase/tests/rls.sql`
(`npm run test:rls`).

### Reading a DKB Umsatzexport

`src/lib/finance/dkb/` turns the bank's PDF export into bookings, deterministically
and with no OCR and no language model anywhere in the path. Every coordinate it
relies on was **measured** on a real export with `pdfjs.getTextContent()`, not
assumed: a booking block begins at an item that sits in the date column and is
exactly `dd.mm.yyyy`, and ends before the next one.

Four properties of the real file shape the implementation:

- **The document counts itself.** It prints *"Anzahl der Transaktionen: 27"* and
  no balance at all, so that count — not a sum — is what the import is verified
  against. A sum could coincidentally balance out across wrongly split blocks; a
  record count cannot.
- **Spaces are their own text items.** Discarding items without visible content
  turns `oePA Verkehrsgesellsch Troisdorf DE` into `oePA VerkehrsgesellschTroisdorfDE`.
  Items are therefore kept as they are, sorted by x and concatenated.
- **Some characters are not in the file.** Its ToUnicode table maps two ligature
  glyphs to `U+0000` — so "A[ff]airs" is genuinely unreadable, not merely unread.
  Those positions become `U+FFFD` (a NUL could not be stored in a `text` column
  anyway) and raise a structured warning; the word they came from can never
  become a merchant pattern (`unreliableTokens` in `normalize.js`).
- **pdfjs decides where one text item ends.** That decision is a heuristic over
  glyph advances, not a property of the document: the same page label arrives as
  one item `Seite 1 von 3` from the real export and as three from a generated
  PDF of the identical layout. The header therefore reads printed *runs* —
  touching items joined back together, a wide whitespace item ending the run
  because it is a column gap, not a space (`mergeAdjacent` in `lines.js`) — and
  whitespace at the two ends of a description line is dropped, because it is
  padding pdfjs inserted and would otherwise be frozen into `raw_description`
  and change the fingerprint.

Anything the parser cannot read with certainty stops the **whole** import — a
statement half-read is a spending total quietly missing a booking.
`tools/dkbParserLogic.mjs` covers all of it (150 assertions) against fixtures
that reproduce the real geometry with invented content — the statement itself
stays out of this repository.

### Reconciling a second export

`reconcile.js` answers what a single export could not: what a later, overlapping
export does to bookings that are already stored. Two real exports settled it, and
each of the three things they showed shaped a rule:

- **A provisional booking comes back settled, with a different text.**
  `Deutsche Bahn` plus an ISO timestamp becomes `DB.Vertrieb.GmbH/474717313729`
  plus a card date. Counting both would double the spending, so the provisional
  one is superseded.
- **A booking that was already settled can come back richer.** `REWE` becomes
  `REWE.Mohamed.Boufo/Frankfurt`, `EDEKA` becomes `EDEKA.FLECK/STUTTGART`. Same
  booking, better text — so text is not identity, and the stored original stays
  frozen either way.
- **The reference is not a transaction id.** `564851284265` sits on the −50,05 €
  purchase *and* on the +50,05 € refund of it. It is evidence that two bookings
  belong together, nothing more — and it is read off its position in the text,
  never off the length of a digit run, because a naive sweep also collects
  exchange-rate fragments and timestamps.

The hierarchy each candidate has to pass, always on the whole tuple and never on
one field alone: identical text → date + amount + reference → date + amount +
card date → provisional-to-settled by amount + card date (or reference). A tier
only decides when exactly one candidate matches on each side; otherwise the case
falls through and ends as `unresolved`.

What it refuses is the point. Two −60,65 € bookings on the same day become two
settled ones with different references, and **nothing in either document says
which settles which** — the minute exists only in one export, the reference only
in the other. So the pair is superseded *as a pair*, with its cardinality
preserved and no individual link invented. A booking carrying `manual_lock` or an
override is never re-labelled; it becomes `review` with the decision untouched.
The module is pure: it writes nothing and proposes a plan for a human to confirm.
Ambiguity never falls through to "new": when the number of candidates does not
match on both sides, the case ends as `unresolved` rather than importing a
booking that is already there a second time. Individual links are only drawn
where they assert nothing — one against one, or members that are indistinguishable
from each other. The account is part of every key, so a booking of one account can
never be matched by another account's import, and the whole plan is computed in a
fixed order, so the same input produces the same plan whichever way the rows were
sorted on their way in — and the account being imported into has to be named,
because stored bookings carry an account and freshly parsed ones do not; leaving
that implicit would have let every arrival fall through to "new".
`tools/dkbReconcileLogic.mjs` covers it with 107 assertions against fixtures of
both exports.

### Storing what the plan decided

A plan is worth nothing while it lives in a browser tab. `plan.js` narrows it to
what the database stores — the bookings' own columns, one decision each, the
refund proposals as ids rather than as whole bookings — and refuses a malformed
plan before a transaction is ever opened.
`finance_apply_reconciliation_plan` (`supabase/migrations/0009_finance_import.sql`)
then applies it in one transaction: new bookings, the richer texts as
append-only *observations* next to the frozen originals, supersessions as
*relations* with roles that express 1↔1, 1↔n and n↔n alike, the analytics flag,
and everything nobody could decide as *review items* carrying the full incoming
booking.

Four properties matter more than the rest, and each is a database behaviour
rather than a convention:

- **All or nothing.** A plan that fails halfway leaves no booking, no relation
  and no review item behind, and the import stays unapplied.
- **Applied once.** The import row is locked, and one already applied returns
  its stored result with `replayed: true` instead of writing again. The same
  export re-imported produces no second booking, no second relation and no
  second observation — the observation's key is its content, so equal evidence
  is one row. Which imports actually contained it is recorded separately, as
  sightings, so storing the evidence once costs no provenance.
- **Manual beats automatic.** Whether a booking is protected is read from the
  database, never from the plan. A protected predecessor is left exactly as it
  is; the *new* booking stands down instead, so the two can never both count,
  and a review item says so. Confirming such a relation by hand is refused too,
  until the lock is cleared — the rule holds inside the undo path as well.
- **The plan is not believed.** It is computed in a browser, so the database
  re-checks what it can without re-implementing the matcher: owner, account,
  the period the statement itself declares, and — the one that matters most —
  that a supersession is *the same payment*, same amount and same currency on
  both sides. Without that, any two of your own bookings could be declared a
  supersession and the larger one would quietly leave the analytics. These
  checks sit on the tables as a deferred constraint trigger rather than inside
  the function, because the function runs with the caller's own rights and is
  therefore not the only way a row can appear.

A supersession can be taken back: `finance_resolve_relation` restores exactly
the bookings that relation switched off and nothing else, so an undo can never
re-enable something the user excluded themselves. A rejected relation stays as
history and stops blocking the correct one.

### Importing a statement

`/finanzen` is the module's first productive screen, and deliberately not a
dashboard: an empty account has nothing to summarise, so it shows an invitation
and one button. Once bookings exist it shows how many there are and when the
newest one is from — orientation, not analysis — and the import button stays
directly under it.

The import itself is one sheet with six states: pick a file, read it, name the
account the first time, look at what arrived, save it, done. `importFlow.js`
holds the whole of it that is not React — the three pipeline calls wired once
(`readStatementFile` → `buildPlan` → `buildPayload`) and the translation of
matcher vocabulary into sentences a person reads:

| The plan says | The preview says |
|---|---|
| `new` | Neu |
| `duplicate` | Bereits vorhanden |
| `enriched` | Aktualisiert |
| `supersedes` / `supersedes_group` | Ersetzt |
| `unresolved` / `review` | Prüfen |

Two of those pairs matter more than the labels. `supersedes` and
`supersedes_group` read the same on purpose: whether the two statements allowed
an individual link is a matching detail, and a preview that showed "this one
replaces that one" for an ambiguous pair would be claiming something neither
document says. And the summary counts what will actually be written —
`new` + `supersedes` — so the confirm button promises the number of rows that
appear, not the size of the file.

**The PDF never leaves the device.** It is read into memory, parsed, and
dropped; what is stored is the bookings the parser produced and a SHA-256 of
the bytes (`sourceHash.js`) so that the same file picked twice is recognised as
the same import rather than piling up import rows. A refused file says so in a
sentence — the parser's codes stay available in a collapsed detail area, never
in the headline.

Categorisation deliberately does not happen at import: the apply function
writes a booking's raw half and knows nothing of `merchant_id`, so assigning a
merchant would need either a schema change or a second write path past the
function's invariants. Bookings arrive unresolved; the Zuordnung flow below is
what decides what they mean.

`tools/financeImportFlowLogic.mjs` covers the flow with 110 assertions — the
real parser, the real matcher, the real payload builder and the repository's
RPC path — because that is where "15 neu" has to be true. The DOM assertions in
`tools/smoke.mjs` cover the states reachable without a PDF (empty account, an
account with bookings, a failed load, the sheet opening and closing, the file
input accepting only PDFs).

Three suites close what a jsdom test structurally cannot:

- `tools/financeImportPdfLogic.mjs` (36) writes a **real PDF file** from the
  measured geometry (`tools/fixtures/dkbPdf.mjs`) and hands the bytes to the
  real `readStatementFile` with the real pdfjs behind it — the one link the
  fixtures cannot exercise, because they start where pdfjs stops.
- `tools/financeImportE2E.mjs` (37) runs the flow against a real Postgres with
  the real apply function, **reloading between imports** exactly as the app
  does, so nothing can quietly survive in memory from one import to the next.
- `tools/financeImportLayout.mjs` (15) renders the real preview in the
  installed Chromium at 390 px with five hundred hostile bookings and measures
  it — jsdom has no layout and cannot tell whether anything fits.

### Zuordnung — teaching the app a merchant

The screen where an unrecognised booking becomes a rule. The user marks the
words that identify the merchant, names them, picks a category, and from then on
the same text is recognised by itself.

**It contains no matching logic at all.** Every question it asks was already
answered by the engine 0008 ships: `matchMerchant` decides who a booking belongs
to, `resolveCategory` what kind of spending it was, `backtestPattern` what the
new pattern would do to the bookings that already exist, and
`finance_learn_merchant_rule` writes merchant, pattern, rule and every affected
booking in one transaction. What is new is a queue and a vocabulary:

- `src/lib/finance/classificationQueue.js` — which bookings still need a human.
  Asked of the ENGINE, never of the `merchant_id` column: a pattern the user
  deactivates puts its bookings back in front of them, and a booking imported
  before the rule existed disappears from the queue the moment the rule exists,
  without anybody touching the row. That is what keeps the importer and the
  classification two responsibilities instead of one.
- `src/lib/finance/classificationFlow.js` — the words, and the one thing the
  engine has no opinion about: how a raw description is cut into words a finger
  can point at. A selection is a RANGE, never a set, because `exact_phrase`
  means tokens next to each other in order.

**Three kinds of decision, and the screen asks for the right one.** They are
not variations of the same question, and treating them as one was the flow's
first real bug:

- `unresolved` — nothing recognises this text. Teach a merchant, and every other
  booking the pattern explains follows.
- `conflict` — two merchants' patterns already claim this text. A third, more
  specific pattern removes **neither** claim: `matchMerchant` has no specificity
  ranking, on purpose, so the booking would stay in conflict forever. The screen
  therefore does not offer one. It names both claimants and lets the user decide
  this one booking.
- `review_required` — the merchant IS recognised and the user asked to see every
  booking of it. Another default rule would settle nothing; the category for this
  one booking would.

The last two are written to `finance_transaction_overrides`, which beats every
rule and changes none of them. A merchant like PayPal gets its
`review_mode = 'always_review'` through the one setting the flow offers, and
only while a NEW merchant is being created — an existing merchant is never
changed from this screen.

Three rules the screen holds to, and the reasons:

- **Hits and changes are different numbers**, and the preview counts changes
  the way `finance_learn_merchant_rule` counts them, condition for condition.
  The booking in hand is written whenever it is not locked and has no override —
  an existing `merchant_id` does not stop that — while a booking merely swept up
  alongside it is additionally protected by `merchant_id is null`. Getting that
  asymmetry wrong promised one number and wrote another, exactly in the
  supported case where a deactivated pattern puts a still-stamped booking back
  in the queue.
- **No stopword list, ever.** „MARKT" is not forbidden and not removed from
  matching. What the user gets is the measured breadth of the pattern on their
  own bookings — „trifft 20 von 30 Umsätzen" — and then they decide. The one
  hard stop is a pattern that already belongs to a different merchant, because
  the database refuses it too.
- **A damaged word cannot become a rule.** The tokenizer splits a word at a
  replacement character, so what would be saved is a fragment that keeps
  matching forever. Those words are shown and struck through rather than hidden;
  the intact words of the same booking stay usable.

`tools/financeClassifyLogic.mjs` covers it with 143 assertions against the real
engine; `tools/financeClassifyE2E.mjs` (89) runs the whole gesture against a
real Postgres and the real `finance_learn_merchant_rule`, **reloading after
every save** — including the assertion the screen exists for: the number the
preview promised and the `applied_count` the database returns are the same
number. `tools/financeClassifyLayout.mjs` (19) measures the screen in Chromium
at 390 px with a booking whose longest word is 78 characters.

The flow needed **no migration**: 0008 already holds the merchants, the
patterns, the rules, the overrides and the atomic learning function, and 0009
added nothing that stands in its way.

`tools/financeImportLogic.mjs` covers the client half (44 assertions);
`supabase/tests/finance_import.sql` covers the rest against a real Postgres
(113) — atomicity, the repeated export, the chain A → B → C, n↔n, `manual_lock`,
overrides, refund candidates, account separation, the trust boundary, direct
writes that bypass the function, the undo path, observation provenance and user
isolation. `supabase/tests/finance_import_upgrade_*.sql` applies the migration
to a database that already ran the previous one and holds data, and checks that
nothing moved.

---

## 🎨 Design system

The binding product-design standard (visual, UX, interaction, motion,
accessibility) lives in
[`.claude/skills/product-design-system/`](.claude/skills/product-design-system/SKILL.md)
and is wired into every Claude Code session through [`CLAUDE.md`](CLAUDE.md).
Known deviations of the current code are tracked in
[`known-gaps.md`](.claude/skills/product-design-system/reference/known-gaps.md).

All tokens live in `tailwind.config.js` and are used as Tailwind classes
(`bg-bg-card`, `text-text-secondary`, `text-accent`, …).

| Token | Value | Use |
|---|---|---|
| `bg-base` | `#080C14` | deepest background |
| `bg-card` | `#0F1629` | cards / sections |
| `bg-elevated` | `#141E35` | modals / sheets |
| `bg-input` | `#1A2340` | inputs |
| `accent` | `#4A80FF` | primary action / active |
| `accent-dim` | `#1E3A6E` | blue-tinted card backgrounds |
| `text-primary` | `#FFFFFF` | titles / task names |
| `text-secondary` | `#8891A4` | subtext / timestamps |
| `text-muted` | `#4A5268` | placeholders / disabled |
| `danger` | `#EF4444` | destructive |
| `success` | `#34D399` | completion |

Type sizes are tokens too, named by role rather than by pixel value (§15):

| Token | Size | Use |
|---|---|---|
| `text-page` | 28px | screen titles |
| `text-section` | 18px | section titles inside a screen |
| `text-heading` | 17px | the title of a sheet, dialog or the sidebar |
| `text-field` | 16px | form fields (also the size below which iOS zooms) |
| `text-body` | 15px | body and list text |
| `text-ui` | 14px | controls: buttons, toast, chips |
| `text-label` | 13px | labels |
| `text-caption` | 12px | secondary and meta lines |
| `text-meta` | 11px | badges, calendar day numbers |

Use them in new code. The `text-[Npx]` literals still in the app are migrated
only when their line is edited anyway — see `known-gaps.md` → G10.

Mobile-first (~390px). On desktop the app is capped to `max-width: 430px` and
centered so it keeps reading like a phone.
