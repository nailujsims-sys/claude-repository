// Pure-logic tests for v1.24: aus einer Korrektur wird Wissen — aber nur, wenn
// der Mensch es sagt.
//
// Der Schwerpunkt liegt wieder auf dem, was die Module VERWEIGERN: keine Regel
// aus einer Bestätigung, keine Regel ohne Händler, keine gelernte Notiz, keine
// Buchungsart, die nur zufällig stehen blieb, kein Prompt, der mit jedem Import
// länger wird. Was die Datenbank durchsetzt — Eindeutigkeit, Ersetzen statt
// Verdoppeln, der Widerspruch zwischen Händlerregel und Dienstleister — steht in
// tools/financeLearningE2E.mjs, weil es Verhalten von Postgres ist.
//
// Gebündelt mit esbuild wie die anderen Logik-Suiten.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TEST = `
import {
  LEARNING_MODES,
  MAX_PROMPT_EXAMPLES,
  MEMORY_KINDS,
  activeMemories,
  activeMemoryCount,
  canLearnMerchantRule,
  isKnownProvider,
  kindForMode,
  learnedFields,
  learningModeLabel,
  learningOptions,
  memoryGroups,
  memoryKey,
  memorySentence,
  promptMemories,
  rowHasLearnableCorrection,
  sanitizeLearningMode,
} from './src/lib/finance/ai/memories.js'
import {
  applyRowEdit,
  buildAIApplyPayload,
  buildAIImportPlan,
  rowHumanReview,
} from './src/lib/finance/ai/plan.js'
import { buildAIContextPrompt } from './src/lib/finance/ai/prompt.js'
import { validateAIImport } from './src/lib/finance/ai/parse.js'
import { financeCategorySubset } from './tools/fixtures/financeCategories.mjs'

let pass = 0
let fail = 0
const ok = (name, condition) => {
  if (condition) { pass += 1 }
  else { fail += 1; console.error('  FAIL: ' + name) }
}

const IMPORT_ID = '11111111-2222-4333-8444-000000000001'
const ACCOUNT_ID = '11111111-2222-4333-8444-000000000002'
// Echte Zeilen mit echter Hierarchie (0014) — siehe tools/fixtures.
const CATEGORIES = financeCategorySubset(['lebensmittel', 'restaurant', 'sonstige'])

// Eine Preview-Zeile, wie buildAIImportPlan sie erzeugt — über den echten Weg,
// damit kein Test an einer Handattrappe vorbeiläuft.
function planRow(entry = {}) {
  const table = [
    'Datum;Beschreibung;Betrag;Waehrung;Haendler;Kategorie;Typ;Auswertung;Notiz;Pruefen',
    [
      entry.date ?? '2026-09-18',
      entry.description ?? 'REWE TROISDORF SAGT DANKE 8407',
      entry.amount ?? '-24,95',
      'EUR',
      entry.merchant ?? 'Troisdorf',
      entry.category ?? 'sonstige',
      entry.type ?? 'purchase',
      entry.include ?? 'true',
      entry.note ?? '',
      entry.review ?? 'true',
    ].join(';'),
  ].join('\\n')
  const checked = validateAIImport(
    { format: 'mind-whiteboard-finance-import', version: 1, bookings: [], raw: table },
    { categories: CATEGORIES }
  )
  return checked
}

// Der Weg über den Parser ist in tools/financeAiLogic.mjs schon bewiesen; hier
// zählt nur die Zeile, also wird sie direkt gebaut — mit exakt der Form, die
// buildAIImportPlan liefert.
function row(overrides = {}) {
  const plan = buildAIImportPlan({
    entries: [{
      index: 1,
      bookingDate: '2026-09-18',
      amountMinor: -2495,
      currency: 'EUR',
      rawDescription: overrides.rawDescription ?? 'REWE TROISDORF SAGT DANKE 8407',
      normalizedTokens: ['REWE', 'TROISDORF', 'SAGT', 'DANKE', '8407'],
      merchantName: overrides.suggestedMerchant === undefined ? 'Troisdorf' : overrides.suggestedMerchant,
      categoryId: overrides.suggestedCategory === undefined ? 'cat-sonstige' : overrides.suggestedCategory,
      categorySlug: 'sonstige',
      transactionType: overrides.suggestedType ?? 'purchase',
      includeInAnalytics: overrides.suggestedInclude ?? true,
      note: null,
      needsReview: true,
      reviewReasons: ['model_unsure'],
    }],
    existing: [],
    observations: [],
    accountId: ACCOUNT_ID,
  })
  return plan.rows[0]
}

