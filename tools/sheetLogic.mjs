// Pure-logic tests for the sheet drag-to-dismiss decisions (G5).
// The DOM plumbing in src/lib/useSheetDrag.js is deliberately thin — the
// decisions ("how far does it resist?", "how fast was that?", "does this
// release close the sheet?") live in exported pure functions, so they can be
// checked here without a browser. Bundled with esbuild like overlayLogic.mjs.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  DRAG_SLOP, RUBBER_MAX, DISMISS_RATIO, FLICK_VELOCITY, VELOCITY_WINDOW,
  rubberBand, dragOffset, releaseVelocity, shouldDismiss,
} from './src/lib/sheetDrag.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name) } }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// The real sheets, so the thresholds are checked against the sizes they will
// actually meet (measured at 390×844: action sheet, event detail, full form).
const ACTION = 215, DETAIL = 645, FULL = 844

// ── constants stay the ones the design decisions named ──────────────────────
ok('slop matches the app-wide 8px', DRAG_SLOP === 8)
ok('rubber band is capped at 40px', RUBBER_MAX === 40)
ok('threshold is a quarter of the sheet', DISMISS_RATIO === 0.25)
ok('flick speed is 0.5 px/ms', FLICK_VELOCITY === 0.5)
ok('velocity window is 80ms', VELOCITY_WINDOW === 80)

// ── rubber band (§13): resists, never freezes, never runs away ──────────────
ok('no resistance without a pull', rubberBand(0) === 0)
ok('a negative pull cannot produce travel', rubberBand(-50) === 0)
ok('the first pixel still follows the finger closely', rubberBand(1) > 0.9)
ok('it keeps moving at every distance', rubberBand(1000) > rubberBand(500))
ok('it never reaches the cap', rubberBand(1e6) < RUBBER_MAX)
ok('half the travel is spent at the cap distance', near(rubberBand(RUBBER_MAX), RUBBER_MAX / 2))
{
  let monotone = true, damped = true, prev = 0
  for (let d = 1; d <= 2000; d++) {
    const v = rubberBand(d)
    if (v < prev) monotone = false
    if (v > d || v >= RUBBER_MAX) damped = false
    prev = v
  }
  ok('resistance is monotone over the whole range', monotone)
  ok('resistance never exceeds the finger or the cap', damped)
}

// ── dragOffset: 1:1 downwards, damped upwards ───────────────────────────────
ok('downward travel is untouched', dragOffset(0) === 0 && dragOffset(137) === 137)
ok('a 1000px pull down is still 1:1 (§6)', dragOffset(1000) === 1000)
ok('upward travel is negative and damped', dragOffset(-100) < 0 && dragOffset(-100) > -RUBBER_MAX)
ok('upward travel is the mirrored rubber band', near(dragOffset(-100), -rubberBand(100)))
ok('a huge upward pull stays inside the cap', dragOffset(-1e6) > -RUBBER_MAX)

// ── velocity: px/ms over the tail of the gesture, + is downwards ────────────
ok('nothing to measure without samples', releaseVelocity([]) === 0 && releaseVelocity([{ t: 0, y: 0 }]) === 0)
ok('a zero-length window cannot divide', releaseVelocity([{ t: 5, y: 0 }, { t: 5, y: 40 }]) === 0)
ok('steady downward motion reads positive',
   near(releaseVelocity([{ t: 0, y: 0 }, { t: 20, y: 20 }, { t: 40, y: 40 }]), 1))
ok('upward motion reads negative',
   near(releaseVelocity([{ t: 0, y: 100 }, { t: 40, y: 60 }]), -1))
// The point of the window: a fast swipe that ends in a pause is a *stopped*
// finger, and must not be reported as a flick.
ok('samples older than the window are ignored',
   near(releaseVelocity([{ t: 0, y: 0 }, { t: 100, y: 300 }, { t: 160, y: 306 }]), 0.1))
ok('a long rest before lifting reads as barely moving',
   releaseVelocity([{ t: 0, y: 0 }, { t: 500, y: 400 }, { t: 900, y: 401 }]) < 0.01)
ok('the window keeps every sample of a short gesture',
   near(releaseVelocity([{ t: 0, y: 0 }, { t: 30, y: 30 }, { t: 60, y: 60 }]), 1))

// ── the release decision ────────────────────────────────────────────────────
const release = (offset, velocity, height = DETAIL) => shouldDismiss({ offset, velocity, height })

ok('a short slow drag springs back', release(40, 0) === false)
ok('a drag past a quarter of the sheet dismisses', release(DETAIL * 0.25 + 1, 0) === true)
ok('exactly at the threshold dismisses', release(DETAIL * 0.25, 0) === true)
ok('just under the threshold does not', release(DETAIL * 0.25 - 1, 0) === false)
ok('the threshold follows the sheet, not a fixed distance',
   release(60, 0, ACTION) === true && release(60, 0, DETAIL) === false)
ok('a full-height sheet needs the same quarter', release(FULL * 0.25, 0, FULL) === true)

// §10 — the flick decides on its own, in both directions.
ok('a fast downward flick dismisses from almost nowhere', release(12, 0.6) === true)
ok('exactly at flick speed counts', release(12, FLICK_VELOCITY) === true)
ok('just under flick speed does not', release(12, FLICK_VELOCITY - 0.01) === false)
ok('a slow drag at a small offset springs back', release(12, 0.1) === false)
ok('an upward flick keeps the sheet even past the threshold',
   release(DETAIL * 0.5, -0.6) === false)
ok('upward speed never dismisses, however small the offset', release(4, -2) === false)
ok('a slow upward drift still dismisses on distance alone',
   release(DETAIL * 0.5, -0.1) === true)

// Rubber-banded upward positions are negative offsets — they must never close.
ok('a rubber-banded sheet does not dismiss', release(dragOffset(-200), 0) === false)
ok('...not even with a downward flick already under way', release(dragOffset(-200), 0.6) === true)

// Defensive: a height of 0 (a panel measured before layout) must not close
// everything by accident.
ok('an unmeasurable sheet never dismisses on distance', release(10, 0, 0) === false)

console.log(\`  \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'sheetLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/sheetLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
