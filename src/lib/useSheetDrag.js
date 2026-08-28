import { useEffect, useRef } from 'react'
import { DRAG_SLOP, dragOffset, shouldDismiss, trackSample, velocityFrom } from './sheetDrag'

// Drag-to-dismiss for the grabber-style bottom sheets (G5).
//
// The pointer half of the gesture, kept as thin as useTimedGesture.js: press,
// slop, pointer capture, commit on release, cancel on pointercancel. Every
// *decision* lives in sheetDrag.js, where it can be unit tested.
//
// The offset is written straight to the DOM as a custom property rather than
// held in React state. A sheet re-rendering its whole body on every pointermove
// is exactly the lag §6 forbids, and there is nothing else on screen that needs
// to know where the finger is — so `--ov-drag` on the panel is both the fastest
// and the smallest way to say it.
//
// What happens on release is deliberately *not* a second animation. Snapping
// back only removes the attribute, which hands the panel back to the phase rule
// it already had (`transform: none` while open); dismissing calls onDismiss and
// lets the existing G4 presence lifecycle run the exit. Either way the movement
// continues from wherever the finger left it, over the same 300ms and the same
// easing as an ordinary open or close — no new motion system, no new tokens.
export default function useSheetDrag({ panelRef, phase, onDismiss }) {
  const g = useRef(null) // live gesture state (never triggers a render)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  const paint = (offset) => {
    const el = panelRef.current
    if (!el) return
    el.style.setProperty('--ov-drag', `${offset}px`)
    el.dataset.drag = 'live'
  }

  const release = (mode) => {
    const el = panelRef.current
    if (!el) return
    if (mode === 'exit') {
      // Keep the offset: under prefers-reduced-motion the sheet fades out from
      // where the finger left it instead of travelling back first.
      el.dataset.drag = 'exit'
      return
    }
    delete el.dataset.drag
    el.style.removeProperty('--ov-drag')
  }

  // Anything that closes the sheet from outside the gesture — Escape, the
  // backdrop, a save — leaves the phase. An in-flight drag must not keep
  // painting over the exit it no longer owns.
  useEffect(() => {
    if (phase === 'open' || !g.current) return
    g.current = null
    release('cancel')
  }, [phase])

  const onPointerDown = (e) => {
    if (!e.isPrimary) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (phase !== 'open' || !panelRef.current) return

    g.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      height: panelRef.current.getBoundingClientRect().height,
      samples: [{ t: e.timeStamp, y: e.clientY }],
      offset: 0,
      dragging: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort — the same concession useTimedGesture makes */
    }
  }

  const onPointerMove = (e) => {
    const s = g.current
    if (!s || e.pointerId !== s.pointerId) return
    const delta = e.clientY - s.startY
    s.samples = trackSample(s.samples, { t: e.timeStamp, y: e.clientY })

    // Below the slop this is still a press, not a drag: nothing moves and a
    // release commits nothing.
    if (!s.dragging) {
      if (Math.abs(delta) < DRAG_SLOP) return
      s.dragging = true
    }
    s.offset = dragOffset(delta, s.height)
    paint(s.offset)
  }

  const finish = (commit) => {
    const s = g.current
    g.current = null
    if (!s || !s.dragging) return // a plain tap on the handle does nothing

    const dismiss =
      commit &&
      shouldDismiss({
        offset: s.offset,
        velocity: velocityFrom(s.samples),
        height: s.height,
      })

    if (dismiss) {
      release('exit')
      dismissRef.current?.()
    } else {
      release('cancel')
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
  }
}
