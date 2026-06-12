import { useEffect } from 'react'

// Shared overlay scaffolding: a full-screen dim backdrop plus a column
// constrained to the phone-frame width, so panels (sheets, sidebar) stay
// aligned with the app on desktop. Children position themselves within the
// column and should set `pointer-events-auto`.
export default function Overlay({ open, onClose, children, align = 'center' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div className={`absolute inset-0 flex ${align === 'left' ? 'justify-start' : 'justify-center'} pointer-events-none`}>
        <div className="relative w-full max-w-app h-full pointer-events-none">
          {children}
        </div>
      </div>
    </div>
  )
}
