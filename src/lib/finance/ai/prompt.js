import { patternMatches } from '../merchantMatching'
import { patternText, transactionTokens } from '../normalize'
import { formatAmountMinor } from '../importFlow'
import { AI_CSV_COLUMNS, AI_CSV_HEADER, formatExampleTable } from './format'
import { PAYMENT_SERVICE_PROVIDERS, knownProviders } from './providers'
import { MAX_PROMPT_EXAMPLES, promptMemories } from './memories'
import { assignableCategories, categoryTree } from '../categories'

// „KI-Kontext kopieren" — der ganze Prompt, von der App geschrieben.
//
// DER NUTZER MACHT KEIN PROMPT ENGINEERING. Das ist die eigentliche Anforderung
// hinter dieser Datei, und sie ist strenger, als sie klingt: alles, was ChatGPT
// wissen muss, um brauchbare Zeilen zu liefern, steht in dieser App und nirgends
// sonst — welche Kategorien es überhaupt gibt, welche Händler schon bekannt
// sind, welche persönlichen Regeln gelten, welche Dienstleister auf den Auszügen
// dieses Kontos auftauchen. Wer das von Hand zusammenstellen müsste, würde es
// beim dritten Mal weglassen, und die Qualität des Imports hinge daran.
//
// WAS DER PROMPT NICHT TUT: er sagt ChatGPT nicht, zu welchem Konto die
// Buchungen gehören. Das entscheidet der Mensch vor dem Import in der App, und
// kein Modell soll auch nur die Gelegenheit bekommen, es anders zu sehen.
//
// Er ist deterministisch: dieselben Zeilen ergeben denselben Text, jede Liste
// sortiert. Das ist keine Kosmetik — es macht den Prompt prüfbar
// (tools/financeAiLogic.mjs) und bedeutet, dass zweimal Kopieren zweimal
// dasselbe ergibt.

/** Wie viele bekannte Händler höchstens in den Prompt wandern. */
const MAX_MERCHANTS = 40

/**
 * Die Händler, die für diesen Auszug wahrscheinlich zählen.
 *
 * Gemessen daran, wie oft sie in den gespeicherten Buchungen tatsächlich
 * vorkommen — und zwar über die Pattern-Engine, nicht über die `merchant_id`
 * auf der Buchung: die Spalte ist ein Zwischenstand von damals, die Patterns
 * sind die Antwort von heute. Genau die Unterscheidung, auf der der Rest des
 * Moduls seit 0008 besteht.
 */
export function relevantMerchants({
  merchants = [],
  patterns = [],
  transactions = [],
  categoryRules = [],
  categories = [],
  limit = MAX_MERCHANTS,
} = {}) {
  const active = patterns.filter((p) => p?.active !== false)
  const counts = new Map()
  for (const transaction of transactions) {
    const tokens = transactionTokens(transaction)
    for (const pattern of active) {
      if (patternMatches(pattern, tokens)) {
        counts.set(pattern.merchant_id, (counts.get(pattern.merchant_id) ?? 0) + 1)
      }
    }
  }

  const labelById = new Map(categories.filter((c) => c?.id).map((c) => [c.id, c.label ?? c.slug]))
  const slugById = new Map(categories.filter((c) => c?.id).map((c) => [c.id, c.slug]))

  return merchants
    .map((merchant) => {
      const own = active.filter((p) => p.merchant_id === merchant.id)
      const rules = categoryRules.filter((r) => r?.active !== false && r.merchant_id === merchant.id)
      return {
        id: merchant.id,
        name: merchant.canonical_name ?? '',
        count: counts.get(merchant.id) ?? 0,
        patterns: own.map((p) => patternText(p.tokens)).filter(Boolean).sort(),
        rules: rules
          .map((rule) => ({
            categorySlug: slugById.get(rule.category_id) ?? null,
            categoryLabel: labelById.get(rule.category_id) ?? null,
            min: Number.isFinite(rule.min_amount_minor) ? rule.min_amount_minor : null,
            max: Number.isFinite(rule.max_amount_minor) ? rule.max_amount_minor : null,
            currency: rule.currency ?? 'EUR',
          }))
          .filter((rule) => rule.categorySlug)
          .sort((a, b) => String(a.categorySlug).localeCompare(String(b.categorySlug))),
        excluded: merchant.default_include_in_analytics === false,
        alwaysReview: merchant.review_mode === 'always_review',
      }
    })
    .filter((merchant) => merchant.name !== '')
    // Häufigkeit zuerst, Name als Gleichstand — damit derselbe Datenstand
    // denselben Prompt ergibt.
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
}