const memory = (data) => ({
  id: data.id ?? 'mem-' + Math.random().toString(16).slice(2),
  user_id: 'user',
  kind: data.kind ?? MEMORY_KINDS.EXAMPLE,
  merchant_name: data.merchant_name ?? null,
  merchant_key: data.merchant_key ?? memoryKey(data.merchant_name),
  category_id: data.category_id ?? null,
  transaction_type: data.transaction_type ?? null,
  include_in_analytics: data.include_in_analytics ?? null,
  source_description: data.source_description ?? null,
  suggested_merchant_name: data.suggested_merchant_name ?? null,
  suggested_category_id: data.suggested_category_id ?? null,
  suggested_transaction_type: data.suggested_transaction_type ?? null,
  suggested_include_in_analytics: data.suggested_include_in_analytics ?? null,
  example_key: data.example_key ?? null,
  active: data.active !== false,
  created_at: data.created_at ?? '2026-09-18T10:00:00Z',
})

// ── 1. Was überhaupt gelernt werden darf ────────────────────────────────────
{
  const base = row()
  ok('eine unberührte Zeile merkt nichts', sanitizeLearningMode(base) === LEARNING_MODES.NONE)
  ok('… und rowHumanReview sagt none', rowHumanReview(base) === 'none')

  // „Passt so": bestätigt, nicht korrigiert.
  const bestaetigt = applyRowEdit(base, {})
  ok('eine Bestätigung ist keine Korrektur', rowHumanReview(bestaetigt) === 'confirmed')
  const bestaetigtMitWunsch = applyRowEdit(bestaetigt, { learningMode: LEARNING_MODES.RULE })
  const payloadB = buildAIApplyPayload({
    importId: IMPORT_ID, accountId: ACCOUNT_ID, rows: [bestaetigtMitWunsch],
  })
  ok('aus einer Bestätigung entsteht nie eine Regel',
     payloadB.bookings[0].learning.mode === 'none')
  ok('… und die Bestätigung selbst bleibt erhalten',
     payloadB.bookings[0].suggestion.human_review === 'confirmed')

  const korrigiert = applyRowEdit(base, { merchantName: 'REWE', categoryId: 'cat-lebensmittel' })
  ok('eine Korrektur ist eine Korrektur', rowHumanReview(korrigiert) === 'corrected')
  ok('… und merkt trotzdem erst einmal nichts',
     sanitizeLearningMode(korrigiert) === LEARNING_MODES.NONE)
  const payloadK = buildAIApplyPayload({
    importId: IMPORT_ID, accountId: ACCOUNT_ID, rows: [korrigiert],
  })
  ok('Korrektur ohne Auswahl schickt mode none', payloadK.bookings[0].learning.mode === 'none')
}

// ── 2. Die drei Umfänge ─────────────────────────────────────────────────────
{
  const korrigiert = applyRowEdit(row(), { merchantName: 'REWE', categoryId: 'cat-lebensmittel' })
  const modes = ['similar', 'merchant_rule', 'payment_provider']
  for (const mode of modes) {
    const gewaehlt = applyRowEdit(korrigiert, { learningMode: mode })
    const payload = buildAIApplyPayload({
      importId: IMPORT_ID, accountId: ACCOUNT_ID, rows: [gewaehlt],
    })
    ok('der Umfang ' + mode + ' reist mit', payload.bookings[0].learning.mode === mode)
  }

  const options = learningOptions(korrigiert).map((o) => o.mode)
  ok('vier Umfänge stehen zur Wahl', options.length === 4)
  ok('… „Nur diese Buchung" zuerst', options[0] === LEARNING_MODES.NONE)
  ok('… dann das Beispiel', options[1] === LEARNING_MODES.SIMILAR)
  ok('… die feste Regel trägt den Händlernamen',
     learningOptions(korrigiert)[2].label === 'Immer für REWE')
  ok('… die Dienstleister-Option liegt für REWE eine Ebene tiefer',
     learningOptions(korrigiert)[3].secondary === true)
  ok('die Voreinstellung heißt „Nur diese Buchung"',
     learningModeLabel(korrigiert) === 'Nur diese Buchung')
  ok('… und nach der Wahl die Regel',
     learningModeLabel(applyRowEdit(korrigiert, { learningMode: 'merchant_rule' })) ===
     'Immer für REWE')

  const paypal = applyRowEdit(row(), { merchantName: 'PayPal', categoryId: 'cat-lebensmittel' })
  ok('für PayPal steht die Dienstleister-Option oben',
     learningOptions(paypal).find((o) => o.mode === LEARNING_MODES.PROVIDER).secondary === false)
  ok('PayPal ist als Dienstleister bekannt', isKnownProvider('PayPal') === true)
  ok('PAYPAL .Zalando SE auch', isKnownProvider('PAYPAL .Zalando SE') === true)
  ok('REWE ist keiner', isKnownProvider('REWE') === false)
}

