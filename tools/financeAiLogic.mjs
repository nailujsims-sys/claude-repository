// Pure-logic tests for v1.23: die manuelle Buchung, der KI-Import und der
// Kontext-Prompt — ohne Datenbank und ohne Browser.
//
// Was hier geprüft wird, ist fast durchgehend, was die Module VERWEIGERN: kein
// geratener Betrag, kein erfundenes Datum, keine erfundene Kategorie, kein
// Händler aus einem Zahlungsdienstleister, keine Buchung, die still verschwindet.
// Ein Importer, der im Zweifel etwas Plausibles tut, ist genau der Importer, der
// eine falsche Zahl in eine Auswertung schreibt, die niemand mehr nachrechnet.
//
// Die drei Zusagen, die hier nicht beweisbar sind — Atomarität der beiden neuen
// Datenbankfunktionen, die Wiederholungssicherheit eines angewendeten Imports
// und dass ein bestehender Nutzer-Override nicht überschrieben wird — stehen in
// tools/financeAiE2E.mjs, weil sie Verhalten der Datenbank sind.
//
// Gebündelt mit esbuild wie die anderen Logik-Suiten.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import { AI_IMPORT_FORMAT, AI_IMPORT_VERSION, REVIEW_REASONS } from './src/lib/finance/ai/format.js'
import { amountToMinor, parseAIImport, validateAIImport } from './src/lib/finance/ai/parse.js'
import { aiDedupeKey, matchExisting } from './src/lib/finance/ai/dedupe.js'
import {
  applyRowEdit,
  buildAIApplyPayload,
  buildAIImportPlan,
  rowDiffersFromSuggestion,
  summarizeAIPlan,
} from './src/lib/finance/ai/plan.js'
import { buildAIContextPrompt, relevantMerchants } from './src/lib/finance/ai/prompt.js'
import { knownProviders } from './src/lib/finance/ai/providers.js'
import { aiSummaryLines, aiPreviewRow, reviewReasonText } from './src/lib/finance/ai/messages.js'
import {
  amountInputToMinor,
  buildManualTransactionPayload,
  typeForDirection,
} from './src/lib/finance/manualTransaction.js'
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS } from './src/config/finance.js'
import { tokenize } from './src/lib/finance/normalize.js'

