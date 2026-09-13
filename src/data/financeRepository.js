import { requireSupabase } from '../lib/supabase'
import {
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
// classification consists of, and the one learning call that must be atomic.
// The import path is deliberately missing — no parser exists, and a repository
// method for a file format nobody has read yet would be a guess.

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

  async createImport(userId, data) {
    const { data: row, error } = await requireSupabase()
      .from('finance_imports')
      .insert({ ...pickWritableFinanceImport(data), user_id: requireUser(userId) })
      .select()
      .single()
    if (error) throw error
    return row
  },

  async createTransaction(userId, data) {
    const { data: row, error } = await requireSupabase()
      .from('finance_transactions')
      .insert({ ...pickWritableFinanceTransaction(data), user_id: requireUser(userId) })
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
  async saveOverride(userId, transactionId, decision) {
    const { data: row, error } = await requireSupabase()
      .from('finance_transaction_overrides')
      .upsert(
        {
          ...pickWritableFinanceOverride(decision),
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
}
