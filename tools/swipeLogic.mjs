// Pure-logic tests for the calendar period swipe (G6).
// The touch plumbing in src/screens/calendar/useSwipe.js is deliberately thin —
// the decisions ("which axis is this?", "how far may the view trail?", "does
// this release navigate?") live in exported pure functions, so they can be
// checked here without a browser. Bundled with esbuild like the other logic
// tests.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  SWIPE_DISTANCE, SWIPE_RATIO, SWIPE_SLOP, SWIPE_FLICK, SWIPE_HINT_MAX,
  isHorizontal, swipeAxis, swipeHint, shouldNavigate,
  trackSample, velocityFrom,
} from './src/lib/swipeNav.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }

const NEXT = 1, PREV = -1, STAY = 0
// Named so the intent of each case is readable: left is "next period".
const left = (px) => -px
const right = (px) => px
const nav = (dx, dy = 0, velocity = 0) => shouldNavigate({ dx, dy, velocity })

// ── the guards that were already there and must not change ──────────────────
ok('the distance threshold is still 48', SWIPE_DISTANCE === 48)
ok('the horizontal/vertical ratio is still 1.4', SWIPE_RATIO === 1.4)
ok('pure horizontal dominates', isHorizontal(60, 0))
ok('pure vertical never dominates', !isHorizontal(0, 60))
ok('a 45° diagonal does not dominate', !isHorizontal(60, 60))
ok('the ratio is the boundary',
   isHorizontal(70, 50) && !isHorizontal(69, 50))

// ── axis locking ────────────────────────────────────────────────────────────
ok('a gesture under the slop has no axis yet', swipeAxis(3, 2) === null)
ok('the slop is measured as a distance, not per axis',
   swipeAxis(SWIPE_SLOP - 1, 0) === null && swipeAxis(SWIPE_SLOP + 1, 0) === 'x')
ok('a clearly horizontal gesture locks to x', swipeAxis(40, 5) === 'x')
ok('a clearly vertical gesture locks to y', swipeAxis(5, 40) === 'y')
ok('a diagonal locks to y, so a scroll never drags the calendar sideways',
   swipeAxis(40, 40) === 'y')

// ── the damped hint (§13) ───────────────────────────────────────────────────
ok('no movement, no hint', swipeHint(0) === 0)
ok('the hint follows the direction of the finger',
   swipeHint(left(80)) < 0 && swipeHint(right(80)) > 0)
ok('the hint is damped, never 1:1', Math.abs(swipeHint(80)) < 80)
ok('the hint keeps growing, just more slowly',
   swipeHint(200) > swipeHint(80) && swipeHint(200) - swipeHint(80) < 80)
ok('resistance increases with distance',
   swipeHint(160) - swipeHint(80) < swipeHint(80))
ok('the hint is clamped: a runaway drag cannot become a pager',
   swipeHint(100000) < SWIPE_HINT_MAX && swipeHint(-100000) > -SWIPE_HINT_MAX)
ok('at the committing distance the hint is visible but small', (() => {
  const h = Math.abs(swipeHint(SWIPE_DISTANCE))
  return h > 10 && h < 25
})())
ok('the hint is symmetric', swipeHint(90) === -swipeHint(-90))

// ── distance decides (the behaviour that already existed) ───────────────────
ok('a short slow drag does not navigate', nav(left(40), 0, 0.05) === STAY)
ok('a drag past the threshold navigates', nav(left(60), 0, 0.05) === NEXT)
ok('exactly at the threshold navigates', nav(left(SWIPE_DISTANCE), 0, 0) === NEXT)
ok('one pixel short does not', nav(left(SWIPE_DISTANCE - 1), 0, 0) === STAY)
ok('swiping right goes to the previous period', nav(right(60), 0, 0) === PREV)
ok('a slow crawl past the threshold still navigates (unchanged)',
   nav(left(60), 0, 0.04) === NEXT)

// ── velocity decides too (the point of G6) ──────────────────────────────────
ok('a fast flick navigates well below the distance threshold',
   nav(left(30), 0, -(SWIPE_FLICK + 0.2)) === NEXT && 30 < SWIPE_DISTANCE)
