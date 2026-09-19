import { createContext, useContext, useMemo, useState } from 'react'

const UIContext = createContext(null)

// Controls global overlays that can be triggered from many places: the sidebar,
// the Plus action sheet, and the Neue Aufgabe / Neuer Termin / Neue Liste /
// Neue Ausgabe form sheets.
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
  // expenseForm: null | { mode: 'create' | 'edit', expenseId?: string }
  // Same reason again, and the strongest case of the four: an expense is
  // entered at the till, so "Neue Ausgabe" has to be two taps from wherever
  // the app happens to be standing.
  const [expenseForm, setExpenseForm] = useState(null)
  // financeImport: null | true
  // The DKB PDF import. Since v1.23 it is no longer a visible path — „Hinzufügen"
  // offers the manual booking and the AI import, and the PDF route stays as the
  // legacy fallback it is. The state and the sheet are kept wired on purpose:
  // bringing it back is one button, not a resurrection.
  const [financeImport, setFinanceImport] = useState(null)
  // financeAdd: null | true — the one way into the Finanzen module's two writes.
  const [financeAdd, setFinanceAdd] = useState(null)
  // financeManual: null | true
  const [financeManual, setFinanceManual] = useState(null)
  // financeAiImport: null | true
  const [financeAiImport, setFinanceAiImport] = useState(null)
  // financeClassify: null | true
  const [financeClassify, setFinanceClassify] = useState(null)
  // financeExclusions: null | true
  const [financeExclusions, setFinanceExclusions] = useState(null)
  // financeAccounts: null | true — die Kontoverwaltung (v1.25). Global wie die
  // übrigen Finanz-Sheets, obwohl sie heute nur von einer Stelle aus geöffnet
  // wird: sie ist ein Overlay über dem ganzen Rahmen, und ein Overlay, das ein
  // Screen selbst mountet, verschwindet mit dem Screen.
  const [financeAccounts, setFinanceAccounts] = useState(null)

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

      expenseForm,
      openExpenseForm: (opts = { mode: 'create' }) => setExpenseForm(opts),
      closeExpenseForm: () => setExpenseForm(null),

      financeImport,
      openFinanceImport: () => setFinanceImport(true),
      closeFinanceImport: () => setFinanceImport(null),
      financeAdd,
      openFinanceAdd: () => setFinanceAdd(true),
      closeFinanceAdd: () => setFinanceAdd(null),
      financeManual,
      openFinanceManual: () => setFinanceManual(true),
      closeFinanceManual: () => setFinanceManual(null),
      financeAiImport,
      openFinanceAiImport: () => setFinanceAiImport(true),
      closeFinanceAiImport: () => setFinanceAiImport(null),
      financeClassify,
      openFinanceClassify: () => setFinanceClassify(true),
      closeFinanceClassify: () => setFinanceClassify(null),
      financeExclusions,
      openFinanceExclusions: () => setFinanceExclusions(true),
      closeFinanceExclusions: () => setFinanceExclusions(null),
      financeAccounts,
      openFinanceAccounts: () => setFinanceAccounts(true),
      closeFinanceAccounts: () => setFinanceAccounts(null),
    }),
    [sidebarOpen, actionSheetOpen, taskForm, eventForm, listForm, expenseForm, financeImport,
     financeAdd, financeManual, financeAiImport, financeClassify, financeExclusions,
     financeAccounts]
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
