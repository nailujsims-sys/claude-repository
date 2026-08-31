import { useCallback, useEffect, useRef } from 'react'
import { DRAG_SLOP, dragOffset, releaseVelocity, shouldDismiss } from './sheetDrag'

// The pointer side of drag-to-dismiss (G5). The decisions live in
// src/lib/sheetDrag.js; this file only turns pointer movement into an offset
// and hands the result back to the motion that already exists.
//
// It adds no animation of its own. G4 left every sheet on a single CSS
// transition (`.ov-panel-sheet`, 300ms, cubic-bezier(0.16, 1, 0.3, 1)) that
// interpolates from whatever is currently on screen, so:
//
//   during the drag   `data-drag="live"` + `--ov-drag`  (transition off, 1:1)
//   snap back         both removed → the transition carries the panel from
//                     where the finger left it back to `transform: none`
//   dismiss           `data-drag="exit"` + onClose() → the same transition
//                     continues downwards while the presence machine unmounts
//
// So closing by drag and closing by backdrop end on the same path, at the same
// duration and easing. Overlay.jsx and overlayPresence.js are untouched.
//
// The gesture state is a ref, never state: a drag paints ~60 frames a second
// and none of them need React (the same reason useTimedGesture.js keeps its
// live gesture in a ref).

const DRAG_ATTR = 'data-drag'
const GRAB_ATTR = 'data-grab'
const DRAG_VAR = '--ov-drag'

// What the panel is *currently* showing, in px from its open position. Read at
// the moment the drag engages rather than assumed to be 0, so grabbing a sheet
// that is still sliding up continues from the visible state instead of jumping
// to the logical one (§7). `transform: none` — the open state — parses to 0.
export function currentOffset(el) {
  if (!el) return 0
  const value = getComputedStyle(el).transform
  if (!value || value === 'none') return 0
  try {
    const Matrix = globalThis.DOMMatrixReadOnly || globalThis.WebKitCSSMatrix
    if (!Matrix) return 0
    return new Matrix(value).m42 || 0
  } catch {
    return 0
  }
}

/**
 * @param open    the sheet's own `open` flag — a reopen must never inherit a
 *                stale drag (see the reset effect below)
 * @param onClose committed on release past the threshold; the same callback
 *                the backdrop and Escape already use
 * @param enabled false for the full-screen form sheets, which draw no grabber
 *                and therefore promise nothing
 */
export default function useSheetDrag({ open, onClose, enabled = true }) {
  const panelRef = useRef(null)
  const g = useRef(null) // live gesture — never triggers a render
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const paint = useCallback((offset) => {
    const el = panelRef.current
    if (!el) return
    el.style.setProperty(DRAG_VAR, `${offset}px`)
    el.setAttribute(DRAG_ATTR, 'live')
  }, [])

  // Back to the untouched panel: no attribute, no custom property, and — the
  // invariant G4 established — `transform: none` rather than `translateY(0)`.
  // Any transform value would create a containing block and re-anchor the
  // `position: fixed` ConfirmDialog that EventDetailSheet renders inside itself.
  const clearDrag = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    el.removeAttribute(DRAG_ATTR)
    el.style.removeProperty(DRAG_VAR)
  }, [])

  const setGrabbed = useCallback((on, node) => {
    const el = node || g.current?.handle
    if (!el) return
    if (on) el.setAttribute(GRAB_ATTR, '')
    else el.removeAttribute(GRAB_ATTR)
  }, [])

  // Reopening while the sheet is still exiting keeps the same element (G4's
  // `exiting + open → open` edge), so a dismissal's `data-drag="exit"` would
  // still be on it and would pin the reopened sheet off-screen. Clearing on
  // every open also covers the odd case of the sheet being closed from
  // elsewhere — Escape, say — while a finger is still down.
  useEffect(() => {
    if (open) {
      clearDrag()
      return
    }
    const s = g.current
    if (s?.dragging) {
      g.current = null
      setGrabbed(false, s.handle)
      clearDrag()
    }
  }, [open, clearDrag, setGrabbed])

  const finish = useCallback(
    (commit, e) => {
      const s = g.current
      g.current = null
      if (!s) return
      setGrabbed(false, s.handle)

      // Never engaged: the press was a tap (or a scroll attempt). Nothing was
      // painted, so there is nothing to undo and nothing to commit — the tap
      // reaches whatever it was on, exactly as before.
      if (!s.dragging) return

      const el = panelRef.current
      if (!commit || !el) {
        clearDrag() // pointercancel — treat it as "the user let go up here"
        return
      }

      const velocity = releaseVelocity(s.samples)
      const height = el.getBoundingClientRect().height
      if (shouldDismiss({ offset: s.offset, velocity, height })) {
        // Hand the movement over without interrupting it: dropping the custom
        // property while switching to `exit` retargets the same transition to
        // the closed position, so the sheet carries on from where the finger
        // was. The attribute matters under prefers-reduced-motion, where the
        // panel's resting transform is `none` — without it the sheet would
        // jump back up before fading out.
        el.style.removeProperty(DRAG_VAR)
        el.setAttribute(DRAG_ATTR, 'exit')
        closeRef.current?.()
      } else {
        clearDrag()
      }
    },
    [clearDrag, setGrabbed]
  )

  const onPointerDown = useCallback(
    (e) => {
      if (!enabled || !panelRef.current) return
      // Secondary touches and right/middle mouse buttons never drag anything —
      // the rule pressFeedback.js already applies to presses.
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const handle = e.currentTarget
      g.current = {
        id: e.pointerId,
        handle,
        startY: e.clientY,
        originY: e.clientY,
        originOffset: 0,
        offset: 0,
        dragging: false,
        samples: [{ t: e.timeStamp, y: e.clientY }],
      }
      // Feedback on pointer *down* (§5) — but only on the grabber's colour.
      // Nothing geometric happens yet: the panel keeps `transform: none` until
      // the gesture actually engages, so a press that turns out to be a tap
      // never creates a containing block.
      setGrabbed(true, handle)
      try {
        handle.setPointerCapture(e.pointerId)
      } catch {
        /* capture is best-effort — same as useTimedGesture.js */
      }
    },
    [enabled, setGrabbed]
  )

  const onPointerMove = useCallback(
    (e) => {
      const s = g.current
      if (!s || e.pointerId !== s.id) return
      s.samples.push({ t: e.timeStamp, y: e.clientY })
      if (s.samples.length > 12) s.samples.shift()

      if (!s.dragging) {
        if (Math.abs(e.clientY - s.startY) <= DRAG_SLOP) return
        s.dragging = true
        // Engage from here, not from the press: taking the origin at the
        // moment the slop is crossed means the sheet starts moving from where
        // it is instead of teleporting the 8px the threshold swallowed.
        s.originY = e.clientY
        s.originOffset = currentOffset(panelRef.current)
      }
      s.offset = dragOffset(s.originOffset + e.clientY - s.originY)
      paint(s.offset)
    },
    [paint]
  )

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e) => finish(true, e),
    onPointerCancel: (e) => finish(false, e),
  }

  return { panelRef, handleProps: enabled ? handleProps : {} }
}