ok('a flick to the right goes to the previous period',
   nav(right(30), 0, SWIPE_FLICK + 0.2) === PREV)
ok('just under the flick speed still needs the distance',
   nav(left(30), 0, -(SWIPE_FLICK - 0.01)) === STAY)
ok('exactly at the flick speed navigates',
   nav(left(30), 0, -SWIPE_FLICK) === NEXT)

// ── direction beats both ────────────────────────────────────────────────────
ok('thrown back the other way, a drag past the threshold is kept',
   nav(left(80), 0, SWIPE_FLICK + 0.3) === STAY)
ok('...but a gentle hesitation on the way out does not save it',
   nav(left(80), 0, 0.05) === NEXT)
ok('a flick whose speed matches its direction is the one that counts',
   nav(left(30), 0, -1.5) === NEXT && nav(left(30), 0, 1.5) === STAY)

// ── vertical and diagonal never navigate ────────────────────────────────────
ok('a vertical drag never navigates', nav(0, 200, 0) === STAY)
ok('a fast vertical drag never navigates', nav(0, 200, 3) === STAY)
ok('a diagonal past the distance still fails the ratio guard',
   nav(left(60), 60, 0) === STAY)
ok('a fast diagonal fails it too', nav(left(60), 60, -2) === STAY)
ok('a mostly-horizontal diagonal does navigate', nav(left(80), 20, 0) === NEXT)

// ── out and back: the net delta is what is judged ───────────────────────────
ok('a drag out and back to the start does not navigate', nav(0, 0, 0) === STAY)
ok('...even when it is still moving fast at the release',
   nav(0, 0, 2) === STAY)
ok('a drag that returns most of the way does not navigate',
   nav(left(6), 0, 0.05) === STAY)

// ── malformed input cannot navigate ─────────────────────────────────────────
ok('NaN cannot navigate', nav(NaN, NaN, NaN) === STAY)
ok('a NaN velocity falls back to distance',
   shouldNavigate({ dx: left(60), dy: 0, velocity: NaN }) === NEXT)
ok('a missing velocity falls back to distance',
   shouldNavigate({ dx: left(60), dy: 0 }) === NEXT)

// ── velocity sampling, re-exported from sheetDrag (G5) ──────────────────────
ok('the sampling helpers are the ones G5 already tests',
   typeof trackSample === 'function' && typeof velocityFrom === 'function')
ok('two samples give the plain slope',
   velocityFrom([{ t: 0, y: 0 }, { t: 100, y: -50 }]) === -0.5)
ok('a single sample has no velocity', velocityFrom([{ t: 0, y: 0 }]) === 0)
ok('sampling drops what has aged out but always keeps a slope', (() => {
  let s = [{ t: 0, y: 0 }]
  for (let t = 16; t <= 400; t += 16) s = trackSample(s, { t, y: -t })
  return s.length >= 2 && velocityFrom(s) === -1
})())

// A real flick, sampled the way useSwipe samples it: the finger decelerates
// just before lifting, which a last-two-points reading would miss.
{
  const samples = [
    { t: 0, y: 0 }, { t: 16, y: -28 }, { t: 32, y: -55 }, { t: 48, y: -57 },
  ]
  const v = velocityFrom(samples)
  ok('a decelerating flick still reads as a flick', Math.abs(v) >= SWIPE_FLICK)
  ok('...and navigates on a distance that alone would not',
     nav(left(40), 0, v) === NEXT && nav(left(40), 0, 0) === STAY)
}

// A deliberate slow drag must not read as a flick.
{
  let s = [{ t: 0, y: 0 }]
  for (let i = 1; i <= 10; i++) s = trackSample(s, { t: i * 100, y: -i * 4 })
  const v = velocityFrom(s)
  ok('a slow drag is not a flick', Math.abs(v) < SWIPE_FLICK)
  ok('...so a short slow drag stays put', nav(left(40), 0, v) === STAY)
}

// ── cancel ──────────────────────────────────────────────────────────────────
// A cancelled touch never reaches the decision (useSwipe drops the gesture and
// releases the track), but the decision must be safe if it ever did.
ok('a cancelled gesture with no movement cannot navigate', nav(0, 0, 0) === STAY)

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'swipeLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/swipeLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
