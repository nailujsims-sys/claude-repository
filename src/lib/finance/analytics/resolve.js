import { newestSuggestions, resolveEffectiveClassification } from '../effectiveClassification'
import { analyticsInclusion } from './inclusion'
import { categoriesById, parentCategoryOf } from '../categories'
import { transactionEffect } from './effect'

// Eine Buchung, fertig ausgewertet — und der einzige Ort, an dem das passiert.
//
// WARUM DAS EINE EIGENE DATEI IST. Jede Kachel des Dashboards braucht dieselben
// fünf Antworten über jede Buchung: welche Kategorie gilt, welcher Händler,
// welche Buchungsart, zählt sie überhaupt, und was macht sie mit den Zahlen.
// Würde jede Kachel das selbst beantworten, gäbe es fünf Antworten auf dieselbe
// Frage, und die Summe der Kategorien wäre irgendwann eine andere als die
// KPI-Karte darüber. Also wird einmal aufgelöst, und alles rechnet danach nur
// noch zusammen.
//
// ES WIRD NICHTS NEU ERFUNDEN. Die Einordnung kommt aus
// `resolveEffectiveClassification` — derselben Rangfolge, die die
// Zuordnungs-Warteschlange und der Import benutzen (Override → manual_lock →
// eigene Regeln → KI-Vorschlag). Die Einbeziehung kommt aus `analyticsInclusion`
// (0010). Die Vorzeichen kommen aus `transactionEffect`. Diese Datei fügt
// zusammen; sie entscheidet nichts noch einmal.
//
// „NICHT ZUGEORDNET" IST EIN ERGEBNIS, KEIN FEHLER. Eine Buchung ohne Kategorie
// bekommt hier keine. Sie zählt in den Gesamtausgaben, sie erscheint in keiner
// Kategoriezeile, und wie viele es sind, steht als eigene Zahl im Dashboard.
// Sie still auf „Sonstiges" zu schieben wäre die eine Bequemlichkeit, die eine
// Auswertung unbrauchbar macht.

/** Der Name eines Händlers als Schlüssel — „REWE " und „rewe" sind derselbe. */
const merchantKeyOf = (name) => String(name ?? '').trim().toLowerCase()

/**
 * Alle Buchungen, einmal aufgelöst.
 *
 * @param {{
 *   transactions?: Array<object>,
 *   patterns?: Array<object>,
 *   merchants?: Array<object>,
 *   rules?: Array<object>,
 *   overrides?: Array<object>,
 *   aiSuggestions?: Array<object>,
 *   categories?: Array<object>,
 * }} input
 * @returns {Array<object>} ein Eintrag je Buchung, in Eingabereihenfolge
 */
export function resolveAnalyticsEntries({
  transactions = [],
  patterns = [],
  merchants = [],
  rules = [],
  overrides = [],
  aiSuggestions = [],
  categories = [],
} = {}) {
  const overrideBy = new Map(
    overrides.filter((o) => o?.transaction_id).map((o) => [o.transaction_id, o])
  )
  const suggestionBy = newestSuggestions(aiSuggestions)
  const byId = categoriesById(categories)
  const merchantById = new Map(merchants.filter((m) => m?.id).map((m) => [m.id, m]))

  return transactions.map((transaction) => {
    const override = overrideBy.get(transaction?.id) ?? null
    const suggestion = suggestionBy.get(transaction?.id) ?? null

    const classification = resolveEffectiveClassification({
      transaction,
      patterns,
      merchants,
      rules,
      override,
      suggestion,
    })

    const inclusion = analyticsInclusion({
      transaction,
      override,
      merchantMatch: classification.merchantMatch,
      merchants,
    })

    // Die Buchungsart: was ein Mensch über DIESE Buchung gesagt hat, sonst das,
    // was beim Import auf ihr stand. Dieselbe Rangfolge wie bei allem anderen.
    const transactionType =
      override?.transaction_type ?? transaction?.transaction_type ?? 'purchase'

    // Die Kategorie — und hier steht die eine Zeile, in der sich die Auswertung
    // von der Warteschlange unterscheidet, mit Absicht und aufgeschrieben:
    //
    //   `resolveCategory` traut `transaction.category_id` bewusst NICHT, solange
    //   niemand die Buchung gesperrt oder überschrieben hat — für die Frage
    //   „muss sich hier noch ein Mensch kümmern?" ist das richtig, denn die
    //   Spalte ist ein Zwischenstand von damals und die Regeln von heute sind
    //   die Antwort.
    //
    //   Für die Frage „unter welcher Kategorie ist dieses Geld ausgegeben
    //   worden?" ist es zu wenig. Ein KI-Import schreibt die erkannte Kategorie
    //   auf die Buchung (0012); sie hier zu ignorieren hieße, das Geld unter
    //   „nicht zugeordnet" zu zeigen, obwohl auf der Zeile eine Kategorie steht.
    //
    // Also dieselbe vierstufige Form wie bei `analyticsInclusion` (0010), und
    // die letzte Stufe ist dieselbe: was der Import geschrieben hat. Die
    // Warteschlange bleibt davon unberührt — `needsDecision` kommt weiterhin
    // ungefiltert aus der Einordnung, und eine Buchung mit Kategorie, aber ohne
    // erkannten Händler wartet weiterhin auf einen Menschen.
    const categoryId = classification.categoryId ?? transaction?.category_id ?? null
    const category = categoryId ? byId.get(categoryId) ?? null : null
    const parent = parentCategoryOf(byId, categoryId)

    // Der Händler, wie ihn eine Auswertung zählen muss: die Zeile, wenn es eine
    // gibt; sonst der Name, den ein Mensch getippt oder ein Modell erkannt hat.
    // Ein Händler wird hier nie erfunden — ohne eines von beidem bleibt es bei
    // null, und die Buchung taucht in keiner Händlerliste auf.
    const merchantId = classification.merchantId ?? null
    const merchantRow = merchantId ? merchantById.get(merchantId) ?? null : null
    const merchantName =
      merchantRow?.canonical_name ??
      classification.merchantName ??
      classification.aiMerchantName ??
      null
    const merchantKey = merchantId ?? (merchantName ? `name:${merchantKeyOf(merchantName)}` : null)

    const included = inclusion.included
    const amountMinor = Number.isFinite(transaction?.amount_minor) ? transaction.amount_minor : 0

    return {
      transaction,
      id: transaction?.id ?? null,
      accountId: transaction?.account_id ?? null,
      bookingDate: transaction?.booking_date ?? null,
      amountMinor,
      currency: transaction?.currency ?? 'EUR',
      description: transaction?.raw_description ?? '',
      transactionType,
      included,
      inclusionSource: inclusion.source,
      categoryId,
      category,
      parentCategoryId: parent?.id ?? null,
      parentCategory: parent,
      merchantId,
      merchant: merchantRow,
      merchantName,
      merchantKey,
      needsDecision: classification.needsDecision === true,
      classification,
      effect: transactionEffect({ amountMinor, transactionType, included }),
    }
  })
}
