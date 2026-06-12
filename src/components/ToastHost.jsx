import { useToast } from '../context/ToastContext'

// Renders the active toast near the top of the frame.
export default function ToastHost() {
  const { toast } = useToast()
  if (!toast) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center">
      <div className="w-full max-w-app flex justify-center px-5 pt-3">
        <div
          key={toast.id}
          className="animate-toast-in rounded-btn bg-bg-elevated border border-subtle px-4 py-2.5 text-[14px] font-medium text-text-primary shadow-lg shadow-black/40"
        >
          {toast.message}
        </div>
      </div>
    </div>
  )
}