let pass = 0
let fail = 0
const ok = (name, condition) => {
  if (condition) { pass += 1 }
  else { fail += 1; console.error('  FAIL: ' + name) }
}
const throws = (name, fn) => {
  try { fn(); ok(name, false) } catch { ok(name, true) }
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222'
const IMPORT = '33333333-3333-4333-8333-333333333333'

const CATEGORIES = [
  { id: 'cat-lebensmittel', slug: 'lebensmittel', label: 'Lebensmittel', sort_order: 10 },
  { id: 'cat-restaurant', slug: 'restaurant', label: 'Restaurant', sort_order: 20 },
  { id: 'cat-sonstige', slug: 'sonstige', label: 'Sonstige', sort_order: 50 },
]

const envelope = (transactions) =>
  JSON.stringify({ format: AI_IMPORT_FORMAT, version: AI_IMPORT_VERSION, transactions })

const RECORD = {
  booking_date: '2026-09-18',
  amount: -24.95,
  currency: 'EUR',
  raw_description: 'REWE TROISDORF SAGT DANKE 8407',
  merchant: 'REWE',
  category: 'lebensmittel',
  transaction_type: 'purchase',
  include_in_analytics: true,
  note: null,
  needs_review: false,
}

const readValid = (records) => {
  const parsed = parseAIImport(envelope(records))
  if (!parsed.ok) throw new Error('unerwartet abgelehnt: ' + JSON.stringify(parsed.errors))
  return validateAIImport(parsed.payload, { categories: CATEGORIES })
}

const stored = (over = {}) => ({
  id: over.id ?? 'tx-1',
  account_id: over.account_id ?? ACCOUNT,
  booking_date: over.booking_date ?? '2026-09-18',
  amount_minor: over.amount_minor ?? -2495,
  currency: over.currency ?? 'EUR',
  raw_description: over.raw_description ?? 'REWE TROISDORF SAGT DANKE 8407',
  normalized_tokens: tokenize(over.raw_description ?? 'REWE TROISDORF SAGT DANKE 8407'),
  ...over,
})

// ── 1. Beträge werden nie still verändert ───────────────────────────────────
{
  ok('−24,95 € als Zahl sind exakt −2495', amountToMinor(-24.95) === -2495)
  ok('−24,95 € als Text sind exakt −2495', amountToMinor('-24.95') === -2495)
  ok('0 ist ein Betrag', amountToMinor(0) === 0)
  ok('eine ganze Zahl ist ein Betrag', amountToMinor(19) === 1900)
  ok('drei Nachkommastellen sind kein Betrag', amountToMinor(-24.955) === null)
  ok('drei Nachkommastellen als Text auch nicht', amountToMinor('-24.955') === null)
  ok('Komma statt Punkt ist kein Betrag des Modells', amountToMinor('-24,95') === null)
  ok('ein Währungszeichen ist kein Betrag', amountToMinor('-24.95 €') === null)
  ok('leer ist kein Betrag', amountToMinor('') === null)
  ok('NaN ist kein Betrag', amountToMinor(Number.NaN) === null)
  ok('Unendlich ist kein Betrag', amountToMinor(Number.POSITIVE_INFINITY) === null)
  ok('ein Betrag jenseits des exakt Darstellbaren wird abgelehnt',
     amountToMinor(1e18) === null)
  ok('1.250,50 € über den Textweg sind 125050', amountToMinor('1250.50') === 125050)
}

// ── 2. Der Umschlag ─────────────────────────────────────────────────────────
{
  ok('ein gültiger v1-Umschlag wird gelesen', parseAIImport(envelope([RECORD])).ok)
  ok('leerer Text wird abgelehnt', parseAIImport('').errors[0].code === 'empty')
  ok('kaputter Text wird abgelehnt', parseAIImport('{ das ist kein JSON').errors[0].code === 'not_json')
  ok('ein Array statt eines Objekts wird abgelehnt',
     parseAIImport('[1,2,3]').errors[0].code === 'not_an_object')
  ok('ein fremdes Format wird abgelehnt',
     parseAIImport(JSON.stringify({ format: 'etwas-anderes', version: 1, transactions: [] })).errors[0].code === 'format_unknown')
  ok('eine falsche Version wird abgelehnt',
     parseAIImport(JSON.stringify({ format: AI_IMPORT_FORMAT, version: 2, transactions: [RECORD] })).errors[0].code === 'version_unsupported')
  ok('… und die Meldung nennt beide Versionen',
     parseAIImport(JSON.stringify({ format: AI_IMPORT_FORMAT, version: 7, transactions: [RECORD] })).errors[0].message.includes('7'))
  ok('fehlende Umsätze werden abgelehnt',
     parseAIImport(JSON.stringify({ format: AI_IMPORT_FORMAT, version: 1 })).errors[0].code === 'transactions_missing')
  ok('eine leere Liste wird abgelehnt',
     parseAIImport(envelope([])).errors[0].code === 'transactions_empty')
  ok('ein Markdown-Codeblock ist Verpackung, kein Fehler',
     parseAIImport('\`\`\`json\\n' + envelope([RECORD]) + '\\n\`\`\`').ok)
  ok('ein Satz davor ist Verpackung, kein Fehler',
     parseAIImport('Hier ist das Ergebnis:\\n' + envelope([RECORD])).ok)
  ok('nichts davon speichert etwas — der Parser gibt nur zurück',
     parseAIImport('kaputt').payload === null)
}

// ── 3. Jede Bank ist nach dem Einfügen dieselbe Bank ────────────────────────
{
  const dkb = readValid([{ ...RECORD, raw_description: 'REWE SAGT DANKE 8407' }])
  const n26 = readValid([{ ...RECORD, raw_description: 'REWE SAGT DANKE 8407' }])
  ok('derselbe Datensatz ergibt dasselbe Ergebnis, egal woher er stammt',
     JSON.stringify(dkb.entries) === JSON.stringify(n26.entries))

  const revolut = readValid([{ ...RECORD, currency: 'GBP', amount: -18.4, raw_description: 'TESCO LONDON' }])
  ok('eine ausländische Bank in Fremdwährung geht genauso durch', revolut.ok)
  ok('… und behält ihre Währung', revolut.entries[0].currency === 'GBP')
  ok('… und ihren Betrag', revolut.entries[0].amountMinor === -1840)
}

// ── 4. Was eine Zeile ablehnt ───────────────────────────────────────────────
{
  const codes = (records) => readValid(records).errors.map((e) => e.code)
  ok('ein fehlendes Datum ist ein Fehler',
     codes([{ ...RECORD, booking_date: undefined }]).includes('date_missing'))
  ok('ein Datum, das es nicht gibt, ist ein Fehler',
     codes([{ ...RECORD, booking_date: '2026-02-30' }]).includes('date_invalid'))
  ok('ein deutsches Datum ist ein Fehler, keine Umrechnung',
     codes([{ ...RECORD, booking_date: '18.09.2026' }]).includes('date_invalid'))
  ok('ein fehlender Betrag ist ein Fehler',
     codes([{ ...RECORD, amount: undefined }]).includes('amount_missing'))
  ok('null als Betrag ist ein Fehler, keine 0',
     codes([{ ...RECORD, amount: null }]).includes('amount_missing'))
  ok('ein unlesbarer Betrag ist ein Fehler',
     codes([{ ...RECORD, amount: 'ungefähr zwanzig' }]).includes('amount_invalid'))
  ok('eine fehlende Währung ist ein Fehler',
     codes([{ ...RECORD, currency: undefined }]).includes('currency_missing'))
  ok('eine erfundene Währung ist ein Fehler',
     codes([{ ...RECORD, currency: 'Euro' }]).includes('currency_invalid'))
  ok('eine fehlende Beschreibung ist ein Fehler',
     codes([{ ...RECORD, raw_description: '   ' }]).includes('description_missing'))
  ok('eine unbekannte Buchungsart ist ein Fehler',
     codes([{ ...RECORD, transaction_type: 'kauf' }]).includes('type_unknown'))
  ok('ein Fehler in einer Zeile speichert gar nichts',
     readValid([RECORD, { ...RECORD, amount: undefined }]).entries.length === 0)
  ok('… und die Meldung nennt die Zeile, die es war',
     readValid([RECORD, { ...RECORD, amount: undefined }]).errors[0].message.includes('2'))
}

// ── 5. Was eine Zeile in die Prüfung schickt, statt sie abzulehnen ──────────
{
  const one = (over) => readValid([{ ...RECORD, ...over }]).entries[0]

  const unknown = one({ category: 'urlaub' })
  ok('eine unbekannte Kategorie wird zu null', unknown.categoryId === null)
  ok('… und nicht auf die ähnlichste abgebildet', unknown.categorySlug === null)
  ok('… und die Zeile wandert in die Prüfung', unknown.needsReview === true)
  ok('… mit dem Grund, der es war',
     unknown.reviewReasons.includes(REVIEW_REASONS.CATEGORY_UNKNOWN))

  const noCategory = one({ category: null })
  ok('keine Kategorie ist erlaubt', noCategory.categoryId === null)
  ok('… und trotzdem zu prüfen', noCategory.needsReview === true)

  const noMerchant = one({ merchant: null })
  ok('merchant darf null sein', noMerchant.merchantName === null)
  ok('… und schickt die Zeile in die Prüfung', noMerchant.needsReview === true)
  ok('… mit dem passenden Grund',
     noMerchant.reviewReasons.includes(REVIEW_REASONS.MERCHANT_MISSING))

  const flagged = one({ needs_review: true })
  ok('needs_review vom Modell wird übernommen', flagged.needsReview === true)
  ok('… mit seinem eigenen Grund',
     flagged.reviewReasons.includes(REVIEW_REASONS.MODEL_UNSURE))

  const clean = one({})
  ok('eine vollständige Zeile muss nicht geprüft werden', clean.needsReview === false)
  ok('… und trägt die erkannte Kategorie', clean.categoryId === 'cat-lebensmittel')
  ok('… und den erkannten Händler', clean.merchantName === 'REWE')

  ok('eine fehlende Buchungsart wird aus dem Vorzeichen abgeleitet, nicht geraten',
     one({ transaction_type: undefined }).transactionType === 'purchase')
  ok('… und bei Geldeingang zur Einnahme',
     one({ transaction_type: undefined, amount: 120 }).transactionType === 'income')
  ok('include_in_analytics ist ohne Angabe true',
     one({ include_in_analytics: undefined }).includeInAnalytics === true)
  ok('include_in_analytics: false wird übernommen',
     one({ include_in_analytics: false }).includeInAnalytics === false)
  ok('eine Notiz wird übernommen', one({ note: 'Geburtstag' }).note === 'Geburtstag')
  ok('eine leere Notiz wird zu null', one({ note: '   ' }).note === null)
  ok('die Tokens kommen vom einen Normalisierer',
     one({}).normalizedTokens.join(' ') === tokenize(RECORD.raw_description).join(' '))
  ok('das Modell vergibt keine IDs, die irgendwo ankämen',
     one({ id: 'von-chatgpt' }).id === undefined)
}

// ── 6. Dedupe ist kontobezogen und exakt ────────────────────────────────────
{
  const entries = readValid([RECORD]).entries

  const same = matchExisting({ entries, existing: [stored()], accountId: ACCOUNT })
  ok('dieselbe Buchung im selben Konto ist ein Duplikat', same[0].existingId === 'tx-1')

  const elsewhere = matchExisting({
    entries, existing: [stored({ account_id: OTHER_ACCOUNT })], accountId: ACCOUNT,
  })
  ok('dieselbe Buchung auf einem anderen Konto ist kein Duplikat',
     elsewhere[0].existingId === null)

  ok('ein anderer Betrag ist eine andere Buchung',
     matchExisting({ entries, existing: [stored({ amount_minor: -2496 })], accountId: ACCOUNT })[0].existingId === null)
  ok('ein anderes Datum ist eine andere Buchung',
     matchExisting({ entries, existing: [stored({ booking_date: '2026-09-17' })], accountId: ACCOUNT })[0].existingId === null)
  ok('eine andere Währung ist eine andere Buchung',
     matchExisting({ entries, existing: [stored({ currency: 'CHF' })], accountId: ACCOUNT })[0].existingId === null)
  ok('ein anderer Text ist eine andere Buchung',
     matchExisting({ entries, existing: [stored({ raw_description: 'EDEKA TROISDORF' })], accountId: ACCOUNT })[0].existingId === null)
  ok('Groß-/Kleinschreibung und Leerraum unterscheiden nicht',
     matchExisting({ entries, existing: [stored({ raw_description: '  rewe   troisdorf sagt danke 8407 ' })], accountId: ACCOUNT })[0].existingId === 'tx-1')

  const richer = matchExisting({
    entries,
    existing: [stored({ raw_description: 'REWE' })],
    observations: [{ transaction_id: 'tx-1', observed_description: 'REWE TROISDORF SAGT DANKE 8407' }],
    accountId: ACCOUNT,
  })
  ok('der bessere Text einer früheren Beobachtung zählt als derselbe Umsatz',
     richer[0].existingId === 'tx-1')

  const twice = readValid([RECORD, RECORD]).entries
  const oneStored = matchExisting({ entries: twice, existing: [stored()], accountId: ACCOUNT })
  ok('zwei gleiche Ankömmlinge gegen eine gespeicherte Buchung: einer ist vorhanden',
     oneStored[0].existingId === 'tx-1')
  ok('… und der zweite ist neu', oneStored[1].existingId === null)

  ok('ein Abgleich ohne Konto wird verweigert, statt alles für neu zu halten',
     (() => { try { matchExisting({ entries, existing: [stored()] }); return false } catch { return true } })())

  ok('der Händlervorschlag der KI ist kein Bestandteil des Schlüssels',
     aiDedupeKey({ booking_date: '2026-09-18', amount_minor: -2495, currency: 'EUR', text: 'REWE' }) ===
     aiDedupeKey({ booking_date: '2026-09-18', amount_minor: -2495, currency: 'EUR', text: 'rewe' }))
}

// ── 7. Der Plan ─────────────────────────────────────────────────────────────
{
  const entries = readValid([
    RECORD,
    { ...RECORD, raw_description: 'EDEKA FLECK STUTTGART', amount: -12.3, merchant: 'EDEKA', category: 'urlaub' },
  ]).entries

  const plan = buildAIImportPlan({ entries, existing: [stored()], accountId: ACCOUNT })
  ok('jede Zeile bekommt genau eine Antwort', plan.rows.length === 2)
  ok('keine Zeile wird still verworfen', plan.summary.erkannt === 2)
  ok('die bereits gespeicherte ist „bereits vorhanden"', plan.rows[0].status === 'duplicate')
  ok('die andere ist neu', plan.rows[1].status === 'new')
  ok('die Zusammenfassung zählt richtig',
     plan.summary.neu === 1 && plan.summary.vorhanden === 1 && plan.summary.pruefen === 1)

  const payload = buildAIApplyPayload({ importId: IMPORT, accountId: ACCOUNT, rows: plan.rows })
  ok('nur die neuen Zeilen gehen an die Datenbank', payload.bookings.length === 1)
  ok('… mit dem Originaltext', payload.bookings[0].raw_description === 'EDEKA FLECK STUTTGART')
  ok('… mit dem Originalbetrag', payload.bookings[0].amount_minor === -1230)
  ok('… mit der Herkunft', payload.bookings[0].source_metadata.origin === 'ai_import')
  ok('… ohne zweites Exemplar des Betrags in den Metadaten',
     JSON.stringify(payload.bookings[0].source_metadata).includes('1230') === false)
  ok('… und mit dem Vorschlag daneben', payload.bookings[0].suggestion.merchant_name === 'EDEKA')
  ok('ein unveränderter Vorschlag ist keine Nutzerentscheidung',
     payload.bookings[0].user_decision === null)
  ok('… und wird auch nicht als Korrektur markiert',
     payload.bookings[0].suggestion.user_edited === false)

  throws('ein Payload ohne Import-ID wird verweigert',
         () => buildAIApplyPayload({ accountId: ACCOUNT, rows: plan.rows }))
  throws('ein Payload ohne Konto wird verweigert',
         () => buildAIApplyPayload({ importId: IMPORT, rows: plan.rows }))

  // Der zweite Durchlauf, als wäre derselbe Block noch einmal eingefügt worden,
  // nachdem er gespeichert wurde.
  const afterImport = [stored(), stored({ id: 'tx-2', raw_description: 'EDEKA FLECK STUTTGART', amount_minor: -1230 })]
  const again = buildAIImportPlan({ entries, existing: afterImport, accountId: ACCOUNT })
  ok('derselbe Block ein zweites Mal ergibt keine neue Buchung', again.summary.neu === 0)
  ok('… und der Payload ist leer',
     buildAIApplyPayload({ importId: IMPORT, accountId: ACCOUNT, rows: again.rows }).bookings.length === 0)

  const otherAccount = buildAIImportPlan({ entries, existing: afterImport, accountId: OTHER_ACCOUNT })
  ok('derselbe Block in ein anderes Konto ist vollständig neu', otherAccount.summary.neu === 2)
}

// ── 8. Korrigieren im Preview ───────────────────────────────────────────────
{
  const entries = readValid([{ ...RECORD, category: 'urlaub' }]).entries
  const plan = buildAIImportPlan({ entries, existing: [], accountId: ACCOUNT })
  const row = plan.rows[0]
  ok('die Zeile wartet auf Prüfung', row.needsReview === true)

  const fixed = applyRowEdit(row, { categoryId: 'cat-restaurant', note: ' Mittagessen ' })
  ok('die Korrektur greift', fixed.categoryId === 'cat-restaurant')
  ok('die Notiz wird beschnitten', fixed.note === 'Mittagessen')
  ok('der Vorschlag bleibt unangetastet', fixed.suggestion.categoryId === null)
  ok('die Zeile gilt als angefasst', fixed.edited === true)
  ok('… und zählt nicht mehr als zu prüfen', summarizeAIPlan([fixed]).pruefen === 0)
  ok('eine Korrektur unterscheidet sich vom Vorschlag', rowDiffersFromSuggestion(fixed) === true)

  ok('Datum lässt sich im Preview nicht ändern',
     applyRowEdit(row, { bookingDate: '2020-01-01' }).bookingDate === row.bookingDate)
  ok('Betrag lässt sich im Preview nicht ändern',
     applyRowEdit(row, { amountMinor: -1 }).amountMinor === row.amountMinor)
  ok('der Originaltext lässt sich im Preview nicht ändern',
     applyRowEdit(row, { rawDescription: 'etwas anderes' }).rawDescription === row.rawDescription)
  ok('eine unbekannte Buchungsart wird nicht übernommen',
     applyRowEdit(row, { transactionType: 'kauf' }).transactionType === row.transactionType)

  const payload = buildAIApplyPayload({ importId: IMPORT, accountId: ACCOUNT, rows: [fixed] })
  ok('eine echte Korrektur wird als Nutzerentscheidung geschickt',
     payload.bookings[0].user_decision?.category_id === 'cat-restaurant')
  ok('… und als solche markiert', payload.bookings[0].suggestion.user_edited === true)
  ok('… während der Vorschlag weiterhin sagt, was das Modell wollte',
     payload.bookings[0].suggestion.category_id === null)

  const confirmed = applyRowEdit(plan.rows[0], {})
  ok('„passt so" ohne Änderung ist keine Nutzerentscheidung',
     buildAIApplyPayload({ importId: IMPORT, accountId: ACCOUNT, rows: [confirmed] }).bookings[0].user_decision === null)
}

// ── 9. Der Prompt ───────────────────────────────────────────────────────────
{
  const merchants = [
    { id: 'm-rewe', canonical_name: 'REWE', review_mode: 'auto', default_include_in_analytics: true },
    { id: 'm-scalable', canonical_name: 'Scalable Capital', review_mode: 'auto', default_include_in_analytics: false },
    { id: 'm-edeka', canonical_name: 'EDEKA', review_mode: 'always_review', default_include_in_analytics: true },
  ]
  const patterns = [
    { id: 'p1', merchant_id: 'm-rewe', pattern_type: 'exact_token', tokens: ['REWE'], active: true },
    { id: 'p2', merchant_id: 'm-scalable', pattern_type: 'exact_phrase', tokens: ['SCALABLE', 'CAPITAL'], active: true },
    { id: 'p3', merchant_id: 'm-edeka', pattern_type: 'exact_token', tokens: ['EDEKA'], active: true },
  ]
  const rules = [
    { id: 'r1', merchant_id: 'm-rewe', category_id: 'cat-lebensmittel', active: true,
      min_amount_minor: null, max_amount_minor: null, currency: null },
    { id: 'r2', merchant_id: 'm-edeka', category_id: 'cat-restaurant', active: true,
      min_amount_minor: 3000, max_amount_minor: null, currency: 'EUR' },
  ]
  const transactions = [
    stored({ id: 't1', raw_description: 'REWE TROISDORF' }),
    stored({ id: 't2', raw_description: 'REWE KOELN' }),
    stored({ id: 't3', raw_description: 'PAYPAL .Zalando SE' }),
    stored({ id: 't4', raw_description: 'SCALABLE CAPITAL SPARPLAN' }),
  ]

  const prompt = buildAIContextPrompt({
    categories: CATEGORIES, merchants, patterns, categoryRules: rules, transactions,
    accountName: 'Girokonto', currency: 'EUR',
  })

  ok('der Prompt nennt jede aktuelle Kategorie',
     CATEGORIES.every((c) => prompt.includes(c.slug) && prompt.includes(c.label)))
  ok('… und verbietet neue', prompt.includes('Erfinde keine neuen Kategorien'))
  ok('der Prompt nennt die bekannten Händler',
     prompt.includes('REWE') && prompt.includes('Scalable Capital') && prompt.includes('EDEKA'))
  ok('… mit dem Muster, an dem sie erkannt werden', prompt.includes('SCALABLE CAPITAL'))
  ok('… und mit der Kategorie, die für sie gilt', prompt.includes('→ lebensmittel'))
  ok('der Prompt nennt die persönlichen Regeln',
     prompt.includes('Persönliche Regeln'))
  ok('… darunter die Betragsgrenze', prompt.includes('ab 30,00 €'))
  ok('… darunter „zählt nicht als Ausgabe"',
     prompt.includes('Scalable Capital zählt nicht als Ausgabe'))
  ok('… darunter „immer prüfen"', prompt.includes('EDEKA wird immer von Hand geprüft'))
  ok('… und sagt, dass sie vorgehen', prompt.includes('gehen jeder'))
  ok('der Prompt weist auf Zahlungsdienstleister hin',
     prompt.includes('Zahlungsdienstleister ist nicht der Händler'))
  ok('… und nennt den, der auf diesem Konto vorkommt',
     prompt.includes('Auf diesem Konto bereits aufgetaucht: PAYPAL'))
  ok('… und die weiteren', prompt.includes('KLARNA'))
  ok('der Prompt verbietet, den Ort als Händler zu nehmen',
     prompt.includes('Ein Ort ist kein Händler'))
  ok('… am konkreten Beispiel', prompt.includes('REWE Troisdorf'))
  ok('der Prompt fordert ausschließlich JSON',
     prompt.includes('Antworte ausschließlich mit diesem JSON'))
  ok('… ohne Vor- und Nachrede', prompt.includes('keine Erklärung'))
  ok('der Prompt nennt Format und Version',
     prompt.includes(AI_IMPORT_FORMAT) && prompt.includes('"version": ' + AI_IMPORT_VERSION))
  ok('der Prompt fordert needs_review bei Unsicherheit',
     prompt.includes('needs_review: true, sobald du dir') && prompt.includes('Lieber needs_review: true'))
  ok('… und sagt, was bei unklarem Händler zu tun ist',
     prompt.includes('schreibe null und setze needs_review: true'))
  ok('der Prompt verbietet, Buchungen zu erfinden', prompt.includes('erfinde keine dazu'))
  ok('der Prompt fordert, den Auszug vollständig zu lesen',
     prompt.includes('Lies den Auszug vollständig'))
  ok('der Prompt verbietet, Beträge zu ändern', prompt.includes('Ändere nie einen Betrag'))
  ok('der Prompt verbietet, Daten zu ändern', prompt.includes('nie geschätzt'))
  ok('der Prompt verlangt eine Währung', prompt.includes('currency: Pflichtfeld'))
  ok('der Prompt verbietet erfundene IDs', prompt.includes('Vergib keine IDs'))
  ok('der Prompt entscheidet nicht über das Konto',
     prompt.includes('das Konto ist in der App bereits gewählt'))
  ok('derselbe Datenstand ergibt denselben Prompt',
     prompt === buildAIContextPrompt({
       categories: CATEGORIES, merchants, patterns, categoryRules: rules, transactions,
       accountName: 'Girokonto', currency: 'EUR',
     }))

  const ranked = relevantMerchants({ merchants, patterns, transactions, categoryRules: rules, categories: CATEGORIES })
  ok('der häufigste Händler steht vorn', ranked[0].name === 'REWE')
  ok('ein deaktiviertes Muster zählt nicht mit',
     relevantMerchants({
       merchants, patterns: patterns.map((p) => ({ ...p, active: false })), transactions,
       categoryRules: rules, categories: CATEGORIES,
     })[0].count === 0)

  ok('nur die tatsächlich vorgekommenen Dienstleister gelten als bekannt',
     knownProviders(transactions).join(',') === 'PAYPAL')

  const leer = buildAIContextPrompt({ categories: [], merchants: [], patterns: [], categoryRules: [], transactions: [] })
  ok('ein leeres Konto bekommt trotzdem einen vollständigen Prompt',
     leer.includes(AI_IMPORT_FORMAT) && leer.includes('Zahlungsdienstleister'))
  ok('… und sagt ehrlich, dass noch nichts bekannt ist',
     leer.includes('Bisher sind keine Händler hinterlegt'))
}

// ── 10. Die Worte des Previews ──────────────────────────────────────────────
{
  const entries = readValid([RECORD, { ...RECORD, amount: -9.99, raw_description: 'BAECKER', merchant: null }]).entries
  const plan = buildAIImportPlan({ entries, existing: [stored()], accountId: ACCOUNT })

  const lines = aiSummaryLines(plan.summary)
  ok('die Zusammenfassung sagt, was neu ist', lines.some((l) => l.includes('1 neuer Umsatz')))
  ok('… was schon da war', lines.some((l) => l.includes('bereits gespeichert')))
  ok('… und was zu prüfen ist', lines.some((l) => l.includes('prüfen')))

  const duplicateView = aiPreviewRow(plan.rows[0], CATEGORIES)
  ok('eine vorhandene Buchung heißt „Bereits vorhanden"', duplicateView.status === 'Bereits vorhanden')
  ok('… und ist nicht änderbar', duplicateView.editable === false)

  const reviewView = aiPreviewRow(plan.rows[1], CATEGORIES)
  ok('eine unsichere neue Buchung heißt „Prüfen"', reviewView.status === 'Prüfen')
  ok('… ist änderbar', reviewView.editable === true)
  ok('… und sagt, warum', reviewView.reviewText.includes('Händler'))
  ok('der Betrag steht als Text da', reviewView.amount === '−9,99 €')

  ok('jeder Prüfgrund hat einen Satz',
     Object.values(REVIEW_REASONS).every((r) => reviewReasonText([r]) !== ''))
  ok('doppelte Gründe werden nicht doppelt genannt',
     reviewReasonText([REVIEW_REASONS.MODEL_UNSURE, REVIEW_REASONS.MODEL_UNSURE]) === 'Unsicher erkannt')
  ok('keine technische Sprache in den Preview-Texten',
     [...lines, reviewView.status, reviewView.reviewText].every(
       (t) => !/JSON|Schema|Parser|RPC|Payload/i.test(t)))
}

// ── 11. Die manuelle Buchung ────────────────────────────────────────────────
{
  const base = {
    accountId: ACCOUNT, amountInput: '24,95', date: '2026-09-18', description: 'REWE Troisdorf',
  }
  const build = (over = {}) => buildManualTransactionPayload({ ...base, ...over })

  const ausgabe = build({ direction: 'out' })
  ok('eine Ausgabe wird negativ gebucht', ausgabe.payload.p_amount_minor === -2495)
  ok('… als Kauf', ausgabe.payload.p_transaction_type === 'purchase')

  const einnahme = build({ direction: 'in' })
  ok('eine Einnahme wird positiv gebucht', einnahme.payload.p_amount_minor === 2495)
  ok('… als Einnahme', einnahme.payload.p_transaction_type === 'income')
  ok('typeForDirection sagt dasselbe',
     typeForDirection('in') === 'income' && typeForDirection('out') === 'purchase')

  ok('das gewählte Konto ist das Konto',
     build({ accountId: OTHER_ACCOUNT }).payload.p_account_id === OTHER_ACCOUNT)
  ok('eine Notiz landet im Payload', build({ note: 'Wocheneinkauf' }).payload.p_note === 'Wocheneinkauf')
  ok('eine leere Notiz wird zu null', build({ note: '   ' }).payload.p_note === null)
  ok('„zählt nicht" wird übernommen',
     build({ includeInAnalytics: false }).payload.p_include_in_analytics === false)
  ok('ohne Angabe zählt die Buchung',
     build({}).payload.p_include_in_analytics === true)
  ok('Händler und Kategorie werden mitgegeben, wenn gesetzt',
     build({ merchantId: 'm-rewe', categoryId: 'cat-lebensmittel' }).payload.p_category_id === 'cat-lebensmittel')
  ok('… beide',
     build({ merchantId: 'm-rewe', categoryId: 'cat-lebensmittel' }).payload.p_merchant_id === 'm-rewe')
  ok('ohne Kategorie bleibt sie null', build({}).payload.p_category_id === null)
  ok('die Tokens kommen vom einen Normalisierer',
     build({}).payload.p_normalized_tokens.join(' ') === 'REWE TROISDORF')
  ok('die Herkunft ist ehrlich', build({}).payload.p_source_metadata.origin === 'manual')
  ok('… und täuscht keine Datei vor',
     JSON.stringify(build({}).payload).includes('pdf') === false)
  ok('eine manuelle Buchung gehört zu keinem Import',
     build({}).payload.p_import_id === undefined)
  ok('die Währung des Kontos wird übernommen',
     build({ currency: 'CHF' }).payload.p_currency === 'CHF')

  ok('„1.250,50" wird deutsch gelesen', amountInputToMinor('1.250,50') === 125050)
  ok('„25" sind 25,00 €', amountInputToMinor('25') === 2500)
  ok('0 ist kein Betrag für eine manuelle Buchung', amountInputToMinor('0') === null)
  ok('drei Nachkommastellen sind kein Betrag', amountInputToMinor('24,999') === null)
  ok('Text ist kein Betrag', amountInputToMinor('viel') === null)

  ok('ohne Konto wird nicht gespeichert', build({ accountId: null }).ok === false)
  ok('ohne Betrag wird nicht gespeichert', build({ amountInput: '' }).ok === false)
  ok('ohne Datum wird nicht gespeichert', build({ date: '' }).ok === false)
  ok('ohne Beschreibung wird nicht gespeichert', build({ description: '  ' }).ok === false)
  ok('ein abgelehntes Formular liefert gar keinen Payload',
     build({ amountInput: '' }).payload === null)
  ok('… und sagt in einem Satz, was fehlt',
     build({ amountInput: '' }).errors.some((e) => e.includes('Betrag')))
}

// ── 12. Die Vokabel, die die Oberfläche benutzt ─────────────────────────────
{
  ok('jede Buchungsart hat einen deutschen Namen',
     TRANSACTION_TYPES.every((t) => typeof TRANSACTION_TYPE_LABELS[t] === 'string' && TRANSACTION_TYPE_LABELS[t] !== ''))
  ok('und keinen darüber hinaus',
     Object.keys(TRANSACTION_TYPE_LABELS).length === TRANSACTION_TYPES.length)
}

console.log(\`finance ai logic: \${pass} passed, \${fail} failed\`)
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeAiLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/financeAiLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