// ── 3. Ohne Händler keine Regel ─────────────────────────────────────────────
{
  const ohneHaendler = applyRowEdit(row({ suggestedMerchant: null }), {
    categoryId: 'cat-lebensmittel',
  })
  ok('ohne Händler gibt es keine feste Regel',
     canLearnMerchantRule(ohneHaendler) === false)
  const optionen = learningOptions(ohneHaendler).map((o) => o.mode)
  ok('… und sie wird auch nicht angeboten',
     !optionen.includes(LEARNING_MODES.RULE) && !optionen.includes(LEARNING_MODES.PROVIDER))
  ok('… ein trotzdem gesetzter Umfang fällt auf none zurück',
     sanitizeLearningMode(ohneHaendler, LEARNING_MODES.RULE) === LEARNING_MODES.NONE)
  const payload = buildAIApplyPayload({
    importId: IMPORT_ID,
    accountId: ACCOUNT_ID,
    rows: [applyRowEdit(ohneHaendler, { learningMode: LEARNING_MODES.RULE })],
  })
  ok('… und erreicht die Datenbank nicht', payload.bookings[0].learning.mode === 'none')
  ok('das Beispiel bleibt möglich', optionen.includes(LEARNING_MODES.SIMILAR))
}

// ── 4. Was gelernt wird, und was nie ────────────────────────────────────────
{
  const nurNotiz = applyRowEdit(row(), { note: 'Für die Steuer aufheben' })
  const felder = learnedFields(nurNotiz)
  ok('die Notiz taucht in keinem gelernten Feld auf',
     !Object.prototype.hasOwnProperty.call(felder, 'note') &&
     JSON.stringify(felder).indexOf('Steuer') === -1)

  const gleicheArt = applyRowEdit(row(), { merchantName: 'REWE', transactionType: 'purchase' })
  ok('eine unveränderte Buchungsart wird nicht gelernt',
     learnedFields(gleicheArt).transactionType === null)
  const andereArt = applyRowEdit(row(), { merchantName: 'REWE', transactionType: 'refund' })
  ok('eine geänderte schon', learnedFields(andereArt).transactionType === 'refund')

  const gleicheAuswertung = applyRowEdit(row(), { merchantName: 'REWE', includeInAnalytics: true })
  ok('ein unverändertes „zählt" wird nicht gelernt',
     learnedFields(gleicheAuswertung).includeInAnalytics === null)
  const andereAuswertung = applyRowEdit(row(), { merchantName: 'REWE', includeInAnalytics: false })
  ok('ein ausdrückliches „zählt nicht" schon',
     learnedFields(andereAuswertung).includeInAnalytics === false)

  // Ein Vorschlag, der schon „zählt nicht" sagte, und ein Nutzer, der dabei
  // bleibt: das ist die Meinung des Modells, nicht die des Menschen.
  const modellSagteNein = applyRowEdit(row({ suggestedInclude: false }), {
    merchantName: 'Scalable Capital', includeInAnalytics: false,
  })
  ok('… aber nur, wenn es vom Vorschlag abweicht',
     learnedFields(modellSagteNein).includeInAnalytics === null)

  const nurArt = applyRowEdit(row({ suggestedMerchant: null, suggestedCategory: null }),
                              { transactionType: 'refund' })
  ok('eine Regel ohne Händler bleibt unmöglich', canLearnMerchantRule(nurArt) === false)
  const artMitHaendler = applyRowEdit(row({ suggestedCategory: null }), {
    merchantName: 'REWE', transactionType: 'refund',
  })
  ok('eine Abweichung allein trägt eine Regel',
     canLearnMerchantRule(artMitHaendler) === true)
  const nurNameGeaendert = applyRowEdit(row({ suggestedCategory: null }), { merchantName: 'REWE' })
  ok('ein Name allein trägt keine Regel', canLearnMerchantRule(nurNameGeaendert) === false)

  ok('der Umfang kennt seine Art in der Datenbank',
     kindForMode('merchant_rule') === MEMORY_KINDS.RULE &&
     kindForMode('payment_provider') === MEMORY_KINDS.PROVIDER &&
     kindForMode('similar') === MEMORY_KINDS.EXAMPLE &&
     kindForMode('none') === null)
}

