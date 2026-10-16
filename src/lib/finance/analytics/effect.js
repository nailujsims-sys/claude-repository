// Was eine Buchung mit den drei Zahlen des Dashboards macht — einmal, hier.
//
// DAS PROBLEM, DAS DIESE DATEI LÖST: ein Betrag steht so in der Datenbank, wie
// die Bank ihn gemeldet hat — Ausgaben negativ, Einnahmen positiv (0008). Eine
// Ausgabensumme ist aber positiv, eine Retoure senkt sie, eine Umbuchung ist
// keine von beiden, und eine ausgeschlossene Buchung ist gar nichts. Jede
// dieser vier Regeln ist für sich einfach und alle vier zusammen sind genau die
// Art Vorzeichenlogik, die sich sonst über zehn Komponenten verteilt und in der
// neunten falsch ist.
//
// DIE GANZE REGEL, in drei Zeilen:
//
//   ausgeschlossen oder Umbuchung  → 0 / 0 / 0
//   income                         → income = Betrag,  expense = 0
//   alles andere                   → expense = −Betrag, income = 0
//
//   cashflow = income − expense   (immer, ohne Ausnahme)
//
// Und damit stimmt jeder Fall aus der Vorgabe, ohne einen einzigen Sonderweg:
//
//   • Ein Kauf über −24,83 € ergibt eine Ausgabe von +24,83 €.
//   • Eine Retoure über +24,83 € ergibt eine Ausgabe von −24,83 € und senkt die
//     Summe — auch die ihrer Kategorie und ihres Händlers, weil sie dort auf
//     demselben Weg landet und nicht über eine zweite Regel.
//   • Eine Umbuchung zählt nirgends, auch nicht im Cashflow: Geld, das das eigene
//     Konto nicht verlassen hat, ist weder ausgegeben noch eingenommen.
//   • Eine Einnahme ist eine Einnahme und nie eine negative Ausgabe.
//   • `include_in_analytics = false` fällt vollständig heraus.
//
// Die Vorzeichen eines Betrags werden dabei NICHT „korrigiert": eine Retoure mit
// negativem Betrag (die es geben kann, wenn eine Bank sie so meldet) erhöht die
// Ausgaben, statt still als positiv gelesen zu werden. Netto ist netto.
//
// Alle Werte sind Minor Units (Cent), wie überall in diesem Modul.

/** Kein Beitrag zu gar nichts. */
export const EFFECT_ZERO = Object.freeze({ expense: 0, income: 0, cashflow: 0 })

/**
 * Der Beitrag einer Buchung zu Ausgaben, Einnahmen und Cashflow.
 *
 * @param {{
 *   amountMinor?: number,
 *   transactionType?: string,
 *   included?: boolean,
 * }} entry
 * @returns {{expense: number, income: number, cashflow: number}}
 */
export function transactionEffect({ amountMinor, transactionType, included = true } = {}) {
  const amount = Number.isFinite(amountMinor) ? amountMinor : 0
  if (included === false) return EFFECT_ZERO
  if (transactionType === 'transfer') return EFFECT_ZERO

  if (transactionType === 'income') {
    return { expense: 0, income: amount, cashflow: amount }
  }

  const expense = -amount
  return { expense, income: 0, cashflow: -expense }
}

/**
 * Ist das eine einzelne, echte Ausgabe?
 *
 * Die Frage, die „Größte Ausgaben" stellt — und sie ist strenger als
 * „expense > 0": eine Retoure senkt eine Summe, aber sie ist keine Ausgabe, die
 * man in einer Liste der größten Ausgaben sehen möchte. Umbuchungen und
 * Einnahmen sind es erst recht nicht.
 *
 * @param {{amountMinor?: number, transactionType?: string, included?: boolean}} entry
 * @returns {boolean}
 */
export function isRealExpense(entry) {
  if (!entry || entry.included === false) return false
  if (entry.transactionType === 'transfer') return false
  if (entry.transactionType === 'income') return false
  if (entry.transactionType === 'refund') return false
  return transactionEffect(entry).expense > 0
}

/**
 * Trägt diese Buchung zu einer Ausgabensumme bei?
 *
 * Die eine Frage, die jede Ausgaben-Aufteilung stellt — Kategorie, Händler,
 * Verlauf, und seit v1.27 jede Detailseite. Bis v1.26.2 stand sie als Zeile in
 * drei Dateien; drei gleichlautende Zeilen sind drei Stellen, an denen sie
 * auseinanderlaufen kann.
 *
 * Ja heißt: einbezogen UND mit Ausgabenwirkung — oder eine Retoure, auch eine
 * über 0 €, weil sie in derselben Liste stehen muss wie der Kauf, den sie
 * aufhebt. Einnahmen und Umbuchungen haben keine Ausgabenwirkung und fallen
 * damit heraus, auch wenn sie eine Kategorie tragen.
 *
 * @param {{included?: boolean, effect?: {expense?: number}, transactionType?: string}} entry
 * @returns {boolean}
 */
export function isExpenseContribution(entry) {
  if (!entry?.included) return false
  const expense = entry.effect?.expense ?? 0
  return expense !== 0 || entry.transactionType === 'refund'
}

/**
 * Die Summe vieler Beiträge.
 *
 * `cashflow` wird mitsummiert statt am Ende neu gebildet — beides ergibt
 * dasselbe, weil die Regel oben linear ist, und die Summe ist der billigere Weg.
 *
 * @param {Array<{expense: number, income: number, cashflow: number}>} effects
 */
export function sumEffects(effects = []) {
  let expense = 0
  let income = 0
  let cashflow = 0
  for (const effect of effects) {
    expense += effect?.expense ?? 0
    income += effect?.income ?? 0
    cashflow += effect?.cashflow ?? 0
  }
  return { expense, income, cashflow }
}
