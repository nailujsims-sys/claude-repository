// Focus scope decisions for overlays (G13).
//
// An overlay used to leave the focus wherever it was: opening one never moved
// it, Tab walked straight out of the panel into the page behind, and closing
// dropped it on <body> — while `aria-modal="true"` was already promising
// assistive technology that the background was unreachable.
//
// This module holds the three decisions that fixes, and nothing else —
//
//   • where the focus goes when a panel opens
//   • which element Tab must wrap to, and when the browser may be left alone
//   • whether closing may hand the focus back, or whether something else has
//     taken it over in the meantime
//
// Pure on purpose — no React, no DOM — so tools/focusLogic.mjs can check it,
// the same split src/lib/overlayPresence.js and src/lib/sheetDrag.js use. The
// DOM side lives in src/components/Overlay.jsx.
//
// `elements` is always the ordered list of focusable elements inside the
// active overlay; the functions never look at anything else, so the tests can
// feed them plain strings.

// What counts as focusable. `[tabindex="-1"]` is deliberately out: it is
// focusable by script (the overlay root itself uses it as a last resort) but
// never by Tab, so including it would make the trap wrap to elements the
// browser would have skipped.
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Where the focus goes when a panel opens.
 *
 * `null` means "leave it alone": either the panel brought its own focus with it
 * — the Neue-Aufgabe and Neuer-Termin sheets autofocus their title field, and
 * overruling that would be worse than doing nothing — or there is nothing
 * focusable at all, in which case the caller focuses the overlay root itself so
 * the scope still has somewhere to stand.
 */
export function initialFocus({ elements, focusAlreadyInside = false }) {
  if (focusAlreadyInside) return null
  if (!elements || elements.length === 0) return null
  return elements[0]
}

/**
 * Where Tab must move the focus, or `null` to let the browser do it.
 *
 * Only the two edges are claimed. Tabbing from the third to the fourth button
 * of a sheet is the browser's job and it does it better — it knows about radio
 * groups, about a text field's own internal stops, about the platform's
 * conventions. The trap only steps in where the browser would leave the scope:
 *
 *   • at the last element going forward → back to the first
 *   • at the first element going backward → around to the last
 *   • focus outside the scope entirely → pull it back to the near end
 *
 * That last case is what catches a focus that escaped before the trap existed
 * — after `inert` dropped it on <body>, say.
 */
export function nextFocus({ elements, current, backwards = false }) {
  if (!elements || elements.length === 0) return null
  const i = current == null ? -1 : elements.indexOf(current)
  if (i === -1) return backwards ? elements[elements.length - 1] : elements[0]
  if (backwards) return i === 0 ? elements[elements.length - 1] : null
  return i === elements.length - 1 ? elements[0] : null
}

/**
 * May the closing overlay hand the focus back to whatever had it before?
 *
 * Only if nothing else has claimed it in the meantime. Two situations mean
 * "still ours": the focus is inside the panel that is going away, or it has
 * already fallen to <body> — which is exactly what happens when the panel is
 * removed, and what `inert` does to a panel on its way out.
 *
 * Anything else means a different surface is now focused and must keep the
 * focus. That is the EventDetailSheet → "Bearbeiten" → EventForm case: the
 * sheet closes and the form opens in the same breath, and the form has already
 * placed the focus by the time the sheet unmounts. Restoring here would take it
 * off the form and put it back on a calendar entry behind two overlays.
 *
 * A target that has since left the document cannot be focused at all — the
 * task row that was the trigger may well have been deleted by the sheet.
 */
export function shouldRestore({ activeInsideRoot, activeIsBody, targetConnected }) {
  if (!targetConnected) return false
  return !!(activeInsideRoot || activeIsBody)
}
