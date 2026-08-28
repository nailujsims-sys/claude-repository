// Drag-to-dismiss decision logic for bottom sheets (G5).
//
// `BottomSheet` drew a grabber bar that promised direct manipulation and did
// nothing — §6 asks that a sheet the user can grab actually follows the finger,
// §13 that its boundary feels physical rather than frozen. This module holds
// the part of that gesture that is a *decision* rather than plumbing: how far
// the sheet has moved, whether the release dismisses it or snaps it back.
//
// Pure on purpose — no React, no DOM — so tools/sheetDragLogic.mjs can check it,
// exactly as overlayPresence.js and pressFeedback.js are checked.

// A downward drag past this fraction of the sheet's own height dismisses it.
// Proportional rather than absolute: pulling the small "Erstellen" sheet a
// third of the way down is the same *gesture* as pulling a tall detail sheet a
// third of the way down, even though the pixel counts differ.
export const DISMISS_RATIO = 0.3
// ...but never on less than a deliberate pull — a short sheet must not fall
// out of the screen on a twitch —
export const MIN_DISMISS_PX = 56
// ...and never demanding more than one comfortable thumb travel on a tall one.
export const MAX_DISMISS_PX = 140

// A flick, in px per millisecond (600 px/s). Downward at this speed dismisses
// whatever the distance; upward at this speed keeps the sheet whatever the
// distance, because the user is visibly pulling it back.
export const FLICK_VELOCITY = 0.6

// Movement needed before a press on the handle becomes a drag. The value
// useTimedGesture.js already uses to tell a drag from a tap, so a tap on the
// title behaves the same here as it does on a calendar event.
export const DRAG_SLOP = 6

// Velocity is read over the last samples inside this window rather than from
// the final two points: a single pointermove pair is noise, and at the end of a
// gesture the finger is usually already decelerating, which would read every
// deliberate throw as a slow drag.
export const VELOCITY_WINDOW = 100

// Rubber-band strength for dragging *up*, past the open position. Apple's
// UIScrollView resistance curve: the offset approaches the sheet's own height
// asymptotically, so the boundary gives a little but never disappears.
export const RUBBER_BAND_C = 0.55

/** How far this particular sheet has to travel down before a release dismisses it. */
export function dismissDistance(height) {
  const proportional = height * DISMISS_RATIO
  return Math.min(MAX_DISMISS_PX, Math.max(MIN_DISMISS_PX, proportional))
}

/**
 * Diminishing returns against a hard edge: the first pixels move almost freely,
 * further pulling moves less and less. `distance` and the result are magnitudes.
 */
export function rubberBand(distance, dimension, c = RUBBER_BAND_C) {
  if (!(distance > 0) || !(dimension > 0)) return 0
  return (1 - 1 / ((distance * c) / dimension + 1)) * dimension
}

/**
 * The offset to paint for a raw finger delta.
 *
 * Downward is free movement toward the sheet's own natural exit, so it tracks
 * 1:1 (§6 — the sheet must not lag behind or lead the finger). Upward runs into
 * a boundary the sheet cannot pass, so it rubber-bands (§13).
 */
export function dragOffset(delta, height) {
  if (delta >= 0) return delta
  return -rubberBand(-delta, height)
}

/**
 * Appends a sample and drops the ones that have aged out, keeping exactly one
 * sample older than the window so a slow finger still has two points to make a
 * slope from.
 */
export function trackSample(samples, sample, window = VELOCITY_WINDOW) {
  const next = samples.concat(sample)
  while (next.length > 2 && sample.t - next[1].t > window) next.shift()
  return next
}

/** Signed px/ms over the tracked window. Positive is downward. */
export function velocityFrom(samples, window = VELOCITY_WINDOW) {
  if (!samples || samples.length < 2) return 0
  const last = samples[samples.length - 1]
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
 * Distance *or* velocity, which is what makes the gesture feel physical: a
 * slow, deliberate pull past the threshold lets go, and so does a short fast
 * flick that never got that far — while a fast pull back up keeps the sheet
 * even if it had already travelled past the threshold on the way.
 */
export function shouldDismiss({ offset, velocity, height }) {
  if (offset <= 0) return false // an upward drag never dismisses
  if (velocity >= FLICK_VELOCITY) return true
  if (velocity <= -FLICK_VELOCITY) return false
  return offset >= dismissDistance(height)
}
