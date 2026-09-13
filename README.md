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

**Not a module yet: Finanzen.** The database model and the classification engine
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
npm run test:rls     # the RLS policies against a throwaway Postgres
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
      types.js              the row and result shapes, as JSDoc typedefs
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
  context/                  Auth · Tasks · Events · Lists · Expenses · Google ·
                            UI (overlays) · Toast
  components/               TopBar (the global header of every main area),
                            BottomNav, Sidebar, ActionSheet, BottomSheet, TaskForm,
                            EventForm, InlineCalendar, MiniCalendar, FilterSheet,
                            TaskRow, EventDetailSheet, ConfirmDialog, ScrollList
                            (a list that scrolls inside its own height budget),
                            ListForm, ListActionsSheet, ListItemSheet, ListRow,
                            ListItemRow, ExpenseForm, ExpenseRow,
                            CurrencySwitch, …
  screens/                  Home, TasksList, TaskDetail, Kalender, Listen,
                            ListeDetail, ListenArchiv, Ausgaben, Mehr, Profil,
                            ProfilGoogle, Login, NewPassword, BackendMissing
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
