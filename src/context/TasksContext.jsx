import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { taskRepository } from '../data/taskRepository'
import { applyRealtimeChange, mergeRows } from '../lib/realtimeSync'
import { useRealtimeSync } from '../lib/useRealtimeSync'
import { useAuth } from './AuthContext'

const TasksContext = createContext(null)

// Holds the full task list (including completed/deleted — screens filter via
// selectors) plus all mutations. State updates optimistically and is persisted
// to Supabase; a failed write resyncs from the database rather than leaving the
// screen showing something that was never stored.
export function TasksProvider({ children }) {
  const { user } = useAuth()
  const repo = taskRepository

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // `silent` is what a resync after a dropped connection uses: it fetches the
  // same rows but leaves `loading` alone, so the screen is not replaced by its
  // skeleton for data the user is already looking at. `mergeRows` then keeps
  // the previous array when nothing actually changed — a reconnect that found
  // no news causes no render at all.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const rows = await repo.listTasks(user.id)
        setTasks((prev) => (silent ? mergeRows(prev, rows) : rows))
        setError(null)
      } catch (err) {
        console.error(err)
        setError(err)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [user, repo]
  )

  useEffect(() => {
    load()
  }, [load])

  // Another device changed something: fold that one row into the list. No
  // reload, and no visible second application of a change this device made
  // itself — see lib/realtimeSync.js.
  const applyChange = useCallback(
    (payload) => setTasks((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )
  const resync = useCallback(() => load({ silent: true }), [load])

  useRealtimeSync({
    table: 'tasks',
    userId: user?.id ?? null,
    onChange: applyChange,
    onResync: resync,
  })

  const upsertLocal = (row) =>
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === row.id)
      if (idx === -1) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })

  const createTask = useCallback(
    async (data) => {
      // Place new tasks at the end of their group.
      const sort_order =
        tasks.reduce((max, t) => Math.max(max, t.sort_order ?? 0), 0) + 1
      const row = await repo.createTask(user.id, { ...data, sort_order })
      upsertLocal(row)
      return row
    },
    [repo, user, tasks]
  )

  const updateTask = useCallback(
    async (id, patch) => {
      // Optimistic update for snappy UI, then persist.
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      )
      try {
        const row = await repo.updateTask(user.id, id, patch)
        upsertLocal(row)
        return row
      } catch (err) {
        console.error(err)
        setError(err)
        load() // resync on failure
        throw err
      }
    },
    [repo, user, load]
  )

  const toggleFavorite = useCallback(
    (task) => updateTask(task.id, { is_favorite: !task.is_favorite }),
    [updateTask]
  )

  const completeTask = useCallback(
    (task) =>
      updateTask(task.id, {
        is_completed: true,
        completed_at: new Date().toISOString(),
      }),
    [updateTask]
  )

  const uncompleteTask = useCallback(
    (task) => updateTask(task.id, { is_completed: false, completed_at: null }),
    [updateTask]
  )

  const softDeleteTask = useCallback(
    (task) =>
      updateTask(task.id, {
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      }),
    [updateTask]
  )

  // The exact inverse of softDeleteTask, and the whole of "undo" (G8). It is a
  // patch rather than a restored snapshot on purpose: a task edited during the
  // undo window keeps that edit, and `sort_order` was never touched by the
  // delete, so the row returns to the position it left.
  const restoreTask = useCallback(
    (task) => updateTask(task.id, { is_deleted: false, deleted_at: null }),
    [updateTask]
  )

  const reorderTasks = useCallback(
    async (updates) => {
      // updates: [{ id, sort_order?, due_date?, due_type? }]
      setTasks((prev) =>
        prev.map((t) => {
          const u = updates.find((x) => x.id === t.id)
          return u ? { ...t, ...u } : t
        })
      )
      try {
        await repo.reorderTasks(user.id, updates)
      } catch (err) {
        console.error(err)
        setError(err)
        load()
      }
    },
    [repo, user, load]
  )

  const getTask = useCallback((id) => tasks.find((t) => t.id === id), [tasks])

  const value = useMemo(
    () => ({
      tasks,
      loading,
      error,
      reload: load,
      getTask,
      createTask,
      updateTask,
      toggleFavorite,
      completeTask,
      uncompleteTask,
      softDeleteTask,
      restoreTask,
      reorderTasks,
    }),
    [
      tasks,
      loading,
      error,
      load,
      getTask,
      createTask,
      updateTask,
      toggleFavorite,
      completeTask,
      uncompleteTask,
      softDeleteTask,
      restoreTask,
      reorderTasks,
    ]
  )

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

export function useTasks() {
  const ctx = useContext(TasksContext)
  if (!ctx) throw new Error('useTasks must be used within TasksProvider')
  return ctx
}
