// Pure-logic tests for the sheet drag-to-dismiss gesture (G5).
// The React/DOM plumbing in src/lib/useSheetDrag.js is deliberately thin — the
// decisions ("has this moved far enough?", "was that a flick?", "how far does
// it rubber-band?") live in exported pure functions, so they can be checked
// here without a browser. Bundled with esbuild like the other logic tests.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  DISMISS_RATIO, MIN_DISMISS_PX, MAX_DISMISS_PX,
  FLICK_VELOCITY, DRAG_SLOP, VELOCITY_WINDOW, RUBBER_BAND_C,
  dismissDistance, rubberBand, dragOffset, trackSample, velocityFrom, shouldDismiss,
} from './src/lib/sheetDrag.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps

// A representative pair: the "Erstellen" action sheet is short, an event detail
// sheet is tall. Both must feel like the same gesture.
const SHORT = 214
const TALL = 620

// ── the distance threshold ──────────────────────────────────────────────────
ok('the threshold is proportional to the sheet',
   dismissDistance(300) === 300 * DISMISS_RATIO)
ok('a short sheet never dismisses on less than a deliberate pull',
   dismissDistance(60) === MIN_DISMISS_PX && 60 * DISMISS_RATIO < MIN_DISMISS_PX)
ok('a tall sheet never demands more than one thumb travel',
   dismissDistance(3000) === MAX_DISMISS_PX && 3000 * DISMISS_RATIO > MAX_DISMISS_PX)
ok('the threshold is always inside its own bounds',
   [0, 50, 214, 620, 5000].every((h) => {
     const d = dismissDistance(h)
     return d >= MIN_DISMISS_PX && d <= MAX_DISMISS_PX
   }))
ok('the threshold grows with the sheet inside the bounds',
   dismissDistance(SHORT) < dismissDistance(450))

// ── rubber-banding against the open position (§13) ──────────────────────────
ok('no pull, no give', rubberBand(0, SHORT) === 0)
ok('a pull gives less than it asks for', rubberBand(100, SHORT) < 100)
ok('the give keeps growing, just more slowly',
   rubberBand(300, SHORT) > rubberBand(100, SHORT))
ok('resistance increases: the second 100px give less than the first',
   rubberBand(200, SHORT) - rubberBand(100, SHORT) < rubberBand(100, SHORT))
ok('the boundary is soft but never opens',
   rubberBand(100000, SHORT) < SHORT)
ok('the curve matches the documented constant',
   near(rubberBand(100, SHORT), (1 - 1 / ((100 * RUBBER_BAND_C) / SHORT + 1)) * SHORT))
ok('a taller sheet gives more for the same pull',
   rubberBand(100, TALL) > rubberBand(100, SHORT))
ok('a degenerate height cannot produce NaN',
   rubberBand(100, 0) === 0 && rubberBand(-5, SHORT) === 0)

// ── offset: free downward, banded upward ────────────────────────────────────
ok('downward tracks the finger exactly (§6)',
   dragOffset(0, SHORT) === 0 && dragOffset(37, SHORT) === 37 && dragOffset(500, SHORT) === 500)
ok('upward is resisted, not blocked',
   dragOffset(-100, SHORT) < 0 && dragOffset(-100, SHORT) > -100)
ok('upward never passes the sheet height',
   dragOffset(-100000, SHORT) > -SHORT)
ok('the offset is continuous through zero',
   near(dragOffset(-0.01, SHORT), 0, 0.02) && dragOffset(0.01, SHORT) === 0.01)

// ── velocity sampling ───────────────────────────────────────────────────────
ok('a single sample has no velocity', velocityFrom([{ t: 0, y: 0 }]) === 0)
ok('no samples at all is harmless', velocityFrom([]) === 0 && velocityFrom(null) === 0)
ok('two samples give the plain slope',
   velocityFrom([{ t: 0, y: 0 }, { t: 100, y: 50 }]) === 0.5)
ok('downward is positive, upward negative',
   velocityFrom([{ t: 0, y: 100 }, { t: 50, y: 0 }]) === -2)