// ── 4b. Review und Lernen sind zwei Fragen ──────────────────────────────────
//
// Eine geänderte Notiz ist eine echte Korrektur dieser einen Buchung — und
// trotzdem nichts, woraus sich für kommende Importe etwas lernen ließe. Beide
// Auskünfte müssen nebeneinander stimmen.
{
  // A) NUR NOTIZ
  const nurNotiz = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-lebensmittel' }),
    { note: 'Geschäftsessen' }
  )
  ok('A: eine geänderte Notiz bleibt eine Korrektur',
     rowHumanReview(nurNotiz) === 'corrected')
  ok('A: … aber keine lernbare', rowHasLearnableCorrection(nurNotiz) === false)
  ok('A: … es wird kein Umfang angeboten', learningOptions(nurNotiz).length === 0)
  ok('A: … ein trotzdem gesetzter fällt auf none',
     sanitizeLearningMode(nurNotiz, LEARNING_MODES.SIMILAR) === LEARNING_MODES.NONE)
  const payloadA = buildAIApplyPayload({
    importId: IMPORT_ID, accountId: ACCOUNT_ID,
    rows: [applyRowEdit(nurNotiz, { learningMode: LEARNING_MODES.RULE })],
  })
  ok('A: … und der Payload schickt none', payloadA.bookings[0].learning.mode === 'none')
  ok('A: die Notiz selbst wird trotzdem gespeichert',
     payloadA.bookings[0].user_decision.note === 'Geschäftsessen')
  ok('A: … und die Korrektur bleibt als solche vermerkt',
     payloadA.bookings[0].suggestion.human_review === 'corrected')

  // B) HÄNDLER-KORREKTUR bei bereits richtiger Kategorie
  const haendler = applyRowEdit(
    row({ suggestedMerchant: 'Troisdorf', suggestedCategory: 'cat-lebensmittel' }),
    { merchantName: 'REWE' }
  )
  ok('B: ein korrigierter Händler ist lernbar', rowHasLearnableCorrection(haendler) === true)
  ok('B: … alle drei Umfänge stehen zur Wahl',
     learningOptions(haendler).length === 4)
  ok('B: … und die feste Regel trägt die sichtbare Kategorie',
     canLearnMerchantRule(haendler) === true &&
     learnedFields(haendler).categoryId === 'cat-lebensmittel')
  const payloadB = buildAIApplyPayload({
    importId: IMPORT_ID, accountId: ACCOUNT_ID,
    rows: [applyRowEdit(haendler, { learningMode: LEARNING_MODES.RULE })],
  })
  ok('B: … der Umfang reist mit', payloadB.bookings[0].learning.mode === 'merchant_rule')

  // Ein Händler aus der Liste ist auch dann eine Aussage, wenn der Name gleich
  // bleibt: der Mensch hat ihn ausgewählt.
  const verknuepft = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-lebensmittel' }),
    { merchantId: 'm-rewe', merchantName: 'REWE' }
  )
  ok('B: eine bewusste Verknüpfung ist lernbar',
     rowHasLearnableCorrection(verknuepft) === true)

  // C) KATEGORIE-KORREKTUR
  const kategorie = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-sonstige' }),
    { categoryId: 'cat-lebensmittel' }
  )
  ok('C: eine korrigierte Kategorie ist lernbar',
     rowHasLearnableCorrection(kategorie) === true)

  // D) ART-KORREKTUR
  const art = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-lebensmittel' }),
    { transactionType: 'refund' }
  )
  ok('D: eine korrigierte Buchungsart ist lernbar', rowHasLearnableCorrection(art) === true)
  ok('D: … und trägt eine Regel', canLearnMerchantRule(art) === true)

  // E) INCLUDE-KORREKTUR
  const auswertung = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-lebensmittel' }),
    { includeInAnalytics: false }
  )
  ok('E: ein korrigiertes „zählt nicht" ist lernbar',
     rowHasLearnableCorrection(auswertung) === true)
  ok('E: … und wird gelernt', learnedFields(auswertung).includeInAnalytics === false)

  // F) NOTIZ + KATEGORIE
  const beides = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-sonstige' }),
    { categoryId: 'cat-lebensmittel', note: 'Geschäftsessen' }
  )
  ok('F: Notiz plus Kategorie ist lernbar — wegen der Kategorie',
     rowHasLearnableCorrection(beides) === true)
  const payloadF = buildAIApplyPayload({
    importId: IMPORT_ID, accountId: ACCOUNT_ID,
    rows: [applyRowEdit(beides, { learningMode: LEARNING_MODES.RULE })],
  })
  ok('F: … der Umfang reist mit', payloadF.bookings[0].learning.mode === 'merchant_rule')
  ok('F: … die Notiz steht in der Entscheidung',
     payloadF.bookings[0].user_decision.note === 'Geschäftsessen')
  ok('F: … und in keinem gelernten Feld',
     JSON.stringify(learnedFields(beides)).indexOf('Geschäftsessen') === -1)

  // Eine Bestätigung hat ohnehin nichts geändert.
  const bestaetigt = applyRowEdit(
    row({ suggestedMerchant: 'REWE', suggestedCategory: 'cat-lebensmittel' }), {}
  )
  ok('eine Bestätigung ist nie lernbar', rowHasLearnableCorrection(bestaetigt) === false)

  // Und wer die Kategorie zurückdreht, aber die Notiz stehen lässt, ist wieder
  // bei A: bearbeitet, aber nichts zu lernen.
  const zurueck = applyRowEdit(beides, { categoryId: 'cat-sonstige' })
  ok('eine zurückgenommene Kategorie nimmt die Lernbarkeit mit',
     rowHumanReview(zurueck) === 'corrected' && rowHasLearnableCorrection(zurueck) === false)
  ok('… und den gewählten Umfang', sanitizeLearningMode(zurueck) === LEARNING_MODES.NONE)
}

