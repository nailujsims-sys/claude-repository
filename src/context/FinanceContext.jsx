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
// FOUR WRITES, AND ONLY FOUR: creating the account (once, on the first import),
// applying an import plan, learning one classification, and recording one
// decision a user made about a single booking. The middle two are database
// functions that do their whole job in one transaction; the last is a row in
// the override table, which is where 0008 puts a decision that beats every
// rule. Nothing in this module writes a booking directly — there is no second
// route past those functions' invariants, and all of them reload from the
// database afterwards rather than patching state from what was sent.
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
  // The rule engine's own rows. They are what decides which bookings still need
  // a human — not the `merchant_id` column on the booking — so a screen that
  // asks that question needs all four of them, and needs them again after every
  // write (see learnRule).
  const [categories, setCategories] = useState([])
  const [merchants, setMerchants] = useState([])
  const [patterns, setPatterns] = useState([])
  const [categoryRules, setCategoryRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!user) return
      if (!silent) setLoading(true)
      try {
        const [
          accountRows, transactionRows, observationRows, overrideRows,
          categoryRows, merchantRows, patternRows, ruleRows,
        ] = await Promise.all([
          repo.listAccounts(user.id),
          repo.listTransactions(user.id),
          repo.listObservations(user.id),
          repo.listOverrides(user.id),
          repo.listCategories(user.id),
          repo.listMerchants(user.id),
          repo.listPatterns(user.id),
          repo.listCategoryRules(user.id),
        ])
        setAccounts(accountRows)
        setTransactions(transactionRows)
        setObservations(observationRows)
        setOverrides(overrideRows)
        setCategories(categoryRows)
        setMerchants(merchantRows)
        setPatterns(patternRows)
        setCategoryRules(ruleRows)
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

  /**
   * One classification, learned.
   *
   * Merchant, pattern, rule, this booking and every booking the pattern now
   * explains — one database function, one transaction, or none of it. The
   * request comes from buildLearnRequest, which is pure and checked; this only
   * puts it on the wire and then reloads, because what the rule means for the
   * queue is a question only the fresh rows can answer.
   */
  const learnRule = useCallback(
    async (request) => {
      const result = await repo.learnMerchantRule(user.id, request)
      await load({ silent: true })
      return result
    },
    [user, repo, load]
  )

  /**
   * One booking, decided by hand.
   *
   * The narrow counterpart to learnRule: not every open booking is a merchant
   * waiting to be taught. A booking two merchants' patterns both claim, and a
   * booking of a merchant the user asked to see every time, are decisions about
   * THIS booking — and the override table is what 0008 built for exactly that.
   * The global patterns and rules are not touched, which is the whole point.
   */
  const saveOverride = useCallback(
    async (transactionId, patch) => {
      // The override as last read travels with the patch, so a save that only
      // decides a note cannot drop the merchant somebody picked last week. See
      // financeRepository.saveOverride for why the merge is done here rather
      // than left to the server.
      const current = overrides.find((o) => o.transaction_id === transactionId) ?? null
      const row = await repo.saveOverride(user.id, transactionId, patch, current)
      await load({ silent: true })
      return row
    },
    [user, repo, load, overrides]
  )

  /**
   * „Buchungen dieses Händlers zählen nicht." — or count again.
   *
   * One column on the merchant, and deliberately reversible: this is an
   * interpretation of the data, never a change to it. No booking is rewritten;
   * what changes is the answer resolveAnalyticsInclusion gives for every
   * booking the pattern engine recognises as this merchant's, past and future.
   */
  const setMerchantAnalytics = useCallback(
    async (merchantId, include) => {
      const row = await repo.setMerchantAnalyticsDefault(user.id, merchantId, include)
      await load({ silent: true })
      return row
    },
    [user, repo, load]
  )

  const value = useMemo(
    () => ({
      accounts,
      account,
      transactions,
      observations,
      categories,
      merchants,
      patterns,
      categoryRules,
      overrides,
      overrideTransactionIds: overrides.map((o) => o.transaction_id),
      loading,
      error,
      reload: () => load({ silent: true }),
      createAccount,
      findImport,
      openImport,
      applyPlan,
      learnRule,
      saveOverride,
      setMerchantAnalytics,
    }),
    [accounts, account, transactions, observations, categories, merchants, patterns, categoryRules,
     overrides, loading, error, load, createAccount, findImport, openImport, applyPlan, learnRule,
     saveOverride, setMerchantAnalytics]
  )

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
}

export function useFinance() {
  const ctx = useContext(FinanceContext)
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider')
  return ctx
}
