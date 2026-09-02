# 🧠 Mind Whiteboard

A premium, dark, mobile-first personal productivity app for **Julian**. Version 1
ships three fully functional modules — the **Startseite** (home dashboard), the
**Aufgaben** task manager and the **Kalender** — on top of a navigation
architecture (bottom bar, sidebar, action sheet) built to be extended module by
module.

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
- **Mehr** placeholder route, with a preview of upcoming modules.

Everything else (Morning Briefing, schedule, greeting quote) is intentionally
static per the spec.

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
                     # greeting boundaries, the quote-per-day rotation
```

---

## 🔌 Supabase (required)

One project holds everything; the app is a client to it. Full setup, including
the redirect URLs for password resets and how to add a new personal table:
[`supabase/README.md`](supabase/README.md).

**1. Create the schema.** Run
[`supabase/migrations/`](supabase/migrations/) `0001` → `0002` → `0003` → `0004`
in the SQL Editor (or `supabase db push`). They create `profiles`, `tasks` and
`events`, each with indexes, constraints, an `updated_at` trigger, and Row Level
Security policies that scope every statement to `auth.uid()`; `0004` publishes
`tasks` and `events` to Supabase Realtime so open devices hear about changes.

**2. Create the user.** Dashboard → Authentication → Users → *Add user*. There
is no registration screen; the profile row is created by a trigger.

**3. Point the app at the project.** Copy `.env.example` to `.env`:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**4. Verify the policies.** `npm run test:rls`, or run
[`supabase/tests/rls.sql`](supabase/tests/rls.sql) in the SQL Editor. It proves
against the real schema that one user cannot read, change or delete another
user's rows, and that an unauthenticated client gets nothing.

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
supabase/migrations/        SQL: profiles + tasks + events, indexes, RLS policies
supabase/tests/rls.sql      proves the policies against the real schema
tools/supabaseStub.mjs      PostgREST-shaped backend the smoke test runs against
tools/realtimeStub.mjs      Phoenix-speaking Realtime server for the smoke test
tools/smoke.mjs             jsdom runtime smoke test (incl. calendar views + two-device sync)
src/
  main.jsx                  bootstrap (HashRouter)
  App.jsx                   providers, auth gate, routes, app shell
  index.css                 Tailwind + base styles + keyframes
  config/navigation.js      bottom nav / sidebar / action-sheet / modules (config arrays)
  lib/
    config.js               the two public Supabase values, read at build time
    supabase.js             the shared Supabase client (null without config)
    realtimeSync.js         pure rules for folding a Realtime change into a row list
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
  data/
    taskRepository.js       tasks in Supabase (+ taskDefaults.js: writable columns)
    eventRepository.js      events in Supabase (+ eventDefaults.js)
    profileRepository.js    the signed-in user's profile row
  context/                  Auth · Tasks · Events · UI (overlays) · Toast
  components/               TopBar (the global header of every main area),
                            BottomNav, Sidebar, ActionSheet, BottomSheet, TaskForm,
                            EventForm, InlineCalendar, MiniCalendar, FilterSheet,
                            TaskRow, EventDetailSheet, ConfirmDialog, ScrollList
                            (a list that scrolls inside its own height budget), …
  screens/                  Home, TasksList, TaskDetail, Kalender, Mehr,
                            Login, NewPassword, BackendMissing
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
