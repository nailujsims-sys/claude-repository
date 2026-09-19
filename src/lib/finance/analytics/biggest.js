import { isRealExpense } from './effect'
import { categoryPath } from '../categories'

// „Größte Ausgaben" — die einzelnen Buchungen, die am meisten gekostet haben.
//
// WAS HIER NICHT REINGEHÖRT, und warum es ausdrücklich dasteht: eine Umbuchung
// von 2.000 € auf das eigene Tagesgeldkonto wäre sonst Platz eins, eine
// Gehaltszahlung Platz zwei und eine Retoure über 400 € Platz drei — drei
// Zeilen, von denen keine eine Ausgabe ist. `isRealExpense` beantwortet genau
// diese Frage, einmal, und es ist dieselbe Funktion, die auch die Tests stellen.
//
// Eine ausgeschlossene Buchung ist ebenfalls draußen: sie ist in keiner Summe
// dieses Bildschirms enthalten, also darf sie auch nicht als größte Ausgabe
// darüber stehen.

/**
 * Die größten einzelnen Ausgaben eines Zeitraums.
 *
 * @param {{entries?: Array<object>, categories?: Array<object>, limit?: number}} input
 * @returns {Array<object>}
 */
export function biggestExpenses({ entries = [], categories = [], limit = 3 } = {}) {
  return entries
    .filter(isRealExpense)
    .map((entry) => ({
      id: entry.id,
      amount: entry.effect.expense,
      bookingDate: entry.bookingDate,
      // Der Händler, wenn es einen gibt — sonst der Originaltext der Buchung.
      // Kein „Unbekannt", kein geratener Name.
      title: entry.merchantName ?? entry.description ?? '',
      hasMerchant: Boolean(entry.merchantName),
      merchantId: entry.merchantId,
      merchant: entry.merchant ?? null,
      category: categoryPath(categories, entry.categoryId),
      entry,
    }))
    // Betrag, dann Datum, dann id — drei gleich große Ausgaben stehen bei jedem
    // Laden in derselben Reihenfolge.
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        String(b.bookingDate ?? '').localeCompare(String(a.bookingDate ?? '')) ||
        String(a.id ?? '').localeCompare(String(b.id ?? ''))
    )
    .slice(0, Math.max(0, limit))
}
