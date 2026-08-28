import { useRef } from 'react'
import { X } from 'lucide-react'
import IconButton from './IconButton'
import Overlay, { useOverlayPanel } from './Overlay'
import useSheetDrag from '../lib/useSheetDrag'

// Bottom sheet that slides up. Two variants:
//  - default: auto-height, rounded top, sits above the bottom nav (for the
//    action sheet and filter panel). Its grabber and title are a drag handle:
//    pull the sheet down to dismiss it (G5).
//  - full: covers the whole frame (for the Neue Aufgabe / Bearbeiten form),
//    with a header row (× / title / right action). Deliberately no grabber and
//    no drag — a form is dismissed through its × button, and nothing in that
//    header promises otherwise.
//
// Opening and closing are the same movement in two directions: the sheet is
// kept mounted for its exit and slides back down (see Overlay / G4). A drag
// joins that same movement rather than adding one of its own — see
// lib/useSheetDrag.js.
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
      <Panel full={full} title={title} headerRight={headerRight} onClose={onClose}>
        {children}
      </Panel>
    </Overlay>
  )
}

// Separate component so it can read the overlay phase from the context —
// useOverlayPanel only works below <Overlay>.
function Panel({ full, title, headerRight, onClose, children }) {
  const panel = useOverlayPanel(
    'ov-panel-sheet',
    full
      ? 'pointer-events-auto absolute inset-0 flex flex-col bg-bg-elevated'
      : 'pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-[20px] bg-bg-elevated border-t border-subtle max-h-[85%] flex flex-col'
  )
  const panelRef = useRef(null)
  const drag = useSheetDrag({
    panelRef,
    phase: panel['data-phase'],
    onDismiss: onClose,
  })

  return (
    <div {...panel} ref={panelRef} role="dialog" aria-modal="true">
      {full ? (
        <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-subtle">
          <IconButton
            onClick={onClose}
            className="-ml-1 text-text-secondary"
            aria-label="Schließen"
          >
            <X size={24} />
          </IconButton>
          <h2 className="text-[17px] font-semibold text-text-primary">{title}</h2>
          <div className="min-w-[24px] text-right">{headerRight}</div>
        </div>
      ) : (
        // The grabber and the title are one drag handle. Deliberately only
        // this strip and not the body below it: the body scrolls, and a
        // surface cannot be both a scroller and a drag target without one of
        // them having to guess. `touch-none` claims the vertical gesture here
        // — the one place in the app that needs it, so the page behind, the
        // calendar swipe and the task reorder keep the budget they had.
        //
        // `select-none` is not cosmetic: dragging across the title otherwise
        // starts a text selection, and the second drag over already-selected
        // text becomes a native drag of that selection — which Chromium
        // announces by cancelling the pointer mid-gesture. The sheet would
        // snap back for no reason the user can see. A drag handle has nothing
        // worth selecting anyway.
        <div className="shrink-0 touch-none select-none" {...drag}>
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-9 rounded-full bg-white/15" />
          </div>
          {title && (
            <h2 className="px-5 pb-2 text-[17px] font-semibold text-text-primary">
              {title}
            </h2>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  )
}
