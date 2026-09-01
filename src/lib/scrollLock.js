// Document scroll lock for modal overlays (G14).
//
// The page behind an open sheet still scrolled. Which scroller actually moved
// is less obvious than it looks: `.ov-root` is `fixed inset-0` and the backdrop
// covers the whole viewport, so every wheel, touch and key lands on the
// backdrop — and a scroll gesture walks the *DOM ancestor* chain from there
// (backdrop → .ov-root → .app-frame → body → document), not what happens to be
// visible behind the panel. So it was always the document that scrolled, on
// every screen and with every input device, and one lock at document level is
// the whole fix. The calendar, whose views scroll inside their own containers,
// never scrolled behind a sheet in the first place: those containers are not
// ancestors of the backdrop.
//
// Deliberately *not* gesture-based. A `touchmove` handler with preventDefault,
// or a global `touch-action: none`, would take the events G5's drag-to-dismiss,
// the sheet's own scrolling body and the calendar's swipe all depend on. The
// lock is one attribute on <html> and one CSS rule (see src/index.css).
//
// The counting half is pure so tools/overlayLogic.mjs can check the balance —
// the same split src/lib/overlayPresence.js and src/lib/sheetDrag.js use.

export const LOCK_ATTR = 'data-ov-scroll-locked'

/**
 * A counted lock: the first holder locks, the last one to let go unlocks.
 *
 * Counting rather than a boolean because overlays stack — a ConfirmDialog over
 * an EventDetailSheet holds it twice — and because each holder releases
 * independently and not necessarily in the order it acquired. `acquire` hands
 * back its own release function, which is idempotent: a release called twice
 * (React running an effect cleanup after the holder is already gone) must not
 * push the count below what is actually held.
 */
export function createScrollLock(apply) {
  let count = 0
  return {
    acquire() {
      count += 1
      if (count === 1) apply(true)
      let released = false
      return () => {
        if (released) return
        released = true
        count -= 1
        if (count === 0) apply(false)
      }
    },
    count: () => count,
    locked: () => count > 0,
  }
}

export const scrollLock = createScrollLock((locked) => {
  const el = globalThis.document?.documentElement
  if (!el) return
  if (locked) el.setAttribute(LOCK_ATTR, '')
  else el.removeAttribute(LOCK_ATTR)
})
