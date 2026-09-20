import { requireSupabase } from '../lib/supabase'
import { tokenize } from '../lib/finance/normalize'
import {
  pickFinanceAiMemoryPatch,
  pickFinancePatternPatch,
  pickFinanceTransactionPatch,
  pickWritableFinanceAccount,
  pickWritableFinanceImport,
  pickWritableFinanceOverride,
  pickWritableFinanceTransaction,
} from './financeDefaults'

// The Finanzen module in Supabase, and nowhere else. Every statement is scoped
// twice, exactly as taskRepository, listRepository and expenseRepository are:
// RLS in Postgres decides what the signed-in user may touch, and the explicit
// `user_id` filter keeps the intent visible in the query. The guard below is the
// third — a missing user id must never reach the network as a wide query over a
// table full of somebody's bank statements.
//
// There is no screen for any of this yet. What is here is what the engine needs
// to be exercised end to end: the reads that feed it, the two writes a
// classification consists of, and the two calls that must be atomic — learning
// a merchant rule, and applying a confirmed import plan.

function requireUser(userId) {
  if (!userId) throw new Error('Kein angemeldeter Benutzer.')
  return userId
}

const readAll = async (table, userId, order) => {
  let query = requireSupabase().from(table).select('*').eq('user_id', requireUser(userId))
  for (const [column, ascending] of order ?? []) query = query.order(column, { ascending })
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export const financeRepository = {
  listAccounts: (userId) => readAll('finance_accounts', userId, [['created_at', true]]),

  listCategories: (userId) => readAll('finance_categories', userId, [['sort_order', true]]),

  listMerchants: (userId) => readAll('finance_merchants', userId, [['canonical_name', true]]),

  // The matcher needs every active pattern of the account in one go; filtering
  // the inactive ones out here keeps that decision in one place.
  async listPatterns(userId, { activeOnly = true } = {}) {
    let query = requireSupabase()
      .from('finance_merchant_patterns')
      .select('*')
      .eq('user_id', requireUser(userId))
    if (activeOnly) query = query.eq('active', true)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  },

  async listCategoryRules(userId, { activeOnly = true } = {}) {
    let query = requireSupabase()
      .from('finance_category_rules')
      .select('*')
      .eq('user_id', requireUser(userId))
    if (activeOnly) query = query.eq('active', true)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  },

  // Newest first — the order every finance screen will ask for, and the one
  // `finance_transactions_user_date_idx` is built for.
  listTransactions: (userId) =>
    readAll('finance_transactions', userId, [
      ['booking_date', false],
      ['created_at', false],
    ]),

  listOverrides: (userId) => readAll('finance_transaction_overrides', userId, [['created_at', true]]),

  listImports: (userId) => readAll('finance_imports', userId, [['created_at', false]]),

  async createAccount(userId, data) {
    const { data: row, error } = await requireSupabase()
      .from('finance_accounts')
      .insert({ ...pickWritableFinanceAccount(data), user_id: requireUser(userId), name: data.name })
      .select()
      .single()
    if (error) throw error
    return row
  },

  /**
   * Name, Anbieter und Währung eines Kontos — in einem Aufruf, mit der
   * Währungsregel in der Datenbank.
   *
   * Bewusst kein `update` auf der Tabelle: die Regel „die Währung ist frei,
   * solange das Konto leer ist" (0013, Abschnitt 4) müsste sonst der Client
   * kennen und einhalten — und ein Client, der eine Regel einhält, IST keine
   * Regel. Die Benutzer-ID reist wie bei jedem anderen RPC hier nicht mit; die
   * Funktion liest `auth.uid()` selbst.
   */
  async updateAccount(userId, accountId, { name, provider = null, currency }) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_update_account', {
      p_account_id: accountId,
      p_name: name,
      p_provider: provider,
      p_currency: currency,
    })
    if (error) throw error
    return data
  },

  /**
   * Archivieren und Reaktivieren — dieselbe Handlung in zwei Richtungen, und
   * deshalb ein Aufruf mit einem Schalter. „Rückgängig" im Toast ist damit
   * buchstäblich derselbe Aufruf mit `false`.
   */
  async setAccountArchived(userId, accountId, archived) {
    requireUser(userId)
    if (typeof archived !== 'boolean') throw new Error('finance: Wert muss true oder false sein.')
    const { data, error } = await requireSupabase().rpc('finance_set_account_archived', {
      p_account_id: accountId,
      p_archived: archived,
    })
    if (error) throw error
    return data
  },

  /**
   * Ein leeres Konto endgültig löschen.
   *
   * Der einzige Löschweg, den die App kennt — und ausdrücklich kein
   * `.delete()` auf `finance_accounts`: die Fremdschlüssel aus 0008/0009
   * stehen auf `on delete cascade`, ein direktes Löschen nähme also jede
   * Buchung und jeden Import dieses Kontos wortlos mit. Die Funktion aus 0013
   * prüft vorher und lehnt ab.
   */
  async deleteEmptyAccount(userId, accountId) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_delete_empty_account', {
      p_account_id: accountId,
    })
    if (error) throw error
    return data ?? accountId
  },

  /**
   * The import row for a file that was already read once, or null.
   *
   * 0008 put a unique index on (user_id, source_hash) because "the same file
   * twice is the most likely import accident there is". Looking it up before
   * inserting turns that index from an error the user has to decipher into a
   * sentence the import flow can say.
   */
  async findImportBySourceHash(userId, sourceHash) {
    if (!sourceHash) return null
    // A plain select with a limit rather than `.maybeSingle()`: the unique index
    // already guarantees at most one row, and "no row" is the ordinary answer
    // here — not something to express as a 406 that every caller has to decode.
    const { data, error } = await requireSupabase()
      .from('finance_imports')
      .select('*')
      .eq('user_id', requireUser(userId))
      .eq('source_hash', sourceHash)
      .limit(1)
    if (error) throw error
    return data?.[0] ?? null
  },

  async createImport(userId, data) {
    const { data: row, error } = await requireSupabase()
      .from('finance_imports')
      .insert({ ...pickWritableFinanceImport(data), user_id: requireUser(userId) })
      .select()
      .single()
    if (error) throw error
    return row
  },

  // The tokens are DERIVED here and nowhere else — never taken from the
  // caller, which is why `normalized_tokens` is not in any writable whitelist.
  // They are the basis the database verifies a learning call against, so the
  // one thing that must be impossible is a booking whose tokens say something
  // its text does not. Written once, with the text, and frozen with it.
  async createTransaction(userId, data) {
    const payload = {
      ...pickWritableFinanceTransaction(data),
      user_id: requireUser(userId),
      normalized_tokens: tokenize(data.raw_description),
    }
    const { data: row, error } = await requireSupabase()
      .from('finance_transactions')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return row
  },

  // Only the interpretation half of a booking can be patched — the whitelist in
  // financeDefaults.js does not contain a single column of the raw half, so no
  // caller can rewrite what a booking said it was.
  async updateTransaction(userId, id, patch) {
    const { data: row, error } = await requireSupabase()
      .from('finance_transactions')
      .update({ ...pickFinanceTransactionPatch(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  // A pattern is never edited: what it matched yesterday it still matched
  // yesterday. Retiring one and writing a better one is the only way forward,
  // and the whitelist behind this makes that the only possible way.
  async deactivatePattern(userId, id) {
    const { data: row, error } = await requireSupabase()
      .from('finance_merchant_patterns')
      .update({ ...pickFinancePatternPatch({ active: false }), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  // One deliberate decision per booking, so this is an upsert on
  // `transaction_id` rather than an insert that a second click would duplicate.
  /**
   * One booking's manual decision — merchant, category, note, whether it counts.
   *
   * WHY `current` EXISTS. This is an upsert on `transaction_id`, and a partial
   * payload therefore relies on the server merging it into the row that is
   * already there. PostgREST does do that — it only writes the columns the
   * payload names — but a screen that saves a note must not depend on that
   * being true, in this version of PostgREST, for this shape of request. The
   * failure mode is silent and bad: a note is added and the merchant the user
   * picked last week disappears from the row.
   *
   * So the merge happens HERE, where it can be read and tested: the caller
   * passes the override it already holds, and the payload always carries every
   * writable column with its intended value. The result is then the same
   * whether the backend merges or replaces — which is the property worth
   * having. `null` stays a legitimate value (that is how a note is cleared);
   * only keys absent from BOTH sides are absent from the payload.
   *
   * @param {string} userId
   * @param {string} transactionId
   * @param {object} patch      the fields this save decides
   * @param {object|null} current the override as last read, or null if none
   */
  async saveOverride(userId, transactionId, patch, current = null) {
    const merged = {
      ...pickWritableFinanceOverride(current ?? {}),
      ...pickWritableFinanceOverride(patch ?? {}),
    }
    const { data: row, error } = await requireSupabase()
      .from('finance_transaction_overrides')
      .upsert(
        {
          ...merged,
          transaction_id: transactionId,
          user_id: requireUser(userId),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'transaction_id' }
      )
      .select()
      .single()
    if (error) throw error
    return row
  },

  /**
   * „Buchungen dieses Händlers zählen nicht." — one column, on purpose.
   *
   * Not a general merchant update: the only thing a screen may change about a
   * merchant from here is this default. `review_mode` is set when a merchant is
   * created, by the learning function, and `canonical_name` is what every
   * pattern hangs under; neither has any business in a switch about analytics.
   */
  async setMerchantAnalyticsDefault(userId, merchantId, include) {
    if (typeof include !== 'boolean') throw new Error('finance: Wert muss true oder false sein.')
    const { data: row, error } = await requireSupabase()
      .from('finance_merchants')
      .update({ default_include_in_analytics: include, updated_at: new Date().toISOString() })
      .eq('id', merchantId)
      .eq('user_id', requireUser(userId))
      .select()
      .single()
    if (error) throw error
    return row
  },

  async deleteOverride(userId, transactionId) {
    const { error } = await requireSupabase()
      .from('finance_transaction_overrides')
      .delete()
      .eq('transaction_id', transactionId)
      .eq('user_id', requireUser(userId))
    if (error) throw error
    return transactionId
  },

  /**
   * Merchant + pattern + rule + this booking + the bookings the pattern now
   * explains — in one transaction, or not at all.
   *
   * The request comes from buildLearnRequest (src/lib/finance/learning.js),
   * which is pure and tested; this only puts it on the wire. The user is not
   * passed along: the database function reads `auth.uid()` itself, so a client
   * cannot learn a rule into somebody else's account even if it tried. The
   * `requireUser` guard stays for the same reason it exists everywhere else —
   * a signed-out app makes no requests at all.
   */
  async learnMerchantRule(userId, request) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_learn_merchant_rule', request)
    if (error) throw error
    return data
  },

  // ── Reading what an import left behind ────────────────────────────────────
  // The three tables 0009 adds are read the same way as everything else: by the
  // signed-in user, with RLS deciding the rest.
  listObservations: (userId) =>
    readAll('finance_transaction_observations', userId, [['created_at', false]]),
  listRelations: (userId) =>
    readAll('finance_transaction_relations', userId, [['created_at', false]]),
  listRelationMembers: (userId) =>
    readAll('finance_transaction_relation_members', userId, [['created_at', true]]),

  async listOpenReviewItems(userId) {
    const { data, error } = await requireSupabase()
      .from('finance_import_review_items')
      .select('*')
      .eq('user_id', requireUser(userId))
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  /**
   * Apply a confirmed reconciliation plan — new bookings, observations,
   * relations, analytics and review items — in one transaction, or not at all.
   *
   * The payload comes from buildApplyPayload (src/lib/finance/dkb/plan.js),
   * which is pure and tested; this only puts it on the wire. As with
   * learnMerchantRule the user id is not sent: the function reads `auth.uid()`
   * itself and runs with invoker rights, so there is nothing here a client
   * could widen. Calling it twice for the same import is safe by design — the
   * second call returns the stored result with `replayed: true` and writes
   * nothing.
   */
  /**
   * Stand by a relation, or take it back.
   *
   * The counterpart to applying a plan, and the only supported way to undo an
   * analytics change an import made: the function restores exactly the bookings
   * that relation switched off, and never one the user excluded themselves.
   * Confirming a relation whose predecessor carries a manual decision is
   * refused rather than forced — the lock has to be cleared first.
   */
  async resolveRelation(userId, relationId, status, note = null) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_resolve_relation', {
      p_relation_id: relationId,
      p_status: status,
      p_note: note,
    })
    if (error) throw error
    return data
  },

  async resolveReviewItem(userId, itemId, status, resolution = null) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_resolve_review_item', {
      p_item_id: itemId,
      p_status: status,
      p_resolution: resolution,
    })
    if (error) throw error
    return data
  },

  listObservationSightings: (userId) =>
    readAll('finance_transaction_observation_sightings', userId, [['created_at', true]]),
  listReviewItemTransactions: (userId) =>
    readAll('finance_import_review_item_transactions', userId, [['created_at', true]]),

  async applyReconciliationPlan(userId, payload) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_apply_reconciliation_plan', {
      p_import_id: payload.import_id,
      p_account_id: payload.account_id,
      p_bookings: payload.bookings,
      p_decisions: payload.decisions,
      p_refund_candidates: payload.refund_candidates,
    })
    if (error) throw error
    return data
  },

  /**
   * Eine Buchung von Hand — die Buchung und die Entscheidung, in einer
   * Transaktion.
   *
   * Nicht `createTransaction` plus `saveOverride`: das sind zwei Aufrufe, und
   * der Abbruch dazwischen hinterlässt eine Buchung ohne die Notiz, die der
   * Nutzer gerade getippt hat. Die Funktion in 0011 macht beides oder nichts.
   * Der Payload kommt aus buildManualTransactionPayload
   * (src/lib/finance/manualTransaction.js), das pur und geprüft ist; hier wird
   * er nur auf die Leitung gelegt. Die Benutzer-ID reist wie bei den anderen
   * beiden RPCs nicht mit — die Funktion liest `auth.uid()` selbst.
   */
  async createManualTransaction(userId, payload) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_create_manual_transaction', payload)
    if (error) throw error
    return data
  },

  /**
   * Einen KI-Import anwenden — Buchungen, Vorschläge und die Korrekturen des
   * Nutzers, in einer Transaktion, und ein zweites Mal aufgerufen ohne jede
   * Wirkung.
   *
   * Der Payload kommt aus buildAIApplyPayload (src/lib/finance/ai/plan.js).
   */
  async applyAiImport(userId, payload) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_apply_ai_import', {
      p_import_id: payload.import_id,
      p_account_id: payload.account_id,
      p_bookings: payload.bookings,
    })
    if (error) throw error
    return data
  },

  // Was ein KI-Import vorgeschlagen hat. Heute liest das nichts ausser einem
  // spaeteren Blick von Hand; v1.24 lernt daraus, welche Vorschlaege der
  // Nutzer korrigiert hat.
  listAiSuggestions: (userId) =>
    readAll('finance_transaction_ai_suggestions', userId, [['created_at', false]]),

  // Das Gedächtnis (v1.24): was der Nutzer ausdrücklich für kommende KI-Importe
  // behalten wollte. Neueste zuerst — dieselbe Reihenfolge, in der der
  // Prompt-Builder sie begrenzt.
  listAiMemories: (userId) =>
    readAll('finance_ai_learning_memories', userId, [['created_at', false]]),

  /**
   * Eine Erinnerung abschalten — oder wieder einschalten.
   *
   * Der einzige Schreibvorgang, den der Client auf dieser Tabelle hat, und
   * bewusst der kleinste mögliche: angelegt werden die Zeilen in
   * `finance_apply_ai_import`, zusammen mit der Buchung, aus der sie stammen.
   * Hier wird nur `active` umgelegt, denn das ist die Zusage der Oberfläche —
   * deaktivieren, Toast, Rückgängig (§18/§19) statt „Wirklich löschen?".
   *
   * Der eindeutige Teilindex aus 0012 kann ein Wiedereinschalten ablehnen, wenn
   * inzwischen eine neue Regel für denselben Händler gilt. Das ist kein
   * Fehlverhalten, sondern die Regel „keine zwei gleichzeitigen Wahrheiten" —
   * der Aufrufer fängt den Fehler und sagt es.
   */
  async setAiMemoryActive(userId, memoryId, active) {
    requireUser(userId)
    const patch = pickFinanceAiMemoryPatch({ active, updated_at: new Date().toISOString() })
    const { data, error } = await requireSupabase()
      .from('finance_ai_learning_memories')
      .update(patch)
      .eq('id', memoryId)
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  /**
   * Eine einzelne Buchung endgültig löschen.
   *
   * Ausdrücklich kein `.delete()` auf `finance_transactions`, aus demselben
   * Grund wie bei `deleteEmptyAccount`: was an einer Buchung hängt, steht in
   * sechs Tabellen, und zwei davon räumt kein Fremdschlüssel auf (eine Relation,
   * die ihre zweite Seite verliert, und ein offener Prüfposten, der seine letzte
   * Buchung verliert). `finance_delete_transaction` (0015) macht beides in einer
   * Transaktion — oder nichts.
   *
   * Die Benutzer-ID reist nicht mit; die Funktion liest `auth.uid()` selbst.
   */
  async deleteTransaction(userId, transactionId) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_delete_transaction', {
      p_transaction_id: transactionId,
    })
    if (error) throw error
    return data ?? transactionId
  },

  /**
   * Den gesamten Finanzbereich des angemeldeten Nutzers zurücksetzen.
   *
   * KEIN PARAMETER, UND DAS IST DIE EIGENTLICHE ZUSAGE. Die Funktion in 0015
   * nimmt keine Benutzer-ID entgegen — es gibt hier also nichts, was ein Client
   * falsch oder böswillig setzen könnte. Was gelöscht wird, entscheidet
   * `auth.uid()` in der Datenbank.
   *
   * Zurück kommt, wie viele Zeilen je Tabelle verschwunden sind, plus die Zahl
   * der wiederhergestellten Standardkategorien.
   */
  async resetFinanceData(userId) {
    requireUser(userId)
    const { data, error } = await requireSupabase().rpc('finance_reset_user_data')
    if (error) throw error
    return data ?? null
  },
}
