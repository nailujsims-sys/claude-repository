import { tokenize } from '../normalize'
import { TRANSACTION_TYPES, transactionTypeLabel } from '../../../config/finance'
import { PAYMENT_SERVICE_PROVIDERS } from './providers'

// Das Gedächtnis: was der Nutzer ausdrücklich für kommende KI-Importe behalten
// wollte, und was daraus im nächsten Prompt wird.
//
// DIE APP BESITZT DAS GEDÄCHTNIS, NICHT DAS MODELL. ChatGPT behält nichts
// zwischen zwei Unterhaltungen; alles, was „gelernt" aussieht, steht in dieser
// Datenbank und wird bei jedem „KI-Kontext kopieren" neu mitgeteilt. Deshalb
// sind diese Zeilen kein Cache, sondern das Produkt.
//
// WAS HIER NICHT PASSIERT — und das ist die eigentliche Entscheidung hinter der
// ganzen Datei: KEIN Ähnlichkeitsmaß, KEINE Tokenähnlichkeit, KEIN Fuzzy.
// „REWE TROISDORF" und „REWE Stuttgart" als denselben Fall zu erkennen ist
// genau die Abstraktion, die ein Sprachmodell gut kann und ein Tokenvergleich
// falsch. Also speichert die App den konkreten Fall und überlässt das
// Übertragen dem Modell — mit der ausdrücklichen Ansage, im Zweifel zu fragen.
//
// Die klassische Pattern-Engine bleibt davon unberührt. Sie entscheidet
// weiterhin alles, was sie heute entscheidet; aus einer KI-Korrektur entsteht
// nie ein Muster und nie ein `finance_merchants`-Eintrag.

/** Die drei Arten Wissen. Spiegelt den Check in 0012. */
export const MEMORY_KINDS = Object.freeze({
  EXAMPLE: 'similar_example',
  RULE: 'merchant_rule',
  PROVIDER: 'payment_provider',
})

/** Was der Nutzer im Preview wählen kann. */
export const LEARNING_MODES = Object.freeze({
  NONE: 'none',
  SIMILAR: 'similar',
  RULE: 'merchant_rule',
  PROVIDER: 'payment_provider',
})

const MODE_TO_KIND = Object.freeze({
  [LEARNING_MODES.SIMILAR]: MEMORY_KINDS.EXAMPLE,
  [LEARNING_MODES.RULE]: MEMORY_KINDS.RULE,
  [LEARNING_MODES.PROVIDER]: MEMORY_KINDS.PROVIDER,
})

/**
 * Wie viele Beispiele höchstens in einen Prompt wandern.
 *
 * Nicht, weil 40 eine magische Zahl wäre, sondern weil ein Kontext, der mit
 * jedem Import länger wird, irgendwann das verdrängt, wofür er da ist. Starke
 * Regeln und Dienstleister sind davon ausgenommen: die sind ausdrücklich
 * gesetzt, wenige, und jede einzelne ist eine Ansage.
 */
export const MAX_PROMPT_EXAMPLES = 40

/**
 * Die kanonische Vergleichsform eines Händlernamens.
 *
 * Spiegelt `public.finance_memory_key` aus 0012 — und zwar bewusst als Spiegel:
 * die Datenbank berechnet den Schlüssel, der über Eindeutigkeit entscheidet.
 * Diese Funktion ist für die Oberfläche (welche Regel gilt schon für diesen
 * Händler?) und für die Tests, die beide Seiten gegeneinander halten.
 *
 * @param {unknown} name
 * @returns {string|null}
 */
export function memoryKey(name) {
  const key = tokenize(name).join(' ')
  return key === '' ? null : key
}

const trimmed = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? null : text
}

