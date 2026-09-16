import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { financeRepository } from '../data/financeRepository'
import { failureLog } from '../lib/finance/importFlow'
import { useAuth } from './AuthContext'

const FinanceContext = createContext(null)

// The Finanzen module's data, and the two writes the import flow performs.
//
// Same shape as every other provider here: load once on sign-in, keep `loading`
// and `error` beside the rows, and hand the screen finished data. What it adds
// is the import path — and that path is deliberately thin, because everything
// that decides anything already happened before it: the parser refused or
// accepted the file, the matcher produced the plan, and the database applies it
// atomically. There is no branch in here that could make a different booking.
//
// TWO WRITES, AND ONLY TWO: creating the account (once, on the first import) and
// calling the apply function. Nothing in this module writes a booking directly —
// `finance_apply_reconciliation_plan` is the single write path, so there is no
// second route past its invariants.
export function FinanceProvider({ children }) {
  const { user } = useAuth()
  const repo = financeRepository

  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  // Not for the screen — for the matcher. A booking's stored text is frozen at
  // the moment it arrived; the richer text a later export contributed lives
  // beside it, and a manual decision lives in its own row. Both are evidence the
  // next reconciliation needs, and both are lost on a reload unless they are
  // read back with the bookings.
  const [observations, setObservations] = useState([])
  const [overrides, setOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const [accountRows, transactionRows, observationRows, overrideRows] = await Promise.all([
          repo.listAccounts(user.id),
          repo.listTransactions(user.id),
          repo.listObservations(user.id),
          repo.listOverrides(user.id),
        ])
        setAccounts(accountRows)
        setTransactions(transactionRows)
        setObservations(observationRows)
        setOverrides(overrideRows)
        setError(null)
      } catch (err) {
        console.error(failureLog('laden', err))
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

  // One account for now. The model allows several and the import flow always
  // names the one it is importing into, so adding a picker later changes this
  // line and nothing else.
  const account = accounts[0] ?? null

  const createAccount = useCallback(
    async (name) => {
      const row = await repo.createAccount(user.id, {
        name: name.trim(),
        provider: 'DKB',
        currency: 'EUR',
      })
      setAccounts((prev) => [...prev, row])
      return row
    },
    [user, repo]
  )

  /**
   * The import row a file belongs to.
   *
   * A file that was read before keeps its row: re-picking the same PDF must not
   * pile up import records, and if that row was already applied the flow can say
   * so instead of proposing the work a second time.
   */
  /** Has this exact file been read before, and what became of it? */
  const findImport = useCallback(
    async (sourceHash) => (sourceHash ? repo.findImportBySourceHash(user.id, sourceHash) : null),
    [user, repo]
  )

  const openImport = useCallback(
    async ({ accountId, sourceHash, sourceName, periodStart, periodEnd }) => {
      const existing = await repo.findImportBySourceHash(user.id, sourceHash)
      if (existing) return { row: existing, reused: true }
      const row = await repo.createImport(user.id, {
        account_id: accountId,
        source_type: 'pdf',
        source_name: sourceName ?? null,
        source_hash: sourceHash ?? null,
        status: 'parsed',
        period_start: periodStart ?? null,
        period_end: periodEnd ?? null,
      })
      return { row, reused: false }
    },
    [user, repo]
  )

  // The one write that matters, and it is somebody else's transaction: the
  // function applies the whole plan or none of it. Afterwards the screen is
  // reloaded from the database rather than patched from the payload — what was
  // stored is what the database says was stored.
  const applyPlan = useCallback(
    async (payload) => {
      const result = await repo.applyReconciliationPlan(user.id, payload)
      await load({ silent: true })
      return result
    },
    [user, repo, load]
  )

  const value = useMemo(
    () => ({
      accounts,
      account,
      transactions,
      observations,
      overrideTransactionIds: overrides.map((o) => o.transaction_id),
      loading,
      error,
      reload: () => load({ silent: true }),
      createAccount,
      findImport,
      openImport,
      applyPlan,
    }),
    [accounts, account, transactions, observations, overrides, loading, error, load, createAccount, findImport, openImport, applyPlan]
  )

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
}

export function useFinance() {
  const ctx = useContext(FinanceContext)
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider')
  return ctx
}
