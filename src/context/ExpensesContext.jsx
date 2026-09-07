import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { expenseRepository } from '../data/expenseRepository'
import { applyRealtimeChange, mergeRows } from '../lib/realtimeSync'
import { useRealtimeSync } from '../lib/useRealtimeSync'
import {
  RATE_MAX_AGE_MS,
  fetchAudEurRate,
  resolveRate,
} from '../lib/exchangeRate'
import { useAuth } from './AuthContext'

const ExpensesContext = createContext(null)

// Holds every expense plus all mutations, on exactly the three pieces
// TasksContext and ListsContext are built from: optimistic local state, a
// Supabase write, and a resync from the database when a write fails, so the
// screen never keeps showing something that was never stored.
//
// It also owns the AUD/EUR rate, because the rate and the expenses are one
// question: the rate that is shown, the rate a new expense is stamped with and
// the rate the fallback reads off the newest row all have to be the same
// answer. src/lib/exchangeRate.js holds the rules; this holds the life cycle.
export function ExpensesProvider({ children }) {
  const { user } = useAuth()
  const repo = expenseRepository

  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // The rate as loaded from the source in this session. Null until a request
  // has succeeded — `resolveRate` then falls back, and the UI says which step
  // it is showing.
  const [liveRate, setLiveRate] = useState(null)
  const [rateDate, setRateDate] = useState(null)
  const [rateLoading, setRateLoading] = useState(false)
  // True once a request has failed and none has succeeded since. Purely for the
  // one quiet line in the UI; it never blocks anything.
  const [rateFailed, setRateFailed] = useState(false)
  const rateLoadedAt = useRef(0)
  // The request in flight, so two screens opening at once ask once.
  const ratePending = useRef(null)

  // `silent` is what a resync after a dropped connection uses: same rows, but
  // `loading` untouched, so the screen is not replaced by its skeleton for data
  // the user is already looking at. `mergeRows` keeps the previous array when
  // nothing changed — a reconnect that found no news causes no render at all.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const rows = await repo.listExpenses(user.id)
        setExpenses((prev) => (silent ? mergeRows(prev, rows) : rows))
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

  const resync = useCallback(() => load({ silent: true }), [load])
  const applyChange = useCallback(
    (payload) => setExpenses((prev) => applyRealtimeChange(prev, payload, user?.id)),
    [user]
  )

  useRealtimeSync({
    table: 'expenses',
    userId: user?.id ?? null,
    onChange: applyChange,
    onResync: resync,
  })

  const upsert = (row) =>
    setExpenses((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id)
      if (idx === -1) return [...prev, row]
      const next = [...prev]
      next[idx] = row
      return next
    })

  // ── The rate ─────────────────────────────────────────────────────────────

  // Ask the source, unless the answer we have is younger than RATE_MAX_AGE_MS.
  // Never throws and never rejects: a failed rate request is a fallback, not an
  // error the user has to deal with, so this always resolves to the rate that
  // should be used right now.
  //
  // Called when the tracker is opened and again when an expense is saved — the
  // two moments the brief names — and it is cheap in both: the second call
  // inside the fresh window returns without touching the network.
  const ensureRate = useCallback(
    async ({ force = false } = {}) => {
      const fresh = Date.now() - rateLoadedAt.current < RATE_MAX_AGE_MS
      if (!force && fresh && liveRate !== null) return liveRate
      if (ratePending.current) return ratePending.current

      setRateLoading(true)
      const request = (async () => {
        try {
          const { rate, date } = await fetchAudEurRate({})
          rateLoadedAt.current = Date.now()
          setLiveRate(rate)
          setRateDate(date)
          setRateFailed(false)
          return rate
        } catch (err) {
          // Deliberately not `setError`: the global banner is for "your data is
          // not reachable", and the expenses are. The rate line says what
          // happened, and the fallback carries on.
          console.warn('Wechselkurs konnte nicht geladen werden:', err?.message ?? err)
          setRateFailed(true)
          return liveRate
        } finally {
          setRateLoading(false)
          ratePending.current = null
        }
      })()
      ratePending.current = request
      return request
    },
    [liveRate]
  )

  // The rate to show and to stamp, and where it came from — one answer for the
  // whole module (see src/lib/exchangeRate.js → resolveRate).
  const { rate, rateSource } = useMemo(() => {
    const resolved = resolveRate({ liveRate, expenses })
    return { rate: resolved.rate, rateSource: resolved.source }
  }, [liveRate, expenses])

  // ── Mutations ────────────────────────────────────────────────────────────

  // Saving asks for a current rate first, so the row is stamped with the
  // freshest number available at the moment the money was recorded. When the
  // request fails this resolves to the fallback chain instead of failing the
  // save: an expense that cannot be written down is worse than one written down
  // at yesterday's rate — and the rate that was used is stored on the row, so
  // it stays visible which one it was.
  const createExpense = useCallback(
    async (data) => {
      // The rate `ensureRate` resolves to is used directly rather than read back
      // out of state: state set inside this tick is not visible to the closure
      // that set it, and stamping the row with the previous rate would defeat
      // the whole point of refreshing first.
      const fresh = await ensureRate()
      const stamped = resolveRate({ liveRate: fresh, expenses })
      const row = await repo.createExpense(user.id, {
        ...data,
        exchange_rate_aud_eur: data.exchange_rate_aud_eur ?? stamped.rate,
      })
      upsert(row)
      return row
    },
    [repo, user, expenses, ensureRate]
  )

  // An edit does NOT re-stamp the rate: the rate belongs to the expense, not to
  // the moment it is corrected. Fixing a typo in an amount, or moving a wrongly
  // dated expense to the right day, must not silently re-price it at today's
  // rate — that is exactly what storing the rate per row is for.
  const updateExpense = useCallback(
    async (id, patch) => {
      setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
      try {
        const row = await repo.updateExpense(user.id, id, patch)
        upsert(row)
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

  const deleteExpense = useCallback(
    async (expense) => {
      const previous = expenses
      setExpenses((prev) => prev.filter((e) => e.id !== expense.id))
      try {
        await repo.deleteExpense(user.id, expense.id)
      } catch (err) {
        console.error(err)
        setError(err)
        // Put it back rather than leave the screen claiming a deletion that
        // never happened; `load()` then has the last word.
        setExpenses(previous)
        load()
        throw err
      }
    },
    [repo, user, expenses, load]
  )

  const getExpense = useCallback((id) => expenses.find((e) => e.id === id), [expenses])

  const value = useMemo(
    () => ({
      expenses,
      loading,
      error,
      reload: load,
      getExpense,
      createExpense,
      updateExpense,
      deleteExpense,
      rate,
      rateSource,
      rateDate,
      rateLoading,
      rateFailed,
      ensureRate,
    }),
    [
      expenses,
      loading,
      error,
      load,
      getExpense,
      createExpense,
      updateExpense,
      deleteExpense,
      rate,
      rateSource,
      rateDate,
      rateLoading,
      rateFailed,
      ensureRate,
    ]
  )

  return <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>
}

export function useExpenses() {
  const ctx = useContext(ExpensesContext)
  if (!ctx) throw new Error('useExpenses must be used within ExpensesProvider')
  return ctx
}
