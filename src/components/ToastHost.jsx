import { useToast } from '../context/ToastContext'

// Renders the active toast near the top of the frame.
//
// The live region is mounted permanently and only its content changes — a
// region that appears together with its text is not reliably announced. The
// wrapper stays `pointer-events-none` so the toast never swallows a tap meant
// for the screen underneath; only the undo button takes pointer events back.
export default function ToastHost() {
  const { toast, runToastAction } = useToast()

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
    >
      <div className="w-full max-w-app flex justify-center px-5 pt-3">
        {toast && (
          <div
            key={toast.id}
            className="animate-toast-in flex items-center gap-3 rounded-btn bg-bg-elevated border border-subtle px-4 py-2.5 text-[14px] font-medium text-text-primary shadow-lg shadow-black/40"
          >
            <span>{toast.message}</span>
            {toast.actionLabel && (
              <button
                type="button"
                onClick={() => runToastAction(toast.id)}
                className="press-tint pointer-events-auto -my-1 -mr-2 shrink-0 rounded-btn px-2 py-1 text-[14px] font-semibold text-accent"
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
