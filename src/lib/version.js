import { formatLongDate } from './date'

// Build identity — "which build am I looking at?".
//
// All three values are injected by vite.config.js at build time (see its
// `define` block) and come from one source each: the product version from
// package.json, the commit from GITHUB_SHA (CI) or `git rev-parse` (local),
// the timestamp from the build itself. Nothing here is maintained by hand.
//
// The `typeof` guards keep this module usable where the defines do not exist:
// tools/smoke.mjs bundles with esbuild directly, and a bare `__APP_VERSION__`
// would throw a ReferenceError there. It then reports a dev build instead.
/* global __APP_VERSION__, __BUILD_COMMIT__, __BUILD_TIME__ */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev'
export const BUILD_COMMIT =
  typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown'
export const BUILD_TIME =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null

const p2 = (n) => String(n).padStart(2, '0')

// Short hash — the form a human reads and compares. `unknown` stays honest
// rather than being shortened into something that looks like a real commit.
export function shortCommit(sha = BUILD_COMMIT) {
  return sha && sha !== 'unknown' ? sha.slice(0, 7) : 'unbekannt'
}

// "27. August 2026, 22:01" — local time, same date vocabulary as the rest of
// the app (lib/date.js), so the screen reads like every other screen.
export function formatBuildTime(iso = BUILD_TIME) {
  if (!iso) return 'unbekannt'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unbekannt'
  return `${formatLongDate(d)}, ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
