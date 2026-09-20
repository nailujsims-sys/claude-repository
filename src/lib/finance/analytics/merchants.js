import { categoryPath } from '../categories'

// „Top-Händler" — wer wie viel gekostet hat.
//
// DER EFFEKTIVE HÄNDLER, NICHT DIE SPALTE. Welcher Händler zu einer Buchung
// gehört, beantwortet seit 0008 die Pattern-Engine; `transaction.merchant_id`
// ist ein Zwischenstand von damals. `resolveAnalyticsEntries` hat das bereits
// aufgelöst — hier wird nur noch gezählt, und zwar über `merchantKey`, der
// einen angelegten Händler an seiner ID führt und einen bloß benannten an
// seinem normalisierten Namen. Zwei Schreibweisen desselben getippten Namens
// sind damit ein Händler; zwei verschiedene Händler mit gleichem Namen wären es
// auch, aber genau das verhindert der eindeutige Index auf `finance_merchants`.
//
// KONTOÜBERGREIFEND. Ein Händler ist ein Händler, egal von welchem Konto
// bezahlt wurde. Die Auswahl der Konten hat schon vorher stattgefunden.
//
// RETOUREN ZÄHLEN NETTO, und zwar ohne eine einzige Zeile dafür: sie tragen
// über `transactionEffect` einen negativen Ausgabenbetrag bei. Ein Händler, bei
// dem mehr zurückkam als ausgegeben wurde, steht deshalb mit einem negativen
// Betrag da — und nicht ganz oben, weil sortiert wird, was tatsächlich gezahlt
// wurde.
//
// ES WIRD KEIN HÄNDLER ERFUNDEN. Eine Buchung, die niemandem zugeordnet ist,
// taucht in dieser Liste nicht auf — auch nicht als „Unbekannt".

/**
 * Die Händler eines Zeitraums, nach Ausgaben.
 *
 * @param {{entries?: Array<object>, categories?: Array<object>, limit?: number}} input
 * @returns {{merchants: Array<object>, total: number}}
 */
export function topMerchants({ entries = [], categories = [], limit = null } = {}) {
  const buckets = new Map()

  for (const entry of entries) {
    if (!entry?.included || !entry.merchantKey) continue
    const expense = entry.effect?.expense ?? 0
    if (expense === 0 && entry.transactionType !== 'refund') continue

    const bucket =
      buckets.get(entry.merchantKey) ??
      {
        key: entry.merchantKey,
        merchantId: entry.merchantId,
        merchant: entry.merchant ?? null,
        name: entry.merchantName ?? '',
        amount: 0,
        count: 0,
        categoryCounts: new Map(),
      }
    bucket.amount += expense
    bucket.count += 1
    if (entry.categoryId) {
      bucket.categoryCounts.set(
        entry.categoryId,
        (bucket.categoryCounts.get(entry.categoryId) ?? 0) + 1
      )
    }
    buckets.set(entry.merchantKey, bucket)
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.amount, 0)

  const rows = [...buckets.values()]
    .map((bucket) => {
      // Die Kategorie, unter der dieser Händler am häufigsten gebucht ist —
      // Beschriftung, keine Behauptung über die einzelne Buchung.
      let topCategoryId = null
      let best = 0
      for (const [categoryId, count] of bucket.categoryCounts) {
        if (count > best) {
          best = count
          topCategoryId = categoryId
        }
      }
      return {
        key: bucket.key,
        merchantId: bucket.merchantId,
        merchant: bucket.merchant,
        name: bucket.name,
        amount: bucket.amount,
        count: bucket.count,
        category: categoryPath(categories, topCategoryId),
      }
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'de'))

  return {
    merchants: Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows,
    total,
  }
}
