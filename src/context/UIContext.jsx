import { createContext, useContext, useMemo, useState } from 'react'

const UIContext = createContext(null)

// Controls global overlays that can be triggered from many places: the sidebar,
// the Plus action sheet, and the Neue Aufgabe / Neuer Termin / Neue Liste form
// sheets.
export function UIProvider({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  // taskForm: null | { mode: 'create' | 'edit', taskId?: string, due?: Due }
  // `due` pre-fills a create with { due_type, due_date } — used where the
  // creation happens inside a dated list (the Heute screen), so the new task
  // lands in the list it was created from instead of arriving without a date.
  const [taskForm, setTaskForm] = useState(null)
  // eventForm: null | { mode: 'create' | 'edit', eventId?: string }
  const [eventForm, setEventForm] = useState(null)
  // listForm: null | { mode: 'create' | 'edit', listId?: string }
  // Global for the same reason the task form is: "Neue Liste" is reachable from
  // the Plus action sheet on every screen, not only from the Listen overview.
  const [listForm, setListForm] = useState(null)

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

      eventForm,
      openEventForm: (opts = { mode: 'create' }) => setEventForm(opts),
      closeEventForm: () => setEventForm(null),

      listForm,
      openListForm: (opts = { mode: 'create' }) => setListForm(opts),
      closeListForm: () => setListForm(null),
    }),
    [sidebarOpen, actionSheetOpen, taskForm, eventForm, listForm]
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