/**
 * Was aus dieser Preview-Zeile gelernt würde — dieselbe Regel wie in 0012.
 *
 * DREI ZUSAGEN, und alle drei stehen auch im SQL, weil die Datenbank die
 * Wahrheit sagt und diese Funktion nur dasselbe vorher weiß:
 *
 *   • Die NOTIZ wird nie gelernt. Sie gehört zu dieser einen Buchung; als Regel
 *     für alles Kommende wäre sie Unsinn.
 *   • Die BUCHUNGSART nur, wenn sie vom Vorschlag abweicht. Ein `purchase`, das
 *     der Nutzer nie angefasst hat, ist die Voreinstellung des Modells und
 *     keine Entscheidung.
 *   • „ZÄHLT IN DER AUSWERTUNG" genauso.
 *
 * Datum, Betrag und Originalbeschreibung werden nie zur Regel. Die Beschreibung
 * wandert nur ins BEISPIEL, wo sie der Fall ist und nicht die Vorschrift.
 *
 * @param {object} row
 * @returns {{merchantName: string|null, categoryId: string|null,
 *            transactionType: string|null, includeInAnalytics: boolean|null}}
 */
export function learnedFields(row) {
  const suggestion = row?.suggestion ?? {}
  const merchantName = trimmed(row?.merchantName)
  const categoryId = row?.categoryId ?? null
  const transactionType =
    row?.transactionType && row.transactionType !== suggestion.transactionType
      ? row.transactionType
      : null
  const includeInAnalytics =
    typeof row?.includeInAnalytics === 'boolean' &&
    row.includeInAnalytics !== suggestion.includeInAnalytics
      ? row.includeInAnalytics
      : null
  return { merchantName, categoryId, transactionType, includeInAnalytics }
}

/**
 * Hat der Mensch an dieser Zeile etwas geändert, aus dem sich überhaupt lernen
 * lässt?
 *
 * DIE FRAGE IST EINE ANDERE ALS `rowHumanReview`, und beide haben recht. Wer
 * nur eine Notiz tippt, hat die Buchung bearbeitet — sie ist `corrected`, und
 * das soll sie auch bleiben: die Notiz ist eine echte menschliche Entscheidung
 * über diese eine Buchung, und für v1.24 ist genau das die richtige Auskunft.
 *
 * Nur LERNEN kann man daraus nichts. Eine Regel für kommende Importe kann nur
 * aus den Feldern entstehen, die der nächste Vorschlag auch wieder füllen
 * wird: Händler, Kategorie, Buchungsart, „zählt in der Auswertung". Eine Notiz
 * gehört zu dieser Buchung und zu keiner anderen — „Geschäftsessen" als Regel
 * für alles Kommende wäre Unsinn.
 *
 * Deshalb zwei Fragen statt einer: `rowHumanReview` beantwortet „was hat der
 * Mensch getan?", diese hier „gibt es daraus etwas zu lernen?". Die zweite ist
 * strenger, und an ihr hängt, ob „Für die Zukunft merken" überhaupt erscheint.
 *
 * @param {object} row
 * @returns {boolean}
 */
export function rowHasLearnableCorrection(row) {
  if (!row || typeof row !== 'object') return false
  const suggestion = row.suggestion ?? {}
  // Ein Händler, den der Mensch aus der Liste gewählt hat, ist eine Aussage —
  // auch wenn der Name danach derselbe ist wie der des Modells.
  if ((row.merchantId ?? null) !== null) return true
  if ((row.merchantName ?? null) !== (suggestion.merchantName ?? null)) return true
  if ((row.categoryId ?? null) !== (suggestion.categoryId ?? null)) return true
  if (row.transactionType !== suggestion.transactionType) return true
  if (row.includeInAnalytics !== suggestion.includeInAnalytics) return true
  return false
}

/** Sagt diese Zeile überhaupt etwas, das man als Händlerregel merken könnte? */
export function canLearnMerchantRule(row) {
  const learned = learnedFields(row)
  if (!learned.merchantName) return false
  return (
    learned.categoryId !== null ||
    learned.transactionType !== null ||
    learned.includeInAnalytics !== null
  )
}

/** Ist dieser Name einer der bekannten Zahlungsdienstleister? */
export function isKnownProvider(name) {
  const key = memoryKey(name)
  if (!key) return false
  return key.split(' ').some((token) => PAYMENT_SERVICE_PROVIDERS.includes(token))
}

/**
 * Die Umfänge, die für diese Zeile überhaupt zur Wahl stehen.
 *
 * `secondary` heißt: richtig, aber nicht das, wonach hier gefragt wird — die
 * Dienstleister-Option ist für PayPal eine naheliegende Antwort und für „REWE"
 * eine Falle. Sie verschwindet deshalb nicht, sie rückt eine Ebene tiefer.
 *
 * @param {object} row
 * @returns {Array<{mode: string, label: string, hint: string, secondary: boolean}>}
 */
