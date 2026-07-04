import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getEventRepository } from '../data/eventRepository'
import { useAuth } from './AuthContext'

const EventsContext = createContext(null)

// Holds the full calendar-event list plus mutations, mirroring TasksProvider so
// Supabase and local mode behave identically. Views derive day/week/month
// slices from `events` via the pure helpers in lib/calendar.js.
export function EventsProvider({ children }) {
  const { user } = useAuth()
  const repo = getEventRepository()

  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await repo.listEvents(user.id)
      setEvents(rows)
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
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === row.id)
      if (idx === -1) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })

  const createEvent = useCallback(
    async (data) => {
      const row = await repo.createEvent(user.id, data)
      upsertLocal(row)
      return row
    },
    [repo, user]
  )

  const updateEvent = useCallback(
    async (id, patch) => {
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
      try {
        const row = await repo.updateEvent(user.id, id, patch)
        upsertLocal(row)
        return row
      } catch (err) {
        console.error(err)
        setError(err)
        load()
        throw err
      }
    },
    [repo, user, load]
  )

  const deleteEvent = useCallback(
    async (id) => {
      const prev = events
      setEvents((list) => list.filter((e) => e.id !== id))
      try {
        await repo.deleteEvent(user.id, id)
      } catch (err) {
        console.error(err)
        setError(err)
        setEvents(prev) // roll back
        throw err
      }
    },
    [repo, user, events]
  )

  const value = useMemo(
    () => ({
      events,
      loading,
      error,
      reload: load,
      createEvent,
      updateEvent,
      deleteEvent,
    }),
    [events, loading, error, load, createEvent, updateEvent, deleteEvent]
  )

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
}

export function useEvents() {
  const ctx = useContext(EventsContext)
  if (!ctx) throw new Error('useEvents must be used within EventsProvider')
  return ctx
}