ok('a repeated timestamp cannot divide by zero',
   velocityFrom([{ t: 10, y: 0 }, { t: 10, y: 40 }]) === 0)

// The point of the window: a finger that threw the sheet and then rested for a
// moment before lifting must still read as a throw, not as a stop.
{
  const thrown = [
    { t: 0, y: 0 }, { t: 16, y: 30 }, { t: 32, y: 60 }, { t: 48, y: 90 },
  ]
  ok('a consistent throw reads as a flick', velocityFrom(thrown) >= FLICK_VELOCITY)
}
{
  // Deceleration at the very end would fool a last-two-points reading.
  const decelerating = [
    { t: 0, y: 0 }, { t: 16, y: 40 }, { t: 32, y: 78 }, { t: 48, y: 80 },
  ]
  const lastPair = velocityFrom([{ t: 32, y: 78 }, { t: 48, y: 80 }])
  ok('the window survives a decelerating tail that the final pair would miss',
     lastPair < FLICK_VELOCITY && velocityFrom(decelerating) > lastPair)
}

// ── sample tracking ─────────────────────────────────────────────────────────
ok('tracking appends without mutating the input', (() => {
  const before = [{ t: 0, y: 0 }]
  const after = trackSample(before, { t: 16, y: 10 })
  return before.length === 1 && after.length === 2
})())
ok('samples older than the window are dropped', (() => {
  let s = []
  for (let t = 0; t <= 400; t += 16) s = trackSample(s, { t, y: t })
  return s[0].t >= 400 - VELOCITY_WINDOW - 16 && s.length < 26
})())
ok('one sample older than the window is kept, so a slow finger still has a slope',
   (() => {
     let s = [{ t: 0, y: 0 }]
     s = trackSample(s, { t: 500, y: 50 })
     return s.length === 2 && velocityFrom(s) === 0.1
   })())
ok('tracking never drops below two samples', (() => {
  let s = [{ t: 0, y: 0 }]
  s = trackSample(s, { t: 9999, y: 1 })
  return s.length === 2
})())

// ── the release decision ────────────────────────────────────────────────────
const drag = (offset, velocity, height = SHORT) => shouldDismiss({ offset, velocity, height })

ok('a short slow drag snaps back', drag(20, 0.05) === false)
ok('a drag that never left the slop snaps back', drag(DRAG_SLOP - 1, 0) === false)
ok('a slow drag past the threshold dismisses',
   drag(dismissDistance(SHORT) + 1, 0.05) === true)
ok('a slow drag one pixel short of the threshold snaps back',
   drag(dismissDistance(SHORT) - 1, 0.05) === false)
ok('exactly at the threshold dismisses', drag(dismissDistance(SHORT), 0) === true)

ok('a fast flick dismisses well below the distance threshold',
   drag(24, FLICK_VELOCITY + 0.1) === true && 24 < dismissDistance(SHORT))
ok('a flick just under the velocity threshold still needs the distance',
   drag(24, FLICK_VELOCITY - 0.01) === false)

// Direction beats distance both ways: this is what makes the gesture feel like
// an object rather than a scored quiz.
ok('an upward drag never dismisses', drag(-80, 0.9) === false)
ok('an upward drag with upward velocity never dismisses', drag(-80, -2) === false)
ok('zero offset never dismisses', drag(0, 5) === false)
ok('pulling back up fast keeps a sheet already past the threshold',
   drag(dismissDistance(SHORT) + 40, -(FLICK_VELOCITY + 0.1)) === false)
ok('...but a gentle hesitation on the way down does not save it',
   drag(dismissDistance(SHORT) + 40, -0.1) === true)

ok('the tall sheet uses its own threshold', (() => {
  const between = (dismissDistance(SHORT) + dismissDistance(TALL)) / 2
  return drag(between, 0, SHORT) === true && drag(between, 0, TALL) === false
})())

// A cancelled pointer never reaches the decision at all (useSheetDrag calls
// finish(false)), but the decision must be safe if it ever did.
ok('nonsense input cannot dismiss', drag(NaN, NaN) === false)

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'sheetDragLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/sheetDragLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
