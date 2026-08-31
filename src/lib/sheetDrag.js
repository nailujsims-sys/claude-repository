// Drag-to-dismiss decisions for bottom sheets (G5).
//
// The grabber bar at the top of a sheet promised direct manipulation (§6) that
// the component never delivered: it was a decorative div. This module holds the
// three decisions the gesture needs, and nothing else —
//
//   • how far the sheet may travel *up*, where there is nothing to open into
//   • how fast the finger was moving when it let go
//   • whether that release dismisses the sheet or springs it back
//
// Pure on purpose — no React, no DOM — so tools/sheetLogic.mjs can check it,
// the same split src/lib/pressFeedback.js and src/lib/overlayPresence.js use.
// The DOM side lives in src/lib/useSheetDrag.js.

// The movement that turns a press into a drag. Deliberately the same 8px the
// rest of the app already treats as "the finger drifted" rather than "the user
// is moving something" (PRESS_SLOP in pressFeedback.js, TAP_SLOP in
// useTimedGesture.js), so a tap on the grabber stays a tap.
export const DRAG_SLOP = 8

// How far the sheet follows an upward pull. Downwards it tracks the finger 1:1
// because it is heading somewhere real; upwards there is nothing above the open
// position, so it resists instead of freezing (§13).
export const RUBBER_MAX = 40

// A release past this share of the sheet's own height dismisses. Proportional
// rather than a fixed distance: the action sheet is ~215px tall and the event
// detail ~645px, and "a quarter of the way down" reads the same on both.
export const DISMISS_RATIO = 0.25

// A flick that beats this speed decides on its own, in whichever direction it
// points: downwards it dismisses well short of the distance threshold, upwards
// it keeps the sheet even past it. px per ms.
export const FLICK_VELOCITY = 0.5

// Velocity is read over the last stretch of the gesture rather than from the
// final two points: those are a millisecond apart and mostly noise, and a
// finger is usually already slowing down as it lifts.
export const VELOCITY_WINDOW = 80

/**
 * Asymptotic resistance: the first pixels still follow the finger, the last
 * ones barely move, and the total never reaches `max`. Chosen over a linear
 * `delta / 3` because a linear damping still has a hard end — this one simply
 * runs out of travel, which is what a soft boundary feels like.
 */
export function rubberBand(distance, max = RUBBER_MAX) {
  if (!(distance > 0)) return 0
  return (max * distance) / (distance + max)
}

/** Finger travel → the offset the sheet is actually drawn at. */
export function dragOffset(delta, max = RUBBER_MAX) {
  return delta >= 0 ? delta : -rubberBand(-delta, max)
}

/**
 * px/ms over the last `window` ms of the gesture, positive = downwards.
 * Samples are `{ t, y }` in the order they arrived.
 */
export function releaseVelocity(samples, window = VELOCITY_WINDOW) {
  if (!samples || samples.length < 2) return 0
  const last = samples[samples.length - 1]
  // The oldest sample still inside the window; if every sample is older than
  // the window (the finger rested before lifting) the one before last is used,
  // which correctly reports "barely moving".
  let first = samples[samples.length - 2]
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > window) break
    first = samples[i]
  }
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.y - first.y) / dt
}

/**
 * The release decision. Direction wins over distance: a flick back up keeps the
 * sheet even when it was already dragged past the threshold, because that is
 * the user visibly changing their mind (§10, §19).
 */
export function shouldDismiss({ offset, velocity, height }) {
  if (velocity <= -FLICK_VELOCITY) return false
  if (velocity >= FLICK_VELOCITY) return true
  if (!(height > 0)) return false
  return offset >= height * DISMISS_RATIO
}
