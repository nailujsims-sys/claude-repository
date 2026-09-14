// Dedupe: the analysis, deliberately not yet the rule.
//
// WHY THERE IS NO RULE HERE YET. The real export settles two things and leaves
// one open.
//
// Settled 1 — identical bookings genuinely occur. Two bookings of the sample
// share a date (14.09.), an amount (−60.65) and a merchant ("Deutsche Bahn");
// they differ only in the minute embedded in their text (17:06 against 17:02).
// So date + amount, date + amount + merchant and date + amount + first line all
// collide on real data. A unique constraint over any of them would silently
// merge two real payments into one and make a spending total too small. Equal
// bookings have to survive as a multiset.
//
// Settled 2 — the full text does separate them, but only by accident of format.
// Those two carry the timestamped card variant. Two equally priced purchases at
// the same merchant on the same day in the ordinary card format would be
// textually identical, and a content hash would merge them.
//
// Open — the cross-import question. Whether a booking that appears once in one
// export reappears differently in the next, overlapping export cannot be
// answered from a single file, and it is exactly the case a wrong rule would
// get wrong forever. It gets decided with a second, overlapping export.
//
// Therefore: this module computes candidate components and reports what they
// would collide on. It writes no dedupe_hash, and nothing here is persisted.
// `finance_transactions.dedupe_hash` stays null until the decision is made on
// evidence — an unset column can be filled later, a wrong hash cannot be undone
// once bookings have been merged under it.

/**
 * The components a future rule could be built from, per booking. Everything
 * listed is either a fact the document states or a literal substring of it; no
 * component is derived by interpretation.
 *
 * @param {{booking_date: string, amount_minor: number, currency: string,
 *          raw_description: string, source_variant: string,
 *          source_metadata: object}} transaction
 * @returns {Record<string, string|number|boolean|null>}
 */
export function fingerprintComponents(transaction) {
  const meta = transaction?.source_metadata ?? {}
  return {
    booking_date: transaction?.booking_date ?? null,
    amount_minor: transaction?.amount_minor ?? null,
    currency: transaction?.currency ?? null,
    raw_description: transaction?.raw_description ?? '',
    first_line: (transaction?.raw_description ?? '').split('\n')[0] ?? '',
    source_variant: transaction?.source_variant ?? null,
    // Present on the timestamped variant only — which is precisely why it
    // cannot carry a general rule on its own.
    card_timestamp: meta.card_timestamp ?? null,
    card_transaction_date: meta.card_transaction_date ?? null,
  }
}

/** The candidate keys, each as a function of the components. */
export const FINGERPRINT_CANDIDATES = {
  date_amount: (c) => `${c.booking_date}|${c.amount_minor}`,
  date_amount_first_line: (c) => `${c.booking_date}|${c.amount_minor}|${c.first_line}`,
  date_amount_description: (c) => `${c.booking_date}|${c.amount_minor}|${c.raw_description}`,
  date_amount_description_without_timestamp: (c) =>
    `${c.booking_date}|${c.amount_minor}|${c.raw_description.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, 'T')}`,
}

/**
 * What each candidate would collide on, over one parsed export.
 *
 * This is an observation, not a verdict: a collision is not automatically a
 * duplicate. Two identical payments produce one, and so would a rule that is
 * too coarse — telling the two apart is what the second export is for.
 *
 * @param {Array<object>} transactions
 * @returns {Record<string, {unique: number, total: number, collisions: Array<{key: string, indexes: number[]}>}>}
 */
export function fingerprintReport(transactions) {
  const list = Array.isArray(transactions) ? transactions : []
  const components = list.map(fingerprintComponents)
  const report = {}
  for (const [name, keyOf] of Object.entries(FINGERPRINT_CANDIDATES)) {
    const groups = new Map()
    components.forEach((component, index) => {
      const key = keyOf(component)
      const bucket = groups.get(key)
      if (bucket) bucket.push(index)
      else groups.set(key, [index])
    })
    report[name] = {
      unique: groups.size,
      total: list.length,
      collisions: [...groups.entries()]
        .filter(([, indexes]) => indexes.length > 1)
        .map(([key, indexes]) => ({ key, indexes })),
    }
  }
  return report
}

/**
 * The bookings of one export that are indistinguishable by every candidate.
 * These are the ones a preview has to show side by side, because no rule this
 * module could write would ever tell them apart.
 *
 * @param {Array<object>} transactions
 * @returns {Array<{key: string, indexes: number[]}>}
 */
export function indistinguishable(transactions) {
  const report = fingerprintReport(transactions)
  return report.date_amount_description.collisions
}
