import { FINANCE_STATUS, matchMerchant } from './merchantMatching'
import { resolveCategory } from './categoryRules'

// „Ist diese Buchung eingeordnet — und wenn nein, warum nicht?"
//
// EINE FRAGE, EINE ANTWORT, EIN ORT. Vor v1.23 gab es genau zwei Meinungen zu
// einer Buchung: was ein Mensch entschieden hat, und was die Pattern-Engine
// sagt. Seit dem KI-Import gibt es eine dritte, und genau da fängt der Ärger an:
// drei Meinungen ohne feste Rangfolge werden an drei Stellen im Code
// unterschiedlich aufgelöst, und dann zeigt der eine Screen eine offene
// Zuordnung, die der andere für erledigt hält. Deshalb steht die Rangfolge hier,
// einmal, und jeder Aufrufer bekommt dieselbe Antwort.
//
// DIE RANGFOLGE, von oben nach unten:
//
//   1. DER OVERRIDE — was der Mensch über GENAU DIESE Buchung entschieden hat.
//      Schlägt alles, heute und nach jeder künftigen Regeländerung. Als
//      Entscheidung zählt dabei jede Angabe zur Einordnung: eine Kategorie, ein
//      Händler aus der Liste, oder ein Händlername, den er selbst getippt hat.
//      Wer den Händler benennt und die Kategorie offen lässt, hat trotzdem
//      entschieden — und wird nicht noch einmal gefragt. Ein Override, der
//      NICHTS davon trägt (nur eine Notiz, nur „zählt nicht"), ist keine
//      Einordnung und sperrt deshalb auch keine.
//   2. `manual_lock` — die Buchung ist von Hand angelegt oder von Hand
//      entschieden worden. Eine Neuauswertung tritt darüber, nicht hinein.
//   3. DIE EIGENEN REGELN — Muster und Kategorieregeln, die der Nutzer selbst
//      angelegt hat. Sie gehen jedem Modellvorschlag vor, und zwar auch dann,
//      wenn sie zu keinem Ergebnis kommen: ein Konflikt zwischen zwei eigenen
//      Händlern und ein Händler, den der Nutzer ausdrücklich „immer prüfen"
//      gesetzt hat, sind Fragen an einen Menschen. Ein Sprachmodell darf sie
//      nicht wegdrücken.
//   4. DER KI-VORSCHLAG — aber nur, wenn er vollständig ist UND das Modell
//      selbst keine Unsicherheit gemeldet hat. Dann gilt der Umsatz als
//      ausreichend eingeordnet und wartet auf niemanden mehr.
//   5. Sonst: offen, und das ist die ehrliche Antwort.
//
// WAS EIN VORSCHLAG DADURCH NICHT WIRD. Er bleibt ein Vorschlag. Es entsteht
// kein `finance_merchants`-Eintrag, kein Muster, keine Kategorieregel — nichts,
// was die nächste Buchung eines anderen Händlers mitnehmen würde. Die
// gespeicherte Quelle bleibt `finance_transaction_ai_suggestions`, und die drei
// Ebenen — Modellvorschlag ≠ Nutzerentscheidung ≠ globale Lernregel — bleiben
// getrennt und einzeln nachvollziehbar. Was sich ändert, ist allein die Frage,
// ob dieser eine Umsatz noch jemanden beschäftigen muss.
//
// Pur, ohne React und ohne Supabase (siehe tools/financeAiLogic.mjs).