export function learningOptions(row) {
  if (!rowHasLearnableCorrection(row)) return []
  const { merchantName } = learnedFields(row)
  const options = [
    {
      mode: LEARNING_MODES.NONE,
      label: 'Nur diese Buchung',
      hint: 'Nichts merken — die Korrektur gilt nur hier.',
      secondary: false,
    },
    {
      mode: LEARNING_MODES.SIMILAR,
      label: 'Ähnliche Buchungen',
      hint: 'Diese Korrektur als Beispiel für den nächsten Import merken.',
      secondary: false,
    },
  ]
  if (canLearnMerchantRule(row)) {
    options.push({
      mode: LEARNING_MODES.RULE,
      label: `Immer für ${merchantName}`,
      hint: 'Eine feste Regel, die künftig jeder allgemeinen Annahme vorgeht.',
      secondary: false,
    })
  }
  if (merchantName) {
    options.push({
      mode: LEARNING_MODES.PROVIDER,
      label: `${merchantName} als Zahlungsdienstleister behandeln`,
      hint: `${merchantName} ist dann nie der Händler — gesucht wird der echte Empfänger.`,
      secondary: !isKnownProvider(merchantName),
    })
  }
  return options
}

/**
 * Der Umfang, der von dieser Zeile tatsächlich abgeschickt werden darf.
 *
 * KEIN AUTOMATISCHES LERNEN: gemerkt wird nur, was der Mensch korrigiert UND
 * ausdrücklich gewählt hat. Eine Bestätigung („Passt so") erzeugt nie eine
 * Regel — das Modell lag dort ja richtig, und aus „richtig" eine Verallgemeinerung
 * zu machen ist eine Entscheidung, die der App nicht zusteht.
 *
 * @param {object} row
 * @param {'none'|'similar'|'merchant_rule'|'payment_provider'} [mode]
 * @returns {'none'|'similar'|'merchant_rule'|'payment_provider'}
 */
export function sanitizeLearningMode(row, mode = row?.learningMode) {
  if (!mode || mode === LEARNING_MODES.NONE) return LEARNING_MODES.NONE
  // Ohne lernbare Korrektur gibt es keinen Umfang — auch nicht den, der schon
  // gewählt war, bevor der Mensch seine Änderung zurückgenommen hat.
  if (!rowHasLearnableCorrection(row)) return LEARNING_MODES.NONE
  const allowed = learningOptions(row).map((option) => option.mode)
  return allowed.includes(mode) ? mode : LEARNING_MODES.NONE
}

// ── Das Gedächtnis lesen ────────────────────────────────────────────────────

const isActive = (memory) => memory?.active !== false

/** Die aktiven Erinnerungen, neueste zuerst — deterministisch sortiert. */
export function activeMemories(memories = []) {
  return memories
    .filter((memory) => memory && isActive(memory) && memory.kind)
    .slice()
    .sort((a, b) => {
      const byDate = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
      if (byDate !== 0) return byDate
      return String(a.id ?? '').localeCompare(String(b.id ?? ''))
    })
}

/**
 * Was in den Prompt gehört, in drei Töpfen.
 *
 * Starke Regeln und Dienstleister vollständig — sie sind wenige und jede ist
 * eine ausdrückliche Ansage. Beispiele begrenzt und ohne Wiederholungen: was
 * zweimal dasselbe sagt, sagt es nicht doppelt so überzeugend.
 *
 * @param {Array<object>} memories
 * @param {{limit?: number}} [options]
 */