// ── 5. Eine zurückgenommene Korrektur nimmt die Regel mit ───────────────────
{
  const korrigiert = applyRowEdit(row(), {
    merchantName: 'REWE', categoryId: 'cat-lebensmittel', learningMode: 'merchant_rule',
  })
  ok('die Regel steht', sanitizeLearningMode(korrigiert) === 'merchant_rule')
  const zurueck = applyRowEdit(korrigiert, {
    merchantName: 'Troisdorf', categoryId: 'cat-sonstige',
  })
  ok('wer die Korrektur zurücknimmt, nimmt die Regel mit',
     rowHumanReview(zurueck) === 'confirmed' && sanitizeLearningMode(zurueck) === 'none')
}

// ── 6. Der Vergleichsschlüssel ──────────────────────────────────────────────
{
  ok('Schreibweise, Satzzeichen und Leerraum zählen nicht',
     memoryKey('REWE') === memoryKey('rewe') &&
     memoryKey('Rewe  Markt!') === 'REWE MARKT' &&
     memoryKey(' rewe-markt ') === 'REWE MARKT')
  ok('Umlaute bleiben erhalten', memoryKey('Bäckerei Müller') === 'BÄCKEREI MÜLLER')
  ok('nichts bleibt nichts', memoryKey('') === null && memoryKey(null) === null &&
     memoryKey('   ') === null && memoryKey('!!!') === null)
  ok('Ziffern bleiben', memoryKey('Aral 4711') === 'ARAL 4711')
}

