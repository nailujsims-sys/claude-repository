// Focus containment for overlays (G13).
//
// `BottomSheet` and `ConfirmDialog` have always declared
// `role="dialog" aria-modal="true"`, which promises that everything outside the
// panel is inert. Tab did not keep that promise: it walked straight out of the
// panel into the page behind, where a control could be activated invisibly —
// with the filter sheet open, two Tabs and Enter switched the task category
// underneath it.
//
// The decision of where focus should go is pure, so tools/overlayLogic.mjs can
// check it without a DOM. Only `focusablesIn` touches the document.

// Deliberately not `[tabindex]:not([tabindex='-1'])` alone: the panel container
// itself carries `tabindex="-1"` so it can receive the initial focus without
// joining the tab order, and it must never appear in its own focusable list.
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * The focusable elements inside `root`, in tab order.
 *
 * Skips anything with no box (a collapsed picker, a `hidden` branch) and
 * anything inside an `inert` subtree — which is how an overlay on its way out
 * is marked, so a closing ConfirmDialog's buttons do not linger in the list of
 * the sheet underneath it while it fades.
 */
export function focusablesIn(root) {
  if (!root) return []
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return false
    return !el.closest('[inert]')
  })
}

/**
 * Where Tab should land, given where it currently is.
 *
 *   count    — how many focusable elements the panel holds
 *   index    — position of the focused element in that list, -1 if it is not
 *              in the list (the container itself, or focus that got out)
 *   onPanel  — the panel container itself has focus
 *   shiftKey — Tab is going backwards
 *
 * Returns 'first' | 'last' | 'panel' to redirect focus there (the key event
 * must then be suppressed), or null to let the browser do its normal thing —
 * which is the common case, so a trap costs nothing while moving through a
 * panel's middle.
 */
export function wrapTab({ count, index, onPanel = false, shiftKey = false }) {
  // Nothing to move between: hold the container so focus cannot leave at all.
  if (count === 0) return 'panel'

  if (shiftKey) {
    // Backwards off the first element — or out of the container, which sits
    // before everything inside it — wraps to the end.
    return onPanel || index <= 0 ? 'last' : null
  }

  // Forwards from the container needs no help: the first focusable inside it
  // is also the browser's next stop.
  if (onPanel) return null
  return index === -1 || index === count - 1 ? 'first' : null
}
