import { X } from 'lucide-react'
import Overlay from './Overlay'

// Bottom sheet that slides up. Two variants:
//  - default: auto-height, rounded top, sits above the bottom nav (for the
//    action sheet and filter panel).
//  - full: covers the whole frame (for the Neue Aufgabe / Bearbeiten form),
//    with a header row (× / title / right action).
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
      <div
        className={
          full
            ? 'pointer-events-auto absolute inset-0 flex flex-col bg-bg-elevated animate-sheet-up'
            : 'pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-[20px] bg-bg-elevated border-t border-subtle animate-sheet-up max-h-[85%] flex flex-col'
        }
        role="dialog"
        aria-modal="true"
      >
        {full ? (
          <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-subtle">
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary -ml-1 p-1"
              aria-label="Schließen"
            >
              <X size={24} />
            </button>
            <h2 className="text-[17px] font-semibold text-text-primary">{title}</h2>
            <div className="min-w-[24px] text-right">{headerRight}</div>
          </div>
        ) : (
          <>
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-9 rounded-full bg-white/15" />
            </div>
            {title && (
              <h2 className="px-5 pb-2 text-[17px] font-semibold text-text-primary">
                {title}
              </h2>
            )}
          </>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </Overlay>
  )
}