// ── 7. Das Gedächtnis lesen ─────────────────────────────────────────────────
{
  const rewe = memory({
    kind: MEMORY_KINDS.RULE, merchant_name: 'REWE', category_id: 'cat-lebensmittel',
    created_at: '2026-09-18T12:00:00Z', id: 'a',
  })
  const paypal = memory({
    kind: MEMORY_KINDS.PROVIDER, merchant_name: 'PayPal',
    created_at: '2026-09-18T11:00:00Z', id: 'b',
  })
  const beispiel = memory({
    kind: MEMORY_KINDS.EXAMPLE, merchant_name: 'REWE', category_id: 'cat-lebensmittel',
    source_description: 'REWE TROISDORF SAGT DANKE 8407',
    suggested_merchant_name: 'Troisdorf', suggested_category_id: 'cat-sonstige',
    example_key: 'k1', created_at: '2026-09-18T10:00:00Z', id: 'c',
  })
  const aus = memory({
    kind: MEMORY_KINDS.RULE, merchant_name: 'Aldi', category_id: 'cat-lebensmittel',
    active: false, id: 'd',
  })
  const alle = [rewe, paypal, beispiel, aus]

  ok('deaktivierte zählen nicht mit', activeMemoryCount(alle) === 3)
  ok('aktive kommen neueste zuerst',
     activeMemories(alle).map((m) => m.id).join('') === 'abc')

  const topf = promptMemories(alle)
  ok('die Töpfe sind getrennt',
     topf.rules.length === 1 && topf.providers.length === 1 && topf.examples.length === 1)
  ok('… und die deaktivierte Regel ist in keinem',
     topf.rules.every((m) => m.merchant_name !== 'Aldi'))

  const zweimal = promptMemories([beispiel, memory({ ...beispiel, id: 'c2' })])
  ok('derselbe Fall zweimal ist einmal', zweimal.examples.length === 1)

  const gruppen = memoryGroups(alle, CATEGORIES)
  ok('drei Gruppen, feste Regeln zuerst',
     gruppen.map((g) => g.title).join('|') === 'Feste Regeln|Zahlungsdienstleister|Beispiele')
  ok('eine Regel sagt, was sie sagt',
     memorySentence(rewe, CATEGORIES).detail === 'Kategorie Lebensmittel')
  ok('ein Dienstleister sagt, dass er keiner ist',
     memorySentence(paypal, CATEGORIES).detail === 'Zahlungsdienstleister, nie der Händler')
  ok('ein Beispiel nennt beide Seiten',
     memorySentence(beispiel, CATEGORIES).detail.indexOf('Troisdorf') === 0 &&
     memorySentence(beispiel, CATEGORIES).detail.indexOf('REWE') > 0)
}

// ── 8. Der Prompt ───────────────────────────────────────────────────────────
{
  const memories = [
    memory({
      kind: MEMORY_KINDS.RULE, merchant_name: 'REWE', category_id: 'cat-lebensmittel',
      created_at: '2026-09-18T12:00:00Z', id: 'r1',
    }),
    memory({
      kind: MEMORY_KINDS.RULE, merchant_name: 'Scalable Capital',
      include_in_analytics: false, created_at: '2026-09-18T11:30:00Z', id: 'r2',
    }),
    memory({
      kind: MEMORY_KINDS.PROVIDER, merchant_name: 'PayPal',
      created_at: '2026-09-18T11:00:00Z', id: 'p1',
    }),
    memory({
      kind: MEMORY_KINDS.EXAMPLE, merchant_name: 'REWE', category_id: 'cat-lebensmittel',
      source_description: 'REWE TROISDORF SAGT DANKE 8407',
      suggested_merchant_name: 'Troisdorf', suggested_category_id: 'cat-sonstige',
      example_key: 'e1', created_at: '2026-09-18T10:00:00Z', id: 'e1',
    }),
  ]
  const prompt = buildAIContextPrompt({ categories: CATEGORIES, memories })

  ok('die festen Regeln stehen drin',
     prompt.indexOf('REWE: Wenn du REWE als Händler erkennst, Kategorie = lebensmittel.') > -1)
  ok('… auch eine, die nur die Auswertung betrifft',
     prompt.indexOf('Scalable Capital') > -1 &&
     prompt.indexOf('include_in_analytics: false') > -1)
  ok('der Dienstleister steht drin',
     prompt.indexOf('PayPal: nicht zwingend der Händler') > -1)
  ok('das Beispiel steht mit beiden Seiten drin',
     prompt.indexOf('Original: REWE TROISDORF SAGT DANKE 8407') > -1 &&
     prompt.indexOf('Du hattest: Händler Troisdorf, Kategorie sonstige') > -1 &&
     prompt.indexOf('Richtig ist: Händler REWE, Kategorie lebensmittel') > -1)
  ok('ein Beispiel ist ausdrücklich kein Gesetz',
     prompt.indexOf('es sind Hinweise, keine festen Regeln') > -1)

  const posRegeln = prompt.indexOf('## Persönliche feste Regeln')
  const posProvider = prompt.indexOf('## Zahlungsdienstleister')
  const posBeispiele = prompt.indexOf('## Beispiele aus meinen Korrekturen')
  const posWiderspruch = prompt.indexOf('## Wenn etwas sich widerspricht')
  const posFormat = prompt.indexOf('## Antwortformat')
  ok('die Reihenfolge ist Regeln → Dienstleister → Beispiele',
     posRegeln > -1 && posRegeln < posProvider && posProvider < posBeispiele)
  ok('… und der Widerspruchsteil kommt danach, vor dem Format',
     posBeispiele < posWiderspruch && posWiderspruch < posFormat)
  ok('die Rangfolge steht ausdrücklich im Prompt',
     prompt.indexOf('1. Persönliche feste Regeln.') > -1 &&
     prompt.indexOf('2. Zahlungsdienstleister-Verhalten.') > -1 &&
     prompt.indexOf('3. Beispiele aus meinen Korrekturen.') > -1 &&
     prompt.indexOf('4. Deine allgemeinen Annahmen.') > -1)
  ok('ein Widerspruch wird nie still aufgelöst',
     prompt.indexOf('Löse einen Widerspruch nie still auf.') > -1)

  // Zweimal kopieren ergibt zweimal dasselbe.
  ok('der Prompt bleibt deterministisch',
     buildAIContextPrompt({ categories: CATEGORIES, memories }) === prompt)

  // Ohne Gedächtnis sieht er aus wie in v1.23.
  const leer = buildAIContextPrompt({ categories: CATEGORIES })
  ok('ohne Erinnerungen keine Beispielüberschrift',
     leer.indexOf('## Beispiele aus meinen Korrekturen') === -1)
  ok('… und die Rangfolge steht trotzdem da',
     leer.indexOf('## Wenn etwas sich widerspricht') > -1)

  // Deaktivierte verschwinden sofort.
  const ohneRegel = buildAIContextPrompt({
    categories: CATEGORIES,
    memories: memories.map((m) => (m.id === 'r1' ? { ...m, active: false } : m)),
  })
  ok('eine deaktivierte Regel ist weg',
     ohneRegel.indexOf('Wenn du REWE als Händler erkennst') === -1)
  ok('… die anderen bleiben', ohneRegel.indexOf('PayPal: nicht zwingend der Händler') > -1)
}

