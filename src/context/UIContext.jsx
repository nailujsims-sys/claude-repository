import { createContext, useContext, useMemo, useState } from 'react'

const UIContext = createContext(null)

// Controls global overlays that can be triggered from many places: the sidebar,
// the Plus action sheet, and the Neue Aufgabe / Bearbeiten task-form sheet.
export function UIProvider({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  // taskForm: null | { mode: 'create' | 'edit', taskId?: string }
  const [taskForm, setTaskForm] = useState(null)

  const value = useMemo(
    () => ({
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      closeSidebar: () => setSidebarOpen(false),

      actionSheetOpen,
      openActionSheet: () => setActionSheetOpen(true),
      closeActionSheet: () => setActionSheetOpen(false),

      taskForm,
      openTaskForm: (opts = { mode: 'create' }) => setTaskForm(opts),
      closeTaskForm: () => setTaskForm(null),
    }),
    [sidebarOpen, actionSheetOpen, taskForm]
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
