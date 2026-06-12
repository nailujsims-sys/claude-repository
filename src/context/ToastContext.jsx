import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

// Lightweight top-of-screen toast. Auto-dismisses after 2s.
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const showToast = useCallback((message) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ message, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), 2000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
