import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { financeRepository } from '../data/financeRepository'
import { splitAccounts } from '../lib/finance/accounts'
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
  // Die Import-Zeilen, seit v1.25 — nicht für eine Liste, sondern für eine
  // einzige Frage: ist dieses Konto wirklich leer? „Leer" entscheidet, ob die
  // Kontoverwaltung „Löschen" anbietet und ob die Währung noch frei ist, und
  // ein Konto ohne Buchung, an dem ein abgebrochener Import hängt, ist eben
  // nicht leer. Die verbindliche Antwort gibt `finance_account_dependency`
  // (0013); diese Zeilen sind das, was die Oberfläche vorher schon weiß.
  const [imports, setImports] = useState([])
  const [transactions, setTransactions] = useState([])
  // Not for the screen — for the matcher. A booking's stored text is frozen at
  // the moment it arrived; the richer text a later export contributed lives
  // beside it, and a manual decision lives in its own row. Both are evidence the
  // next reconciliation needs, and both are lost on a reload unless they are
  // read back with the bookings.
  const [observations, setObservations] = useState([])
  const [overrides, setOverrides] = useState([])
  // Was ein KI-Import zu einer Buchung vorgeschlagen hat. Nicht Deko: die
  // zentrale Einordnungsregel (src/lib/finance/effectiveClassification.js) liest
  // sie, um zu entscheiden, ob ein Umsatz noch jemanden beschäftigen muss — und
  // ohne sie stünde nach jedem Reload wieder alles in der Warteschlange.
  const [aiSuggestions, setAiSuggestions] = useState([])
  // Das Gedächtnis (v1.24): was der Nutzer ausdrücklich für kommende KI-Importe
  // behalten wollte. Es wird bei jedem „KI-Kontext kopieren" gelesen — ohne
  // diese Zeilen schreibt die App denselben Prompt wie vor der ersten Korrektur.
  const [aiMemories, setAiMemories] = useState([])
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
          accountRows, importRows, transactionRows, observationRows, overrideRows,
          categoryRows, merchantRows, patternRows, ruleRows, suggestionRows, memoryRows,
        ] = await Promise.all([
          repo.listAccounts(user.id),
          repo.listImports(user.id),
          repo.listTransactions(user.id),
          repo.listObservations(user.id),
          repo.listOverrides(user.id),
          repo.listCategories(user.id),
          repo.listMerchants(user.id),
          repo.listPatterns(user.id),
          repo.listCategoryRules(user.id),
          repo.listAiSuggestions(user.id),
          repo.listAiMemories(user.id),
        ])
        setAccounts(accountRows)
        setImports(importRows)
        setTransactions(transactionRows)
        setObservations(observationRows)
        setOverrides(overrideRows)
        setAiSuggestions(suggestionRows)
        setAiMemories(memoryRows)
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

  // Aktiv und archiviert, einmal getrennt.
  //
  // `accounts` BLEIBT ALLE KONTEN. Das ist die bewusste Entscheidung von v1.25:
  // wer die Historie liest, muss ein archiviertes Konto sehen können, sonst
  // verschwände mit dem Konto auch die Zuordnung seiner alten Buchungen. Wer
  // dagegen etwas NEUES schreibt, fragt `activeAccounts` — und genau darauf
  // sind der Picker, der manuelle Eintrag und der KI-Import umgestellt.
  const { active: activeAccounts, archived: archivedAccounts } = useMemo(
    () => splitAccounts(accounts),
    [accounts]
  )

  // The first account, for every caller that only ever had one. The model
  // allows several and always names the one it writes into, so this is a
  // default and never a decision: since v1.23 the sheets that write show a
  // picker as soon as `accounts` holds more than one row.
  //
  // Seit v1.25 ist es das erste AKTIVE Konto: ein Standard, der auf ein
  // archiviertes Konto zeigt, wäre ein Standard, in den man nichts eintragen
  // darf. Sind alle Konten archiviert, bleibt das erste als Beschriftung übrig
  // — der Finanzen-Screen schreibt damit nichts, er stellt nur eine Überschrift.
  const account = activeAccounts[0] ?? accounts[0] ?? null

  /**
   * A new account.
   *
   * `provider` used to be hard-coded to 'DKB' here, which was true for as long
   * as the PDF import was the only way in. It is a field now, because the AI
   * import reads any bank's statement and an account that says "DKB" because
   * the code said so is a wrong answer to a question the user can answer.
   */
  const createAccount = useCallback(
    async ({ name, provider = null, currency = 'EUR' }) => {
      const row = await repo.createAccount(user.id, {
        name: String(name ?? '').trim(),
        provider: provider && String(provider).trim() !== '' ? String(provider).trim() : null,
        currency: currency || 'EUR',
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
    async ({ accountId, sourceHash, sourceName, periodStart, periodEnd, sourceType = 'pdf' }) => {
      const existing = await repo.findImportBySourceHash(user.id, sourceHash)
      if (existing) return { row: existing, reused: true }
      const row = await repo.createImport(user.id, {
        account_id: accountId,
        source_type: sourceType,
        source_name: sourceName ?? null,
        source_hash: sourceHash ?? null,
        status: 'parsed',
        period_start: periodStart ?? null,
        period_end: periodEnd ?? null,
      })
      // Mitschreiben statt neu laden: die eine Frage, die diese Zeilen
      // beantworten, ist „ist dieses Konto leer?", und ein abgebrochener Import
      // macht es genau ab hier unleer. Ohne das böte die Kontoverwaltung bis
      // zum nächsten vollen Laden ein „Löschen" an, das die Datenbank dann
      // ablehnt — richtig, aber unnötig unfreundlich.
      setImports((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]))
      return { row, reused: false }
    },
    [user, repo]
  )

  /**
   * Ein Konto umbenennen — und, solange es leer ist, seine Währung ändern.
   *
   * Der ganze Vorgang liegt in `finance_update_account` (0013): ein Aufruf,
   * eine Transaktion, und die Währungsregel dort, wo sie nicht umgangen werden
   * kann. Danach wird gelesen statt gepatcht, wie bei jedem anderen Schreiben
   * in diesem Modul.
   */
  const updateAccount = useCallback(
    async (accountId, patch) => {
      const row = await repo.updateAccount(user.id, accountId, patch)
      await load({ silent: true })
      return row
    },
    [user, repo, load]
  )

  /**
   * Archivieren und reaktivieren.
   *
   * Zwei Namen, ein Aufruf — damit „Rückgängig" im Toast dieselbe Funktion mit
   * `false` ist und nicht ein zweiter Weg, der auseinanderlaufen kann. Keine
   * Buchung, kein Import und keine Regel wird dabei angefasst; was sich ändert,
   * ist ausschließlich, ob dieses Konto für NEUE Einträge angeboten wird.
   */
  const setAccountArchived = useCallback(
    async (accountId, archived) => {
      const row = await repo.setAccountArchived(user.id, accountId, archived)
      await load({ silent: true })
      return row
    },
    [user, repo, load]
  )

  const archiveAccount = useCallback(
    (accountId) => setAccountArchived(accountId, true),
    [setAccountArchived]
  )

  const reactivateAccount = useCallback(
    (accountId) => setAccountArchived(accountId, false),
    [setAccountArchived]
  )

  /**
   * Ein leeres Konto endgültig löschen.
   *
   * Ob es leer ist, entscheidet die Datenbank (0013) und nicht dieser Aufruf —
   * die Oberfläche fragt vorher nur, ob sie den Knopf überhaupt zeigt. Wirft
   * die Funktion, ist der Grund verständlich und wird angezeigt.
   */
  const deleteEmptyAccount = useCallback(
    async (accountId) => {
      const id = await repo.deleteEmptyAccount(user.id, accountId)
      await load({ silent: true })
      return id
    },
    [user, repo, load]
  )

  /**
   * One booking, entered by hand.
   *
   * The booking and the decision behind it are one database function and
   * therefore one transaction — see financeRepository.createManualTransaction.
   * Afterwards everything is read back rather than patched from the payload,
   * for the same reason every other write in here does it: what was stored is
   * what the database says was stored.
   */
  const createManualTransaction = useCallback(
    async (payload) => {
      const result = await repo.createManualTransaction(user.id, payload)
      await load({ silent: true })
      return result
    },
    [user, repo, load]
  )

  /**
   * One AI import, applied.
   *
   * Same shape as applyPlan and for the same reasons: the whole import or none
   * of it, decided by the database, and a second call for the same import row
   * writes nothing at all.
   */
  const applyAiImport = useCallback(
    async (payload) => {
      const result = await repo.applyAiImport(user.id, payload)
      await load({ silent: true })
      return result
    },
    [user, repo, load]
  )

  /**
   * Eine Erinnerung abschalten — oder wieder einschalten.
   *
   * Die Zeile selbst entsteht im Import, zusammen mit der Buchung. Was hier
   * passiert, ist die Rückseite davon: wer merkt, dass er sich etwas Falsches
   * gemerkt hat, schaltet es ab, und der nächste Prompt enthält es nicht mehr.
   * Nichts wird gelöscht, weil „Rückgängig" nur geht, solange die Zeile da ist.
   */
  const setAiMemoryActive = useCallback(
    async (memoryId, active) => {
      const row = await repo.setAiMemoryActive(user.id, memoryId, active)
      await load({ silent: true })
      return row
    },
    [user, repo, load]
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

  /**
   * One classification, saved as a whole — and reloaded exactly once.
   *
   * WHY THIS EXISTS. `learnRule`, `saveOverride` and `setMerchantAnalytics` each
   * reload afterwards, which is right when they are the whole save. Chained,
   * they are wrong: the first reload can resolve the booking the user is looking
   * at, so a failure in step two would report „die Notiz fehlt noch" over a
   * screen that has already moved on to the next booking. The retry the message
   * promises would then be impossible.
   *
   * So the steps run against the repository directly, with no reload between
   * them, and `load()` happens once in `finally` — after success, and after a
   * failure, by which time the caller has been told exactly how far it got. The
   * writes themselves are untouched and each is idempotent, so a retry that
   * repeats only the missing steps is safe.
   *
   * `done` says what actually happened; a thrown error carries the same record
   * on `error.steps`, which is what lets the screen offer the rest and nothing
   * more.
   */
  const saveClassification = useCallback(
    async ({ learnRequest = null, transactionId, override = null, merchantScope = null } = {}) => {
      const done = { rule: null, override: false, merchant: false }
      try {
        let merchantId = merchantScope?.merchantId ?? null
        if (learnRequest) {
          done.rule = await repo.learnMerchantRule(user.id, learnRequest)
          // A merchant that did not exist yet gets its id from this call.
          merchantId = merchantId ?? done.rule?.merchant_id ?? null
        }
        if (override) {
          const current = overrides.find((o) => o.transaction_id === transactionId) ?? null
          await repo.saveOverride(user.id, transactionId, override, current)
          done.override = true
        }
        if (merchantScope && merchantId) {
          await repo.setMerchantAnalyticsDefault(user.id, merchantId, merchantScope.include)
          done.merchant = true
        }
        return done
      } catch (err) {
        err.steps = done
        throw err
      } finally {
        await load({ silent: true })
      }
    },
    [user, repo, load, overrides]
  )

  const value = useMemo(
    () => ({
      accounts,
      activeAccounts,
      archivedAccounts,
      account,
      imports,
      transactions,
      observations,
      categories,
      merchants,
      patterns,
      categoryRules,
      overrides,
      aiSuggestions,
      aiMemories,
      overrideTransactionIds: overrides.map((o) => o.transaction_id),
      loading,
      error,
      reload: () => load({ silent: true }),
      createAccount,
      updateAccount,
      archiveAccount,
      reactivateAccount,
      deleteEmptyAccount,
      findImport,
      openImport,
      applyPlan,
      createManualTransaction,
      applyAiImport,
      setAiMemoryActive,
      learnRule,
      saveOverride,
      setMerchantAnalytics,
      saveClassification,
    }),
    [accounts, activeAccounts, archivedAccounts, account, imports, transactions, observations,
     categories, merchants, patterns, categoryRules,
     overrides, aiSuggestions, aiMemories, loading, error, load, createAccount, findImport, openImport,
     applyPlan, learnRule, saveOverride, setMerchantAnalytics, saveClassification,
     createManualTransaction, applyAiImport, setAiMemoryActive,
     updateAccount, archiveAccount, reactivateAccount, deleteEmptyAccount]
  )

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
}

export function useFinance() {
  const ctx = useContext(FinanceContext)
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider')
  return ctx
}
