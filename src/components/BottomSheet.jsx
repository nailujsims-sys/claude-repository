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
export default function BottomSheet({
  open,
  onClose,
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
        open={open}
      >
        {children}
      </Panel>
    </Overlay>
  )
}

// Separate component so it can read the overlay phase from the context —
// useOverlayPanel only works below <Overlay>.
function Panel({ full, title, headerRight, onClose, children, open }) {
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
  const { panelRef, handleProps } = useSheetDrag({ open, onClose, enabled: !full })

  return (
    <div
      {...panel}
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
      <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  )
}
