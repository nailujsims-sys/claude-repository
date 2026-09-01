# 🧠 Mind Whiteboard

A premium, dark, mobile-first personal productivity app for **Julian**. Version 1
ships three fully functional modules — the **Startseite** (home dashboard), the
**Aufgaben** task manager and the **Kalender** — on top of a navigation
architecture (bottom bar, sidebar, action sheet) built to be extended module by
module.

Built with **React + Vite + Tailwind CSS**, with a data layer that talks to
**Supabase** when configured and otherwise falls back to **localStorage**, so the
app is fully usable the moment it loads.

---

## ✨ What's in V1

- **Startseite** — time-aware greeting, static Morning Briefing & schedule cards,
  and a live Aufgaben preview (Heute / Diese Woche).
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
- **Mehr** placeholder route, with a preview of upcoming modules.

Everything else (Morning Briefing, schedule, greeting quote) is intentionally
static per the spec.

---

## ▶️ Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

By default the app runs in **local mode** (no login) and seeds a set of demo
tasks in your browser's localStorage, so it looks and behaves exactly like the
design out of the box.

```bash
npm run build        # production build → dist/
npm run preview      # preview the production build
npm run smoke        # headless runtime smoke test (jsdom) across all routes
npm run test:logic   # pure-logic tests: drag/resize math, search, timezone-safety
```

---

## 🔌 Connect Supabase (optional)

The app becomes a real, synced, single-user app the moment you provide Supabase
credentials. Three steps:

**1. Create the tables + RLS.** In your Supabase project open the SQL Editor and
run [`supabase/migrations/0001_create_tasks.sql`](supabase/migrations/0001_create_tasks.sql)
and then [`supabase/migrations/0002_create_events.sql`](supabase/migrations/0002_create_events.sql).
They create the `tasks` and `events` tables, indexes, an `updated_at` trigger, and
Row Level Security policies so each user only sees their own rows.

**2. Create Julian's user.** Supabase Dashboard → Authentication → Users → *Add
user* → set his email + password. (There is no registration screen — Julian is
the only user.)

**3. Point the app at the project.** Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Restart `npm run dev`. When both vars are set the app shows the login screen and
reads/writes the `tasks` table; when either is missing it stays in local mode.

> The anon key is meant to be shipped in client code — it's protected by RLS — so
> committing it as a build-time variable is safe.

---

## 🚀 Deploy (GitHub Pages)

The included workflow (`.github/workflows/deploy.yml`) builds the app and
publishes `dist/` on every push to `main`, `master`, or this feature branch.

1. Repo **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
2. *(Optional, to use Supabase in production)* Repo **Settings → Secrets and
   variables → Actions → Variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Without them the deployed app runs in local mode.
3. Push — the workflow prints the live URL.

The site is served from `/claude-repository/` (set as Vite's `base`), and routing
uses a hash router so deep links work on Pages without server rewrites.

---

## 🗂️ Project structure

```
index.html                  Vite entry
vite.config.js              base path + React plugin
tailwind.config.js          design tokens (colors, radii, animations)
supabase/migrations/        SQL: tasks + events tables + RLS
tools/smoke.mjs             jsdom runtime smoke test (incl. calendar views)
src/
  main.jsx                  bootstrap (HashRouter)
  App.jsx                   providers, auth gate, routes, app shell
  index.css                 Tailwind + base styles + keyframes
  config/navigation.js      bottom nav / sidebar / action-sheet / modules (config arrays)
  lib/
    config.js               env detection (Supabase vs local)
    supabase.js             Supabase client (or null)
    date.js                 dates, ISO weeks, section grouping, formatting
    calendar.js             event geometry: parsing, overlap layout, bar packing, drag/resize math
    eventOptions.js         recurrence + reminder option lists and labels
    eventSearch.js          calendar search (title / location / notes, upcoming-first)
    useNow.js               ticking clock hook for the live time indicator
    taskSelectors.js        derive grouped/filtered views (incl. tasksForDay)
    seed.js / eventSeed.js  demo tasks / events for local mode
  data/
    taskRepository.js       factory: picks Supabase or local impl
    supabaseTaskRepository.js · localTaskRepository.js · taskDefaults.js
    eventRepository.js      factory for calendar events (Supabase or local)
    supabaseEventRepository.js · localEventRepository.js · eventDefaults.js
  context/                  Auth · Tasks · Events · UI (overlays) · Toast
  components/               BottomNav, Sidebar, ActionSheet, BottomSheet, TaskForm,
                            EventForm, InlineCalendar, MiniCalendar, FilterSheet,
                            TaskRow, EventDetailSheet, ConfirmDialog, …
  screens/                  Home, TasksList, TaskDetail, Kalender, Mehr, Login
    calendar/               DayView, WeekView, MonthView, parts (shared grid pieces),
                            useSwipe (period navigation), useTimedGesture (move/resize),
                            useElementWidth (measured column width for the layout)
```

### Extending the navigation
Adding a nav item, sidebar link, action-sheet entry, or "coming soon" module is a
one-line edit to the arrays in **`src/config/navigation.js`** — no component
changes required. Build a new module by adding its `<Route>` in `App.jsx` and
flipping it from `futureModules` into the active nav lists.

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
