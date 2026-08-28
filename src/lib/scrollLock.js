// Scroll lock for overlays (G14).
//
// Nothing stopped the page behind a sheet from scrolling: the backdrop is an
// ordinary div, so a wheel or touch that lands on it walks up the DOM to the
// nearest scrollable ancestor, which is the window. Measured on the five
// overlays that sit on a scrolling route, the page moved by up to 246px while
// the sheet stayed put — and the backdrop is only 60% opaque, so 19% of the
// screen visibly shifted behind it.
//
// `overflow: hidden` on `body` — not on `html`, and not on both — is what this
// app wants. Because `html` is `overflow: visible`, the body's overflow
// propagates to the viewport and stops the scroll, while the scroll offset
// itself is untouched: no save, no restore, no jump on close. Measured against
// the alternatives at scrollY 150 with a sheet open: this moves 0 elements and
// 0 pixels and keeps scrollY at 150, where `position: fixed` needs the offset
// restored by hand and setting `overflow: hidden` on `html` *and* `body`
// together resets the page to the top (135 of 235 elements jumped, worst 150px).
//
// The counting is pure so tools/overlayLogic.mjs can check it without a DOM —
// only `lockScroll`/`unlockScroll` touch the document.

/**
 * Refcount for nested overlays: a ConfirmDialog on top of an EventDetailSheet
 * holds two locks, and the page must stay locked until the second one goes.
 *
 * `acquire` reports whether this call is the one that should apply the lock,
 * `release` whether it is the one that should remove it — so the caller never
 * has to know how deep the stack is. Releasing more often than acquiring is
 * ignored rather than driving the count negative, which would silently leave
 * the page locked the next time an overlay opens.
 */
export function createLockCounter() {
  let held = 0
  return {
    acquire() {
      held += 1
      return held === 1
    },
    release() {
      if (held === 0) return false
      held -= 1
      return held === 0
    },
    size() {
      return held
    },
  }
}

/**
 * Width of the classic scrollbar, or 0 where the browser draws an overlay one
 * (macOS, iOS, and every headless Chromium — which is why this cannot be
 * verified in the test rig).
 */
export function scrollbarWidth() {
  return window.innerWidth - document.documentElement.clientWidth
}

const counter = createLockCounter()
let saved = null

/**
 * Hold the page still. Safe to call once per overlay; only the first call
 * touches the DOM.
 *
 * Hiding the overflow also removes a classic scrollbar, and `.app-frame` is
 * centred in the viewport — `x = (clientWidth - 430) / 2`, verified at three
 * widths — so losing an S-pixel scrollbar would slide the whole app S/2 to the
 * right. Padding the body by exactly S puts the content box back where it was.
 */
export function lockScroll() {
  if (!counter.acquire()) return
  const body = document.body
  saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
  const gap = scrollbarWidth()
  if (gap > 0) {
    const current = parseFloat(getComputedStyle(body).paddingRight) || 0
    body.style.paddingRight = `${current + gap}px`
  }
  body.style.overflow = 'hidden'
}

/** Release one hold; the last one restores the body's own inline styles. */
export function unlockScroll() {
  if (!counter.release()) return
  const body = document.body
  body.style.overflow = saved ? saved.overflow : ''
  body.style.paddingRight = saved ? saved.paddingRight : ''
  saved = null
}