/** Eine Regel als ein Satz: „ab 30,00 € → Restaurant". */
function ruleSentence(rule) {
  const bounds = []
  if (rule.min !== null) bounds.push(`ab ${formatAmountMinor(rule.min, rule.currency)}`)
  if (rule.max !== null) bounds.push(`bis ${formatAmountMinor(rule.max, rule.currency)}`)
  const range = bounds.length > 0 ? `${bounds.join(' ')} ` : ''
  return `${range}→ ${rule.categorySlug}`
}

/**
 * Der vollständige Kontext-Prompt.
 *
 * @param {{
 *   categories?: Array<object>,
 *   merchants?: Array<object>,
 *   patterns?: Array<object>,
 *   categoryRules?: Array<object>,
 *   transactions?: Array<object>,
 *   accountName?: string|null,
 *   currency?: string,
 * }} input
 * @returns {string}
 */
export function buildAIContextPrompt({
  categories = [],
  merchants = [],
  patterns = [],
  categoryRules = [],
  transactions = [],
  // Was der Nutzer sich ausdrücklich gemerkt hat (v1.24). Die App besitzt das
  // Gedächtnis; ChatGPT bekommt es hier mitgeteilt und behält selbst nichts.
  memories = [],
  accountName = null,
  currency = 'EUR',
} = {}) {
  // Die Oberkategorien strukturieren den Prompt, die Unterkategorien sind das
  // Ergebnis. Beides aus derselben Hierarchie, damit ChatGPT dieselbe Taxonomie
  // sieht, die die Datenbank durchsetzt (0014).
  const tree = categoryTree(categories).filter((node) => node.children.length > 0)
  // Was tatsächlich in der Spalte „Kategorie" stehen darf: die Blätter.
  const categoryList = assignableCategories(categories).filter((c) => c?.slug)

  const known = relevantMerchants({ merchants, patterns, transactions, categoryRules, categories })
  const learned = promptMemories(memories, { limit: MAX_PROMPT_EXAMPLES })
  const labelOf = (id) => {
    const category = categoryList.find((c) => c.id === id)
    return category?.slug ?? null
  }
  const seenProviders = knownProviders(transactions)
  const otherProviders = PAYMENT_SERVICE_PROVIDERS.filter((p) => !seenProviders.includes(p))

  const lines = []

  lines.push('Du bekommst einen Kontoauszug. Deine Aufgabe ist es, ihn vollständig zu lesen und')
  lines.push('jede einzelne Buchung daraus in ein festes Format zu übertragen.')
  lines.push('')
  lines.push('Lies den Auszug vollständig, von der ersten bis zur letzten Seite. Übergehe keine')
  lines.push('Buchung, fasse keine zwei Buchungen zusammen und erfinde keine dazu. Wenn der')
  lines.push('Auszug eine Anzahl oder eine Summe nennt, prüfe deine Liste dagegen.')
  lines.push('')

  // ── 1. Kategorien ─────────────────────────────────────────────────────────
  lines.push('## Erlaubte Kategorien')
  lines.push('')
  lines.push('Die Kategorien sind zweistufig. Die fetten Zeilen mit Doppelpunkt sind')
  lines.push('Oberkategorien — sie gliedern die Liste und sind KEINE gültige Antwort. Gültig')
  lines.push('ist ausschließlich einer der eingerückten Slugs darunter, also immer die')
  lines.push('konkrete Unterkategorie.')
  lines.push('')
  lines.push('Erfinde keine neuen Kategorien und benenne keine um. Wenn keine davon passt,')
  lines.push('lass die Spalte leer und setze „Prüfen" auf true — eine Oberkategorie')
  lines.push('einzutragen ist keine Notlösung, sondern ein ungültiger Wert.')
  lines.push('')
  if (categoryList.length === 0) {
    lines.push('- (noch keine Kategorien angelegt — lass die Spalte überall leer und setze „Prüfen" auf true)')
  } else {
    // Gruppiert, aber nicht auswählbar: die fette Zeile ist eine Überschrift.
    // Der Satz darüber sagt es ausdrücklich, weil ein Modell sonst „Mobilität"
    // zurückgibt und die App eine Kategorie ablehnen müsste, die sie selbst
    // aufgelistet hat.
    for (const node of tree) {
      lines.push(`${node.parent.label ?? node.parent.slug}:`)
      for (const child of node.children) {
        lines.push(`- ${child.slug} — ${child.label ?? child.slug}`)
      }
      lines.push('')
    }
    // Eine Unterkategorie, deren Oberkategorie nicht mitgeladen wurde, fiele
    // sonst aus dem Prompt — und wäre damit eine Kategorie, die es gibt und die
    // ChatGPT nie vorschlägt.
    const listed = new Set(tree.flatMap((node) => node.children.map((c) => c.slug)))
    const orphans = categoryList.filter((c) => !listed.has(c.slug))
    if (orphans.length > 0) {
      lines.push('Ohne Oberkategorie:')
      for (const category of orphans) {
        lines.push(`- ${category.slug} — ${category.label ?? category.slug}`)
      }
      lines.push('')
    }
  }

  // ── 2. Bekannte Händler ───────────────────────────────────────────────────
  lines.push('## Bekannte Händler')
  lines.push('')
  if (known.length === 0) {
    lines.push('Bisher sind keine Händler hinterlegt. Erkenne sie aus dem Auszug selbst.')
  } else {
    lines.push('Diese Händler sind bereits bekannt. Wenn eine Buchung zu einem davon gehört,')
    lines.push('benutze genau diese Schreibweise des Namens.')
    lines.push('')
    for (const merchant of known) {
      const details = []
      if (merchant.patterns.length > 0) details.push(`erkannt an: ${merchant.patterns.join(', ')}`)
      if (merchant.rules.length > 0) {
        details.push(`Kategorie: ${merchant.rules.map(ruleSentence).join('; ')}`)
      }
      lines.push(`- ${merchant.name}${details.length > 0 ? ` (${details.join(' · ')})` : ''}`)
    }
  }
  lines.push('')

  // ── 3. Persönliche Regeln ─────────────────────────────────────────────────
  const personal = []
  for (const merchant of known) {
    if (merchant.excluded) {
      personal.push(`- ${merchant.name} zählt nicht als Ausgabe → include_in_analytics: false`)
    }
    if (merchant.alwaysReview) {
      personal.push(`- ${merchant.name} wird immer von Hand geprüft → needs_review: true`)
    }
    for (const rule of merchant.rules) {
      if (rule.min !== null || rule.max !== null) {
        personal.push(`- ${merchant.name} ${ruleSentence(rule)}`)
      }
    }
  }
  // Die starken Regeln aus dem Gedächtnis. Sie stehen bei den persönlichen
  // Regeln, weil sie dasselbe sind: eine Entscheidung, die der Nutzer
  // ausdrücklich getroffen hat. Woher sie technisch kommt — aus der
  // Pattern-Engine oder aus einer Korrektur im KI-Preview — ist für ChatGPT
  // ohne Bedeutung und wäre nur eine Einladung, zwischen ihnen zu wählen.
  const fixed = []
  for (const rule of learned.rules) {
    const says = []
    const slug = labelOf(rule.category_id)
    if (slug) says.push(`Kategorie = ${slug}`)
    if (rule.transaction_type) says.push(`Art = ${rule.transaction_type}`)
    if (rule.include_in_analytics === false) says.push('include_in_analytics: false')
    if (rule.include_in_analytics === true) says.push('include_in_analytics: true')
    if (says.length === 0) continue
    fixed.push(
      `- ${rule.merchant_name}: Wenn du ${rule.merchant_name} als Händler erkennst, ${says.join(', ')}.`
    )
  }

  lines.push('## Persönliche feste Regeln')
  lines.push('')
  if (personal.length === 0 && fixed.length === 0) {
    lines.push('Es sind noch keine persönlichen Regeln hinterlegt.')
  } else {
    lines.push('Diese Entscheidungen hat der Nutzer bereits getroffen. Sie gehen jeder')
    lines.push('allgemeinen Annahme vor — auch wenn du es anders einsortieren würdest.')
    lines.push('')
    lines.push(...fixed.sort())
    lines.push(...personal.sort())
  }
  lines.push('')

  // ── 4. Zahlungsdienstleister ──────────────────────────────────────────────
  lines.push('## Zahlungsdienstleister')
  lines.push('')
  lines.push('Ein Zahlungsdienstleister ist nicht der Händler. Steht einer im Text, suche den')
  lines.push('echten Händler im selben Text weiter hinten — "PAYPAL .Zalando SE" ist ein')
  lines.push('Einkauf bei Zalando, nicht bei PayPal. Findest du ihn nicht eindeutig, lass')
  lines.push('„Händler" leer und setze „Prüfen" auf true. Trage nie den Dienstleister als')
  lines.push('Händler ein.')
  lines.push('')
  if (learned.providers.length > 0) {
    lines.push('Der Nutzer hat ausdrücklich gesagt, dass diese Namen Dienstleister sind und')
    lines.push('nicht der Händler:')
    lines.push('')
    for (const provider of learned.providers) {
      lines.push(`- ${provider.merchant_name}: nicht zwingend der Händler. Suche im selben Text`)
      lines.push(`  nach dem tatsächlichen Empfänger und kategorisiere nach ihm. Findest du ihn`)
      lines.push('  nicht eindeutig, setze „Prüfen" auf true.')
    }
    lines.push('')
  }
  if (seenProviders.length > 0) {
    lines.push(`Auf diesem Konto bereits aufgetaucht: ${seenProviders.join(', ')}.`)
  }
  if (otherProviders.length > 0) {
    lines.push(`Weitere Dienstleister: ${otherProviders.join(', ')}.`)
  }
  lines.push('')

  // ── 5. Beispiele aus den Korrekturen des Nutzers ──────────────────────────
  // Der eigentliche Gedanke von v1.24: ein konkreter Fall, keine Regel. Die App
  // baut daraus ausdrücklich KEIN Ähnlichkeitsmaß — das Übertragen auf „REWE
  // Stuttgart" ist eine semantische Leistung, und die erbringt das Modell
  // besser als jeder Tokenvergleich. Was die App dazu sagen muss, ist nur, wie
  // weit es gehen darf.
  if (learned.examples.length > 0) {
    lines.push('## Beispiele aus meinen Korrekturen')
    lines.push('')
    lines.push('So habe ich frühere Vorschläge korrigiert. Übertrage das vorsichtig auf')
    lines.push('inhaltlich ähnliche Buchungen — es sind Hinweise, keine festen Regeln. Leite')
    lines.push('daraus keine Regel für alles ab, und wenn ein Fall nur entfernt ähnlich ist,')
    lines.push('setze „Prüfen" auf true.')
    lines.push('')
    for (const example of learned.examples) {
      const hadMerchant = example.suggested_merchant_name ?? '(leer)'
      const hadCategory = labelOf(example.suggested_category_id) ?? '(leer)'
      const gotMerchant = example.merchant_name ?? '(leer)'
      const gotCategory = labelOf(example.category_id) ?? '(leer)'
      lines.push(`- Original: ${example.source_description}`)
      lines.push(`  Du hattest: Händler ${hadMerchant}, Kategorie ${hadCategory}`)
      lines.push(`  Richtig ist: Händler ${gotMerchant}, Kategorie ${gotCategory}`)
      if (example.transaction_type) lines.push(`  Art: ${example.transaction_type}`)
      if (example.include_in_analytics === false) lines.push('  include_in_analytics: false')
      if (example.include_in_analytics === true) lines.push('  include_in_analytics: true')
    }
    lines.push('')
  }

  // ── 6. Was gilt, wenn zwei Dinge sich widersprechen ───────────────────────
  // Ausdrücklich, weil ein Modell einen Widerspruch sonst auflöst, ohne es zu
  // sagen — und eine still getroffene Entscheidung ist genau das, was der
  // Nutzer hier nicht bekommen soll.
  lines.push('## Wenn etwas sich widerspricht')
  lines.push('')
  lines.push('In dieser Reihenfolge:')
  lines.push('')
  lines.push('1. Persönliche feste Regeln.')
  lines.push('2. Zahlungsdienstleister-Verhalten.')
  lines.push('3. Beispiele aus meinen Korrekturen.')
  lines.push('4. Deine allgemeinen Annahmen.')
  lines.push('')
  lines.push('Löse einen Widerspruch nie still auf. Die ausdrücklichste Regel des Nutzers')
  lines.push('gewinnt; lassen zwei Regeln sich nicht vereinbaren, entscheide nichts und setze')
  lines.push('„Prüfen" auf true.')
  lines.push('')

  // ── 7. Händler erkennen ───────────────────────────────────────────────────
  lines.push('## Händler erkennen')
  lines.push('')
  lines.push('- Erkenne den Händler inhaltlich, nicht buchstäblich. "REWE SAGT DANKE 8407" ist REWE.')
  lines.push('- Ein Ort ist kein Händler. Aus "REWE Troisdorf" wird REWE, nicht Troisdorf.')
  lines.push('- Filialnummern, Terminal-IDs, Kartennummern und Zeitstempel gehören nicht in den Namen.')
  lines.push('- Rechtsformen darfst du weglassen, wenn der Name dadurch eindeutig bleibt.')
  lines.push('- Bist du dir beim Händler nicht sicher, lass die Spalte leer und setze „Prüfen"')
  lines.push('  auf true. Ein leeres Feld ist richtig, ein geratener Name ist falsch.')
  lines.push('')

  // ── 8. Das Format ─────────────────────────────────────────────────────────
  //
  // WARUM DER CODEBLOCK EINE ANWEISUNG IST UND KEINE DARSTELLUNGSFRAGE: der
  // Nutzer kopiert die Antwort auf dem Telefon. Fließtext verliert dabei seine
  // Zeilenumbrüche — und aus vierzig Buchungen wird eine einzige Zeile mit
  // sechshundert Feldern, die kein Parser mehr ehrlich zerlegen kann. Ein
  // Codeblock hat einen Kopieren-Knopf, und der gibt den Text so heraus, wie er
  // dasteht. Deshalb steht die Verpackung hier so ausdrücklich wie die Spalten.
  lines.push('## Antwortformat')
  lines.push('')
  lines.push('Antworte mit GENAU EINEM Codeblock und sonst nichts.')
  lines.push('')
  lines.push('- Beginne die Antwort mit ```text und beende sie mit ```.')
  lines.push('- Vor dem öffnenden ``` steht nichts, nach dem schließenden ``` steht nichts.')
  lines.push('- Kein „Hier ist …", keine Erklärung, keine Analyse, keine Zusammenfassung,')
  lines.push('  keine Aufzählung, keine Markdown-Tabelle, keine Summenzeile.')
  lines.push('- Alle Buchungen stehen in DIESEM EINEN Block, nicht in mehreren.')
  lines.push('')
  lines.push('Der Codeblock ist Teil des verbindlichen Ausgabeformats, nicht nur eine')
  lines.push('Darstellungshilfe: der Nutzer kopiert ihn über den Kopieren-Knopf des Blocks.')
  lines.push('Ohne Block gehen beim Kopieren die Zeilenumbrüche verloren, und die Antwort')
  lines.push('ist unbrauchbar.')
  lines.push('')
  lines.push('Im Block: erst genau diese Kopfzeile, dann eine Zeile je Buchung, Felder mit')
  lines.push('Semikolon getrennt.')
  lines.push('')
  lines.push('- Die erste Zeile im Block lautet exakt:')
  lines.push(`  ${AI_CSV_HEADER}`)
  lines.push('- Danach genau eine physische Textzeile je Buchung, mit echtem Zeilenumbruch.')
  lines.push('- Nie eine Buchung über mehrere Zeilen umbrechen.')
  lines.push('- Nie mehrere Buchungen in eine Zeile schreiben.')
  lines.push('- Keine Leerzeile zwischen den Buchungen.')
  lines.push('')
  lines.push('So sieht die Antwort aus — und zwar auch die echte, nicht nur dieses Beispiel:')
  lines.push('')
  lines.push('```text')
  lines.push(formatExampleTable())
  lines.push('```')
  lines.push('')
  lines.push(`- ${AI_CSV_COLUMNS[0]}: das Buchungsdatum aus dem Auszug, als YYYY-MM-DD. Nie`)
  lines.push('  umgerechnet, nie geschätzt, nie durch das Wertstellungsdatum ersetzt.')
  lines.push(`- ${AI_CSV_COLUMNS[1]}: der Verwendungszweck so originalgetreu wie möglich, in einer`)
  lines.push('  Zeile. Kürze nicht, korrigiere keine Schreibfehler, übersetze nichts.')
  lines.push(`- ${AI_CSV_COLUMNS[2]}: der Betrag aus dem Auszug. Ausgaben negativ, Einnahmen positiv,`)
  lines.push('  Komma als Dezimaltrennzeichen, höchstens zwei Nachkommastellen, kein')
  lines.push('  Währungszeichen und keine Tausenderpunkte: -1234,56 statt -1.234,56 €.')
  lines.push('  Ändere nie einen Betrag, auch nicht zum Runden.')
  lines.push(`- ${AI_CSV_COLUMNS[3]}: Pflichtfeld, dreistelliger Code (z. B. ${currency}). Steht im Auszug`)
  lines.push('  eine Fremdwährung, nimm den Betrag, der dem Konto belastet wurde, und dessen Währung.')
  lines.push(`- ${AI_CSV_COLUMNS[4]}: der erkannte Händler. Leer lassen, wenn du ihn nicht eindeutig`)
  lines.push('  erkennst.')
  lines.push(`- ${AI_CSV_COLUMNS[5]}: einer der eingerückten Unterkategorie-Slugs oben, oder leer.`)
  lines.push('  Nie eine Oberkategorie, nie ein Label, nie ein selbst gebildeter Slug.')
  lines.push(`- ${AI_CSV_COLUMNS[6]}: purchase, refund, transfer, income, fee oder other.`)
  lines.push(`- ${AI_CSV_COLUMNS[7]}: false, wenn die Buchung keine echte Ausgabe ist — eine Umbuchung`)
  lines.push('  auf ein eigenes Konto, eine Sparrate, eine durchlaufende Zahlung. Sonst true.')
  lines.push(`- ${AI_CSV_COLUMNS[8]}: nur, wenn etwas wirklich erklärungsbedürftig ist, sonst leer.`)
  lines.push(`- ${AI_CSV_COLUMNS[9]}: true, sobald du dir bei irgendetwas an dieser Buchung unsicher`)
  lines.push('  bist. Sonst false.')
  lines.push('')
  lines.push('Wichtig zum Trennzeichen: das Semikolon trennt die Felder und darf deshalb in')
  lines.push('keinem Text vorkommen. Steht im Verwendungszweck eines, ersetze es durch ein')
  lines.push('Komma oder lass es weg. Jede Zeile hat genau ' + AI_CSV_COLUMNS.length + ' Felder — auch die')
  lines.push('leeren Felder werden mitgezählt, zwei Semikolons hintereinander sind ein leeres')
  lines.push('Feld. Keine Anführungszeichen um die Felder, keine Leerzeile zwischen den')
  lines.push('Buchungen, keine Zeilenumbrüche innerhalb einer Buchung.')
  lines.push('')
  lines.push('Vergib keine IDs und keine laufenden Nummern. Die Zuordnung macht die App.')
  lines.push('')

  // ── 9. Unsicherheit ───────────────────────────────────────────────────────
  lines.push('## Im Zweifel')
  lines.push('')
  lines.push('Lieber „Prüfen" auf true als ein geratener Wert. Eine Buchung, die der Nutzer')
  lines.push('kurz prüft, kostet ihn Sekunden; eine falsch einsortierte findet er nie wieder.')
  lines.push('Lass im Zweifel „Händler" und „Kategorie" leer, statt etwas Plausibles einzutragen.')

  const header =
    accountName && accountName.trim() !== ''
      ? `Die Buchungen gehören zum Konto „${accountName.trim()}". Du musst darüber nichts entscheiden — das Konto ist in der App bereits gewählt.\n\n`
      : ''

  return header + lines.join('\n')
}
