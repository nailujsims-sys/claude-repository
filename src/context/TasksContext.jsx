import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getTaskRepository } from '../data/taskRepository'
import { useAuth } from './AuthContext'

const TasksContext = createContext(null)

// Holds the full task list (including completed/deleted — screens filter via
// selectors) plus all mutations. Updates state optimistically and persists
// through the repository, so Supabase and local mode behave identically.
export function TasksProvider({ children }) {
  const { user } = useAuth()
  const repo = getTaskRepository()

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await repo.listTasks(user.id)
      setTasks(rows)
      setError(null)
    } catch (err) {
      console.error(err)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [user, repo])

  useEffect(() => {
    load()
  }, [load])

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