// ── 9. Das Budget ───────────────────────────────────────────────────────────
{
  const viele = []
  for (let i = 0; i < 60; i += 1) {
    viele.push(memory({
      kind: MEMORY_KINDS.EXAMPLE,
      merchant_name: 'Laden ' + i,
      category_id: 'cat-lebensmittel',
      source_description: 'BUCHUNG NUMMER ' + i,
      suggested_merchant_name: 'Unbekannt ' + i,
      example_key: 'key-' + i,
      created_at: '2026-09-' + String(10 + (i % 20)).padStart(2, '0') + 'T10:00:00Z',
      id: 'x' + String(i).padStart(3, '0'),
    }))
  }
  ok('höchstens 40 Beispiele', promptMemories(viele).examples.length === MAX_PROMPT_EXAMPLES)
  ok('… und zwar die neuesten',
     promptMemories(viele).examples[0].created_at === '2026-09-29T10:00:00Z')

  const prompt = buildAIContextPrompt({ categories: CATEGORIES, memories: viele })
  let treffer = 0
  let pos = prompt.indexOf('- Original: ')
  while (pos > -1) { treffer += 1; pos = prompt.indexOf('- Original: ', pos + 1) }
  ok('der Prompt zählt genauso', treffer === MAX_PROMPT_EXAMPLES)

  // Starke Regeln sind nicht begrenzt: sie sind wenige und jede ist eine Ansage.
  const regeln = []
  for (let i = 0; i < 50; i += 1) {
    regeln.push(memory({
      kind: MEMORY_KINDS.RULE, merchant_name: 'Haendler ' + i,
      category_id: 'cat-lebensmittel', id: 'r' + i,
    }))
  }
  ok('alle festen Regeln gehen mit', promptMemories(regeln).rules.length === 50)
}

console.log('finance learning logic: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
`

const res = await build({
  stdin: { contents: TEST, resolveDir: process.cwd(), sourcefile: 'financeLearningLogic.test.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['node:*', 'pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', DEV: false, PROD: true }) },
  write: false,
  logLevel: 'silent',
})

const out = `${process.env.SCRATCH || '/tmp'}/financeLearningLogic.bundled.mjs`
writeFileSync(out, res.outputFiles[0].text)
await import(pathToFileURL(out).href)