/**
 * Sagt dieser Override etwas über die EINORDNUNG der Buchung?
 *
 * Kategorie, Händler-Verknüpfung oder getippter Händlername — eines davon
 * reicht. Eine Notiz allein reicht nicht, und das ist der Unterschied, an dem
 * eine von Hand notierte Buchung ohne Einordnung in der Zuordnung bleibt,
 * während eine im Preview korrigierte daraus verschwindet.
 *
 * SEIT v1.26.2 IST „UMBUCHUNG" DIE VIERTE ANTWORT, und sie ist eine
 * vollständige. Wer sagt „das ist eine Umbuchung", hat diese Buchung fertig
 * eingeordnet: eine Umbuchung braucht keine Kategorie (sie taucht in keiner
 * Auswertung auf) und keinen Händler (das eigene zweite Konto ist keiner). Ohne
 * diese Zeile bliebe eine als Umbuchung markierte Buchung für immer in der
 * Warteschlange — der Nutzer hätte geantwortet und würde weiter gefragt.
 *
 * Nur `transfer`, und ausdrücklich keine andere Buchungsart: bei einem Kauf,
 * einer Retoure oder einer Einnahme bleibt die Frage nach Händler und Kategorie
 * offen, und eine Buchungsart allein beantwortet sie nicht.
 *
 * @param {{category_id?: string|null, merchant_id?: string|null,
 *          merchant_name?: string|null, transaction_type?: string|null}|null} override
 * @returns {boolean}
 */
export function overrideDecidesClassification(override) {
  if (!override || typeof override !== 'object') return false
  if (override.transaction_type === 'transfer') return true
  if (override.category_id) return true
  if (override.merchant_id) return true
  return typeof override.merchant_name === 'string' && override.merchant_name.trim() !== ''
}

/** Woher die gültige Einordnung einer Buchung kommt. */
export const CLASSIFICATION_SOURCE = Object.freeze({
  OVERRIDE: 'override',
  MANUAL_LOCK: 'manual_lock',
  RULE: 'rule',
  AI_SUGGESTION: 'ai_suggestion',
})

/**
 * Taugt dieser Vorschlag, um einen Umsatz als eingeordnet gelten zu lassen?
 *
 * Drei Bedingungen, alle drei nötig:
 *   • ein Händler ist erkannt,
 *   • eine Kategorie ist erkannt — und zwar eine, die es in dieser App gibt
 *     (der Parser hat eine erfundene längst auf null gesetzt),
 *   • das Modell hat keine Unsicherheit gemeldet.
 *
 * Fehlt eines davon, ist der Umsatz zu prüfen. Das ist dieselbe Schwelle, die
 * der Import-Preview benutzt, nur später gestellt — und sie ist bewusst streng:
 * ein halb erkannter Umsatz, der stillschweigend aus der Warteschlange fällt,
 * ist der Fehler, den niemand je bemerkt.
 *
 * @param {{merchant_name?: string|null, category_id?: string|null, needs_review?: boolean}|null} suggestion
 * @returns {boolean}
 */
export function isUsableSuggestion(suggestion) {
  if (!suggestion || typeof suggestion !== 'object') return false
  if (suggestion.needs_review === true) return false
  const merchant = typeof suggestion.merchant_name === 'string' ? suggestion.merchant_name.trim() : ''
  if (merchant === '') return false
  return typeof suggestion.category_id === 'string' && suggestion.category_id !== ''
}

/**
 * Der jüngste Vorschlag je Buchung.
 *
 * Es kann mehrere geben — eine Zeile je (Buchung, Import), und ein zweiter
 * Import darf eine Buchung anders sehen als der erste. Maßgeblich ist der
 * neueste; Gleichstand behält den zuerst gelesenen, was stabil ist, weil das
 * Repository in fester Reihenfolge liest.
 *
 * @param {Array<object>} suggestions
 * @returns {Map<string, object>} transaction_id → Vorschlag
 */
export function newestSuggestions(suggestions = []) {
  const best = new Map()
  for (const suggestion of suggestions) {
    const id = suggestion?.transaction_id
    if (!id) continue
    const previous = best.get(id)
    if (!previous || String(suggestion.created_at ?? '') > String(previous.created_at ?? '')) {
      best.set(id, suggestion)
    }
  }
  return best
}

/**
 * Die gültige Einordnung einer Buchung, und ob sie noch jemanden braucht.
 *
 * @param {{
 *   transaction: object,
 *   patterns?: Array<object>,
 *   merchants?: Array<object>,
 *   rules?: Array<object>,
 *   override?: object|null,
 *   suggestion?: object|null,
 * }} input
 */
