# 🧠 Mind Whiteboard

A premium, dark, mobile-first personal productivity app for **Julian**. Version 1
ships two fully functional modules — the **Startseite** (home dashboard) and the
**Aufgaben** task manager — on top of a navigation architecture (bottom bar,
sidebar, action sheet) built to be extended module by module.

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
- **Kalender** and **Mehr** placeholder routes, with a preview of upcoming modules.

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
```

---

## 🔌 Connect Supabase (optional)

The app becomes a real, synced, single-user app the moment you provide Supabase
credentials. Three steps:

**1. Create the table + RLS.** In your Supabase project open the SQL Editor and
run [`supabase/migrations/0001_create_tasks.sql`](supabase/migrations/0001_create_tasks.sql).
It creates the `tasks` table, indexes, an `updated_at` trigger, and Row Level
Security policies so each user only sees their own rows.

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
supabase/migrations/        SQL: tasks table + RLS
tools/smoke.mjs             jsdom runtime smoke test
src/
  main.jsx                  bootstrap (HashRouter)
  App.jsx                   providers, auth gate, routes, app shell
  index.css                 Tailwind + base styles + keyframes
  config/navigation.js      bottom nav / sidebar / action-sheet / modules (config arrays)
  lib/
    config.js               env detection (Supabase vs local)
    supabase.js             Supabase client (or null)
    date.js                 dates, ISO weeks, section grouping, formatting
    taskSelectors.js        derive grouped/filtered views from the task list
    seed.js                 demo tasks for local mode
  data/
    taskRepository.js       factory: picks Supabase or local impl
    supabaseTaskRepository.js
    localTaskRepository.js
    taskDefaults.js         shared task shape + writable-field whitelist
  context/                  Auth · Tasks · UI (overlays) · Toast
  components/               BottomNav, Sidebar, ActionSheet, BottomSheet, TaskForm,
                            InlineCalendar, FilterSheet, TaskRow, StarButton, …
  screens/                  Home, TasksList, TaskDetail, Kalender, Mehr, Login
```

### Extending the navigation
Adding a nav item, sidebar link, action-sheet entry, or "coming soon" module is a
one-line edit to the arrays in **`src/config/navigation.js`** — no component
changes required. Build a new module by adding its `<Route>` in `App.jsx` and
flipping it from `futureModules` into the active nav lists.

---

## 🎨 Design system

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

Mobile-first (~390px). On desktop the app is capped to `max-width: 430px` and
centered so it keeps reading like a phone.
