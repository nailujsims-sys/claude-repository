import { useId } from 'react'
import { X } from 'lucide-react'
import IconButton from './IconButton'
import Overlay, { useOverlayPanel } from './Overlay'
import useSheetDrag from '../lib/useSheetDrag'

// Bottom sheet that slides up. Two variants:
//  - default: auto-height, rounded top, sits above the bottom nav (for the
//    action sheet and filter panel).
//  - full: covers the whole frame (for the Neue Aufgabe / Bearbeiten form),
//    with a header row (× / title / right action).
//
// Opening and closing are the same movement in two directions: the sheet is
// kept mounted for its exit and slides back down (see Overlay / G4).
//
// The grabber variant can also be pulled shut by hand (G5): the strip at the
// top — grabber plus title — is a drag handle, and the sheet follows the finger
// until it is either released far/fast enough to carry on out, or springs back.
// The full-screen form variant draws no grabber, promises no such gesture, and
// keeps its explicit × button.
//
// A sheet pulled shut this way can also be caught again on the way out (G16),
// but only if the caller passes `onReopen`: catching reopens the sheet for real
// rather than faking a phase, and only the owner of `open` can do that.
export default function BottomSheet({
  open,
  onClose,
  onReopen = null,
  title,
  full = false,
  headerRight = null,
  children,
}) {
  return (
    <Overlay open={open} onClose={onClose}>
      <Panel
        full={full}
        title={title}
        headerRight={headerRight}
        onClose={onClose}
        onReopen={onReopen}
        open={open}
      >
        {children}
      </Panel>
    </Overlay>
  )
}

// Separate component so it can read the overlay phase from the context —
// useOverlayPanel only works below <Overlay>.
function Panel({ full, title, headerRight, onClose, onReopen, children, open }) {
  // The sheet already draws its title; naming the dialog after it means a
  // screen reader announces the same words the eye reads, instead of "dialog".
  // Only wired up when there is a title — an unlabelled sheet is better than
  // one pointing at an element that was never rendered.
  const titleId = useId()
  const panel = useOverlayPanel(
    'ov-panel-sheet',
    full
      ? 'pointer-events-auto absolute inset-0 flex flex-col bg-bg-elevated'
      : 'pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-[20px] bg-bg-elevated border-t border-subtle max-h-[85%] flex flex-col'
  )
  const { panelRef, handleProps, catchable } = useSheetDrag({
    open,
    onClose,
    onReopen,
    enabled: !full,
  })

  return (
    <div
      {...panel}
      // While the sheet is catchable (G16) its *root* must not be `inert`: an
      // inert subtree ignores pointer input even where a descendant sets
      // `pointer-events: auto` (measured), so the handle would stay
      // unreachable. The attribute is not dropped, it moves — the body below
      // carries it for exactly that window, so G13's rule that a leaving panel
      // is never a Tab stop still holds. See the body for why that is enough.
      inert={catchable ? undefined : panel.inert}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      {full ? (
        <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-subtle">
          <IconButton
            onClick={onClose}
            className="-ml-1 text-text-secondary"
            aria-label="Schließen"
          >
            <X size={24} />
          </IconButton>
          <h2 id={titleId} className="text-[17px] font-semibold text-text-primary">
            {title}
          </h2>
          <div className="min-w-[24px] text-right">{headerRight}</div>
        </div>
      ) : (
        // Grabber and title are one drag handle: the visible bar stays the
        // small 36×4 strip it always was, while the area that answers a finger
        // covers the whole head of the sheet. The body is deliberately not part
        // of it — it scrolls, and one surface cannot be both (§12).
        <div className="ov-sheet-handle shrink-0" {...handleProps}>
          <div className="flex justify-center pt-3 pb-1">
            <div className="ov-sheet-grabber h-1 w-9 rounded-full bg-white/15" />
          </div>
          {title && (
            <h2
              id={titleId}
              className="px-5 pb-2 text-[17px] font-semibold text-text-primary"
            >
              {title}
            </h2>
          )}
        </div>
      )}
      {/* The catch window (G16) is the one moment the panel root cannot carry
          `inert`, so the body carries it instead — and that is enough, because
          every focusable element of a grabber sheet is in here: the handle
          strip above holds only the grabber and the heading, neither of them a
          Tab stop. `focusableWithin` filters on `closest('[inert]')`, so the
          focus trap and the browser's own tab order agree on skipping it, and
          the `aria-labelledby` heading stays outside, so the dialog keeps its
          accessible name. Outside the catch window this is `undefined` and
          nothing about the sheet changes. */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        inert={catchable ? '' : undefined}
      >
        {children}
      </div>
    </div>
  )
}