export function resolveEffectiveClassification({
  transaction,
  patterns = [],
  merchants = [],
  rules = [],
  override = null,
  suggestion = null,
} = {}) {
  // Die Engine läuft IMMER, auch wenn ein Vorschlag danebenliegt: ihr Ergebnis
  // ist das, was jeder Screen über Händler und Muster anzeigt, und es entscheidet
  // die Stufen 1 bis 3. Nur ihr Ausgang „niemand kennt diesen Händler" macht
  // Platz für Stufe 4.
  const merchantMatch = matchMerchant({ transaction, patterns, merchants })
  const category = resolveCategory({ transaction, merchantMatch, rules, override })

  const base = {
    transaction,
    merchantMatch,
    category,
    status: category.status,
    merchantStatus: merchantMatch.status,
    locked: category.locked === true,
    merchantId: category.merchantId ?? merchantMatch.merchantId ?? null,
    categoryId: category.categoryId ?? null,
    reason: category.reason ?? null,
    source: sourceOf(category),
    // Der Händler, den ein Mensch benannt hat. Steht hier, weil er sonst
    // nirgends stünde: er ist kein `finance_merchants`-Eintrag, und genau das
    // ist Absicht.
    merchantName: override?.merchant_name ?? null,
    aiSuggestion: suggestion ?? null,
    aiMerchantName: null,
  }

  // Stufe 1, und sie kommt VOR `manual_lock`. `resolveCategory` sperrt an der
  // Kategorie — richtig für die Frage, die es beantwortet, und zu wenig für
  // diese hier: ein Override, der einen Händler benennt und die Kategorie offen
  // lässt, ist trotzdem eine Entscheidung. Und sie zuerst zu prüfen ist nicht
  // nur eine Frage der Reihenfolge, sondern der Ehrlichkeit: `manual_lock` ist
  // der billige Riegel, der Override ist das Protokoll. Wo beides dasteht, soll
  // die Antwort sagen, WAS entschieden wurde, nicht nur DASS.
  if (overrideDecidesClassification(override)) {
    return {
      ...base,
      status: base.categoryId ? FINANCE_STATUS.RESOLVED : FINANCE_STATUS.UNRESOLVED,
      locked: true,
      merchantId: override.merchant_id ?? base.merchantId,
      source: CLASSIFICATION_SOURCE.OVERRIDE,
      reason: 'manual_override',
      needsDecision: false,
    }
  }

  // Stufen 1–3 haben geantwortet: fertig, so oder so.
  if (base.locked || category.status !== FINANCE_STATUS.UNRESOLVED) {
    return { ...base, needsDecision: !base.locked && category.status !== FINANCE_STATUS.RESOLVED }
  }

  // Stufe 3 ohne Ergebnis heißt hier ausschließlich: kein eigener Händler passt.
  // Ein erkannter Händler ohne passende Regel (`no_rule_for_merchant`) ist etwas
  // anderes — da hat der Nutzer den Händler schon einmal bestätigt, und was ihm
  // fehlt, ist seine eigene Regel. Die schreibt kein Modell.
  const unknownMerchant = category.reason === 'merchant_unresolved'
  if (!unknownMerchant || !isUsableSuggestion(suggestion)) {
    return { ...base, needsDecision: true }
  }

  // Stufe 4. Der Umsatz gilt als eingeordnet — und bleibt es nur, solange der
  // Vorschlag vollständig ist. Löscht der Nutzer die vorgeschlagene Kategorie,
  // setzt der Fremdschlüssel sie auf null und die Buchung steht wieder hier.
  return {
    ...base,
    status: FINANCE_STATUS.RESOLVED,
    categoryId: suggestion.category_id,
    source: CLASSIFICATION_SOURCE.AI_SUGGESTION,
    aiMerchantName: suggestion.merchant_name,
    reason: 'ai_suggestion',
    needsDecision: false,
  }
}

/** Welche der oberen drei Stufen geantwortet hat, in der Sprache dieses Moduls. */
function sourceOf(category) {
  if (category.source === 'override') return CLASSIFICATION_SOURCE.OVERRIDE
  if (category.source === 'manual_lock') return CLASSIFICATION_SOURCE.MANUAL_LOCK
  if (category.status === FINANCE_STATUS.RESOLVED) return CLASSIFICATION_SOURCE.RULE
  return null
}