export function promptMemories(memories = [], { limit = MAX_PROMPT_EXAMPLES } = {}) {
  const active = activeMemories(memories)
  const byName = (a, b) =>
    String(a.merchant_name ?? '').localeCompare(String(b.merchant_name ?? '')) ||
    String(a.id ?? '').localeCompare(String(b.id ?? ''))

  const rules = active.filter((m) => m.kind === MEMORY_KINDS.RULE).sort(byName)
  const providers = active.filter((m) => m.kind === MEMORY_KINDS.PROVIDER).sort(byName)

  const seen = new Set()
  const examples = []
  for (const memory of active) {
    if (memory.kind !== MEMORY_KINDS.EXAMPLE) continue
    // Der Schlüssel der Datenbank, wenn es ihn gibt; sonst derselbe Fall aus
    // seinen Teilen. Zwei Beispiele, die dasselbe lehren, sind eines.
    const key =
      memory.example_key ??
      [
        memoryKey(memory.source_description),
        memoryKey(memory.suggested_merchant_name),
        memory.suggested_category_id ?? '',
        memoryKey(memory.merchant_name),
        memory.category_id ?? '',
      ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    examples.push(memory)
    if (examples.length >= Math.max(0, limit)) break
  }

  return { rules, providers, examples }
}

// ── Worte ───────────────────────────────────────────────────────────────────

const categoryLabel = (categories, id) => {
  if (!id) return null
  const category = categories.find((c) => c?.id === id)
  return category?.label ?? category?.slug ?? null
}

/**
 * Was eine Erinnerung sagt — ein Satz, den ein Mensch lesen kann.
 *
 * Dieselben Worte im Prompt und in der Liste: was ChatGPT gesagt bekommt, soll
 * der Nutzer nachlesen können, ohne den Prompt zu kopieren.
 */
export function memorySentence(memory, categories = []) {
  const name = memory?.merchant_name ?? null
  const parts = []
  const label = categoryLabel(categories, memory?.category_id)
  if (label) parts.push(`Kategorie ${label}`)
  if (memory?.transaction_type && TRANSACTION_TYPES.includes(memory.transaction_type)) {
    parts.push(transactionTypeLabel(memory.transaction_type))
  }
  if (memory?.include_in_analytics === false) parts.push('zählt nicht in der Auswertung')
  if (memory?.include_in_analytics === true) parts.push('zählt in der Auswertung')

  if (memory?.kind === MEMORY_KINDS.PROVIDER) {
    return { title: name ?? 'Zahlungsdienstleister', detail: 'Zahlungsdienstleister, nie der Händler' }
  }
  if (memory?.kind === MEMORY_KINDS.RULE) {
    return { title: name ?? 'Regel', detail: parts.join(' · ') || 'Feste Regel' }
  }
  const suggested = categoryLabel(categories, memory?.suggested_category_id)
  const from = memory?.suggested_merchant_name ?? suggested ?? 'der Vorschlag'
  const to = name ?? label ?? 'deine Korrektur'
  return {
    title: memory?.source_description ?? 'Beispiel',
    detail: `${from} → ${to}${label && name ? ` · ${label}` : ''}`,
  }
}

/** Die Liste, gruppiert wie das Sheet sie zeigt. */
export function memoryGroups(memories = [], categories = []) {
  const active = activeMemories(memories)
  const group = (kind, title) => ({
    kind,
    title,
    items: (kind === MEMORY_KINDS.EXAMPLE
      ? promptMemories(active, { limit: Number.MAX_SAFE_INTEGER }).examples
      : active.filter((m) => m.kind === kind)
    ).map((memory) => ({ memory, ...memorySentence(memory, categories) })),
  })
  return [
    group(MEMORY_KINDS.RULE, 'Feste Regeln'),
    group(MEMORY_KINDS.PROVIDER, 'Zahlungsdienstleister'),
    group(MEMORY_KINDS.EXAMPLE, 'Beispiele'),
  ].filter((entry) => entry.items.length > 0)
}

/** Wie viele Erinnerungen gerade gelten. */
export const activeMemoryCount = (memories = []) => activeMemories(memories).length

/** Der Umfang als ein Wort, für die Zeile im geöffneten Editor. */
export function learningModeLabel(row, mode = row?.learningMode) {
  const chosen = sanitizeLearningMode(row, mode)
  const option = learningOptions(row).find((o) => o.mode === chosen)
  return option?.label ?? 'Nur diese Buchung'
}

/** Der Typ, den eine Auswahl in der Datenbank bekommt — für Tests und Prüfungen. */
export const kindForMode = (mode) => MODE_TO_KIND[mode] ?? null
