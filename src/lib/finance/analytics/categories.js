import { categoriesById } from '../categories'

// „Ausgaben nach Kategorie" — von unten nach oben gerechnet.
//
// DIE REIHENFOLGE IST DIE AUSSAGE. Erst zählt jede Unterkategorie ihre eigenen
// Buchungen zusammen, dann summieren sich die Unterkategorien zu ihrer
// Oberkategorie. Andersherum — erst grob, dann fein — bekäme man zwei Summen,
// die sich um die Rundungen und um jede Sonderbehandlung unterscheiden, und die
// Aufklappzeile widerspräche der Zeile darüber.
//
// DER PROZENTSATZ BEZIEHT SICH AUF ALLE EINBEZOGENEN AUSGABEN, nicht auf die
// Summe der zugeordneten. Eine Oberkategorie mit 421,40 € von 1.284,30 €
// Gesamtausgaben sind 33 % — auch wenn 200 € davon noch niemandem zugeordnet
// sind. Alles andere wäre eine Prozentzahl, die sich ändert, sobald jemand eine
// alte Buchung einsortiert, ohne dass sich an dieser Kategorie etwas getan hat.
//
// „NICHT ZUGEORDNET" BEKOMMT KEINE KATEGORIE. Es taucht als eigener Posten mit
// eigenem Betrag auf, und es ist Absicht, dass er nicht in der Liste der
// Kategorien steht: er ist kein Ausgabenbereich, er ist offene Arbeit.

/**
 * Die Ausgaben eines Zeitraums, nach Kategorie.
 *
 * @param {{entries?: Array<object>, categories?: Array<object>}} input
 * @returns {{
 *   parents: Array<object>,
 *   totalExpenses: number,
 *   assignedExpenses: number,
 *   unassigned: {amount: number, count: number, percentage: number|null},
 * }}
 */
export function categoryBreakdown({ entries = [], categories = [] } = {}) {
  const byId = categoriesById(categories)

  // Die Gesamtausgaben sind die Bezugsgröße jeder Prozentzahl unten — und sie
  // enthalten die nicht zugeordneten Buchungen.
  let totalExpenses = 0
  const leafTotals = new Map()
  const unassigned = { amount: 0, count: 0, percentage: null }

  for (const entry of entries) {
    if (!entry?.included) continue
    const expense = entry.effect?.expense ?? 0
    // Eine Buchung ohne Ausgabenwirkung (Einnahme, Umbuchung) gehört in keine
    // Ausgabenkategorie — auch dann nicht, wenn sie eine Kategorie trägt.
    if (expense === 0 && entry.transactionType !== 'refund') continue
    totalExpenses += expense

    if (!entry.categoryId) {
      unassigned.amount += expense
      unassigned.count += 1
      continue
    }

    const current = leafTotals.get(entry.categoryId) ?? { amount: 0, count: 0 }
    current.amount += expense
    current.count += 1
    leafTotals.set(entry.categoryId, current)
  }

  const share = (amount) =>
    totalExpenses > 0 ? (amount / totalExpenses) * 100 : null
  unassigned.percentage = share(unassigned.amount)

  // Aggregation über parent_id. Eine Zeile, die selbst eine Oberkategorie ist —
  // das kann nur alter Bestand sein, seit 0014 lässt die Datenbank es nicht mehr
  // zu — zählt bei sich selbst, statt aus der Summe zu fallen.
  const parents = new Map()
  const parentOf = (categoryId) => {
    const category = byId.get(categoryId)
    if (!category) return null
    return (category.parent_id ?? null) === null ? category : byId.get(category.parent_id) ?? null
  }

  for (const [categoryId, totals] of leafTotals) {
    const parent = parentOf(categoryId)
    const category = byId.get(categoryId) ?? null
    const key = parent?.id ?? categoryId
    const bucket =
      parents.get(key) ??
      { category: parent ?? category, amount: 0, count: 0, children: [] }
    bucket.amount += totals.amount
    bucket.count += totals.count
    // Eine Oberkategorie, die ihre eigenen Buchungen trägt, bekommt keine
    // Kindzeile über sich selbst.
    if (!parent || parent.id !== categoryId) {
      bucket.children.push({ category, amount: totals.amount, count: totals.count })
    }
    parents.set(key, bucket)
  }

  const rows = [...parents.values()]
    .map((bucket) => ({
      ...bucket,
      percentage: share(bucket.amount),
      children: bucket.children
        .map((child) => ({ ...child, percentage: share(child.amount) }))
        .sort((a, b) => b.amount - a.amount),
    }))
    // Nach Betrag, Name als Gleichstand — damit zwei gleich große Kategorien
    // nicht bei jedem Laden die Plätze tauschen.
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        String(a.category?.label ?? '').localeCompare(String(b.category?.label ?? ''), 'de')
    )

  return {
    parents: rows,
    totalExpenses,
    assignedExpenses: totalExpenses - unassigned.amount,
    unassigned,
  }
}
