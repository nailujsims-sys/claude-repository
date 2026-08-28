import { useCallback } from 'react'
import { useTasks } from '../context/TasksContext'
import { useToast } from '../context/ToastContext'

// The two task mutations that need to be undoable, wired to their feedback
// (G7/G8).
//
// It exists so `TasksContext` never learns about toasts: it stays data and
// business logic, and this is the one place that decides what a completion or
// a deletion says to the user. Both call sites of "complete" — the Aufgaben
// list and the calendar's day list — go through here, so the same tap means
// the same thing in both.
//
// Undo is always the existing counter-patch (`uncompleteTask`, `restoreTask`),
// never a stored copy of the old row: a patch leaves anything the task picked
// up in the meantime alone, and because `sort_order` is never touched by either
// direction, an undone task returns to exactly the position it left.
export function useTaskActions() {
  const { completeTask, uncompleteTask, softDeleteTask, restoreTask } = useTasks()
  const { showToast } = useToast()

  // Resolves to whether the mutation actually landed, so a caller can hold back
  // navigation. Nothing rejects: `updateTask` already reports failures through
  // the global error banner and resyncs, and an offer to undo something that
  // did not happen would be a lie.
  const complete = useCallback(
    async (task) => {
      try {
        await completeTask(task)
      } catch {
        return false
      }
      showToast('Erledigt', {
        actionLabel: 'Rückgängig',
        onAction: () => uncompleteTask(task),
      })
      return true
    },
    [completeTask, uncompleteTask, showToast]
  )

  const softDelete = useCallback(
    async (task) => {
      try {
        await softDeleteTask(task)
      } catch {
        return false
      }
      showToast('Aufgabe gelöscht', {
        actionLabel: 'Rückgängig',
        onAction: () => restoreTask(task),
      })
      return true
    },
    [softDeleteTask, restoreTask, showToast]
  )

  return { complete, softDelete }
}
