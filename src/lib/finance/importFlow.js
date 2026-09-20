import { extractPdfTextDocument } from './dkb/extract'
import { parseDkbUmsatzexport } from './dkb/parse'
import { reconcileImport } from './dkb/reconcile'
import { buildApplyPayload } from './dkb/plan'
import { sourceHash } from './dkb/sourceHash'

// From a PDF to something a person can read — and nothing else.
//
// The pipeline behind this module is finished and tested: `parseDkbUmsatzexport`
// reads the file or refuses it, `reconcileImport` decides what a second export
// means for what is already stored, `buildApplyPayload` narrows that to what the
// database applies. None of it is repeated here.
//
// What IS here is the translation. The plan speaks in `duplicate`, `enriched`,
// `supersedes_group` — words that describe a matching tier, not a bank
// statement. A person opening the app wants to know how many bookings arrived,
// how many of them are new, and whether anything needs a second look. So this
// module turns outcomes into those sentences, once, in one place, and the screen
// renders what it is handed.
//
// It is pure and free of React on purpose: every number and every word below is
// asserted in tools/financeImportFlowLogic.mjs against the real parser and the
// real matcher, which a component test could not do.

/**
 * What a failure may be written down as.
 *
 * WHY NOT `console.error(err)`. A PostgREST error object carries `details` and
 * `hint`, and for a constraint violation those hold the row that caused it —
 * which here means a booking text, an amount and a date out of somebody's bank
 * statement, written into the browser console where it outlives the session.
 * The code and the message are enough to find the cause and carry no row.
 *
 * @param {string} where a fixed label, never interpolated from data
 */
export function failureLog(where, error) {
  const code = error?.code ?? error?.name ?? 'unbekannt'
  const message = typeof error?.message === 'string' ? error.message.slice(0, 200) : ''
  return `finance/${where}: ${code}${message ? ` — ${message}` : ''}`
}

/**
 * What each outcome is called in front of a user.
 *
 * Deliberately five words for seven outcomes: `supersedes` and
 * `supersedes_group` are the same event seen by the reader ("this booking takes
 * the place of a provisional one"), and the difference between them — whether
 * the documents allowed an individual link — is a matching detail, not
 * something to explain in a list row.
 */
export const OUTCOME_LABELS = Object.freeze({
  new: 'Neu',
  duplicate: 'Bereits vorhanden',
  enriched: 'Aktualisiert',
  supersedes: 'Ersetzt',
  supersedes_group: 'Ersetzt',
  unresolved: 'Prüfen',
  review: 'Prüfen',
})

/**
 * The tone a status is drawn in. Three values, because the brief allows three:
 * blue is the accent, red is a real error, green is success — and a list of
 * bookings is none of those, so almost everything here is `quiet`.
 */
export const OUTCOME_TONES = Object.freeze({
  new: 'accent',
  duplicate: 'quiet',
  enriched: 'quiet',
  supersedes: 'quiet',
  supersedes_group: 'quiet',
  unresolved: 'attention',
  review: 'attention',
})

const OUTCOME_ORDER = ['new', 'supersedes', 'supersedes_group', 'enriched', 'duplicate', 'unresolved', 'review']

const count = (summary, key) => (Number.isFinite(summary?.[key]) ? summary[key] : 0)

/** "1 Umsatz" / "7 Umsätze" — the app writes German, so the numbers agree. */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The money of a booking, from integer minor units.
 *
 * Never `amount / 100` into a float that is then formatted: the cents are split
 * off as integers and joined as text, so 2483 is "24,83 €" and stays exact all
 * the way to the screen. The currency comes from the statement, not from a
 * setting — a booking in another currency has to say so.
 */
export function formatAmountMinor(amountMinor, currency = 'EUR') {
  if (!Number.isInteger(amountMinor)) return ''
  const negative = amountMinor < 0
  const abs = Math.abs(amountMinor)
  const whole = Math.trunc(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const symbol = currency === 'EUR' ? ' €' : ` ${currency}`
  return `${negative ? '−' : ''}${grouped},${cents}${symbol}`
}

/**
 * Derselbe Betrag, so kurz, dass er über einen Balken passt.
 *
 * WARUM EINE ZWEITE FORMATIERUNG. Über einem Diagrammbalken stehen auf einem
 * 390-Pixel-Schirm bis zu zwölf Zahlen nebeneinander; „1.284,37 €" braucht dort
 * mehr Platz, als eine Spalte breit ist, und würde entweder abgeschnitten oder
 * in den Nachbarn laufen. Also die Zahl, die ein Mensch beim Überfliegen
 * wirklich liest — und die Cent dort, wo es um sie geht: im Tap-Detail unter
 * dem Diagramm, das weiterhin `formatAmountMinor` benutzt.
 *
 * DIE REGEL, IN ZWEI ZEILEN:
 *   unter 1.000 €   volle Euro, kaufmännisch gerundet   →  428 €
 *   ab 1.000 €      eine Nachkommastelle, abgeschnitten →  1,2k €
 *
 * ABGESCHNITTEN UND NICHT GERUNDET, ab tausend: „1,0k €" für 1.049 € ist eine
 * Untertreibung, die niemanden überrascht — „1,1k €" dafür wäre eine
 * Übertreibung, und über einem Balken ist zu viel schlimmer als zu wenig.
 * Unter tausend wird dagegen gerundet, weil dort jede Zahl noch für sich
 * gelesen wird. Beide Stufen arbeiten auf vollen Euro: 999,50 € ist gerundet
 * 1.000 € und steht deshalb zu Recht als „1,0k €" da.
 *
 * Das Minuszeichen ist das typografische „−" wie in `formatAmountMinor`; ein
 * Balken zeigt Beträge normalerweise ohne Vorzeichen, ein negativer Eimer (mehr
 * erstattet als ausgegeben) soll aber nicht als positiver erscheinen.
 */
export function formatCompactAmountMinor(amountMinor, currency = 'EUR') {
  if (!Number.isInteger(amountMinor)) return ''
  const negative = amountMinor < 0
  const abs = Math.abs(amountMinor)
  // Leere Währung heißt „das Zeichen steht schon woanders" — das Diagramm
  // benutzt das, wenn eine Spalte zu schmal dafür ist.
  const symbol = !currency ? '' : currency === 'EUR' ? ' €' : ` ${currency}`
  const sign = negative ? '−' : ''

  const euros = Math.round(abs / 100)
  if (euros < 1000) return `${sign}${euros}${symbol}`

  // Tausender: eine Nachkommastelle, ohne Aufrunden über die eigene Stufe.
  const tenths = Math.floor(euros / 100)
  const thousands = Math.floor(tenths / 10)
  const rest = tenths % 10
  if (thousands >= 1000) {
    // Millionen kommen in einem privaten Haushalt nicht vor — aber „1234,5k €"
    // wäre unlesbar, also bekommt auch dieser Fall seine eigene Stufe.
    const mTenths = Math.floor(thousands / 100)
    return `${sign}${Math.floor(mTenths / 10)},${mTenths % 10}M${symbol}`
  }
  return `${sign}${thousands},${rest}k${symbol}`
}

/**
 * The line a person recognises a booking by.
 *
 * The first line of the statement text, which is where DKB puts the merchant.
 * The rest — IBAN, card marker, timestamp — is real and kept in the database,
 * but it is not what makes a booking recognisable in a list.
 */
export function bookingTitle(booking) {
  const raw = typeof booking?.raw_description === 'string' ? booking.raw_description : ''
  const first = raw.split('\n')[0]?.trim()
  return first || 'Ohne Beschreibung'
}

/** "14.09.2026" from the stored ISO date. */
export function formatBookingDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  return match ? `${match[3]}.${match[2]}.${match[1]}` : ''
}

/**
 * The numbers the preview is built from.
 *
 * `gespeichert` is the one that decides what the confirm button promises: a
 * booking is written for every arrival that is new AND for every one that takes
 * the place of a provisional row, because both create a row. Counting only
 * `new` there would under-promise, counting the whole file would over-promise.
 *
 * `abgeloest` counts the STORED bookings that will stop counting — distinct
 * ids, so an ambiguous group of two is two and not four.
 */
export function summarizePlan(plan) {
  const summary = plan?.summary ?? {}
  const decisions = Array.isArray(plan?.decisions) ? plan.decisions : []

  const neu = count(summary, 'new')
  const ersetzt = count(summary, 'supersedes') + count(summary, 'supersedes_group')
  const vorhanden = count(summary, 'duplicate')
  const aktualisiert = count(summary, 'enriched')
  const pruefen = count(summary, 'unresolved') + count(summary, 'review')

  const replaced = new Set()
  for (const decision of decisions) {
    if (decision?.outcome !== 'supersedes' && decision?.outcome !== 'supersedes_group') continue
    for (const id of decision.existing_ids ?? []) replaced.add(id)
  }

  return {
    erkannt: neu + ersetzt + vorhanden + aktualisiert + pruefen,
    neu,
    ersetzt,
    vorhanden,
    aktualisiert,
    pruefen,
    gespeichert: neu + ersetzt,
    abgeloest: replaced.size,
    retouren: Array.isArray(plan?.refundCandidates) ? plan.refundCandidates.length : 0,
  }
}

/**
 * The sentences under the headline. Only the ones that say something: a preview
 * that lists "0 bereits vorhanden" makes the reader check a number that does not
 * exist.
 */
export function summaryLines(totals) {
  const lines = []
  if (totals.neu > 0) lines.push(`${totals.neu} neu`)
  if (totals.ersetzt > 0) lines.push(`${totals.ersetzt} ersetzen eine Vormerkung`)
  if (totals.vorhanden > 0) lines.push(`${totals.vorhanden} bereits vorhanden`)
  if (totals.aktualisiert > 0) lines.push(`${totals.aktualisiert} mit aktualisierten Informationen`)
  lines.push(
    totals.pruefen > 0
      ? `${totals.pruefen} ${totals.pruefen === 1 ? 'muss' : 'müssen'} geprüft werden`
      : '0 müssen geprüft werden'
  )
  return lines
}

/**
 * The supersession sentence, or null.
 *
 * Says what happens to the OLD bookings, because that is the part a person
 * cannot see coming: their provisional rows stop counting. It deliberately
 * names no pair — where the statements did not say which replaces which, the
 * preview does not pretend to know either.
 */
export function supersessionSentence(totals) {
  if (totals.abgeloest === 0) return null
  return totals.abgeloest === 1
    ? 'Ein bereits vorgemerkter Umsatz wird durch seine endgültige Buchung ersetzt.'
    : `${totals.abgeloest} bereits vorgemerkte Umsätze werden durch ihre endgültigen Buchungen ersetzt.`
}

/** What the confirm button promises, in one sentence. */
export function confirmSentence(totals) {
  if (totals.gespeichert === 0) return 'Es wird kein neuer Umsatz hinzugefügt.'
  return totals.gespeichert === 1
    ? 'Ein neuer Umsatz wird hinzugefügt.'
    : `${totals.gespeichert} neue Umsätze werden hinzugefügt.`
}

/**
 * One row per booking of the file, in the order the statement lists them.
 *
 * Every row carries its own status, and nothing else is derived here — the
 * component only prints these fields.
 */
export function previewRows(bookings, plan) {
  const list = Array.isArray(bookings) ? bookings : []
  const byIndex = new Map()
  for (const decision of plan?.decisions ?? []) {
    if (Number.isInteger(decision?.index)) byIndex.set(decision.index, decision)
  }

  return list.map((booking, index) => {
    const outcome = byIndex.get(index)?.outcome ?? 'new'
    return {
      index,
      title: bookingTitle(booking),
      date: formatBookingDate(booking?.booking_date),
      amount: formatAmountMinor(booking?.amount_minor, booking?.currency ?? 'EUR'),
      negative: Number.isInteger(booking?.amount_minor) && booking.amount_minor < 0,
      outcome,
      status: OUTCOME_LABELS[outcome] ?? OUTCOME_LABELS.new,
      tone: OUTCOME_TONES[outcome] ?? 'quiet',
    }
  })
}

/**
 * Why a file was refused, in words a person can act on.
 *
 * The parser's job is to be exact and it says things like
 * `declared_count_mismatch`. That is the right thing to keep — it goes into the
 * details — but it is not the sentence to lead with. The headline says what
 * happened and what it means; the codes stay available underneath, because a
 * refusal nobody can look into is a refusal nobody can report.
 */
export function describeParseFailure(result) {
  const errors = Array.isArray(result?.errors) ? result.errors : []
  const codes = new Set(errors.map((e) => e?.code))

  let headline = 'Dieser DKB-Export konnte nicht vollständig geprüft werden und wurde deshalb nicht importiert.'
  if (codes.has('no_text_layer') || codes.has('scanned_document')) {
    headline =
      'Diese Datei enthält keinen auslesbaren Text — vermutlich ein Scan oder ein Foto. Bitte lade den Umsatzexport direkt aus dem DKB-Banking herunter.'
  } else if (codes.has('not_a_dkb_export')) {
    headline = 'Das sieht nicht nach einem DKB-Umsatzexport aus. Bitte prüfe die Datei.'
  }

  return {
    headline,
    details: errors.map((error) => ({
      code: typeof error?.code === 'string' ? error.code : 'unbekannt',
      message: typeof error?.message === 'string' ? error.message : '',
    })),
  }
}

/**
 * The result of an apply, as the success screen reads it.
 *
 * Taken from what the database returned rather than from what the preview
 * predicted: the two agree, and if they ever did not, the database is the one
 * that is right.
 */
export function describeApplyResult(result, totals) {
  const number = (key) => (Number.isFinite(result?.[key]) ? result[key] : 0)
  const lines = []
  if (number('transactions_created') > 0) {
    lines.push(plural(number('transactions_created'), 'neuer Umsatz', 'neue Umsätze'))
  }
  if (totals.vorhanden > 0) lines.push(`${totals.vorhanden} bereits vorhanden`)
  if (number('supersessions_confirmed') > 0) {
    lines.push(
      `${totals.abgeloest} ${totals.abgeloest === 1 ? 'Vormerkung ersetzt' : 'Vormerkungen ersetzt'}`
    )
  }
  if (number('observations_created') > 0) {
    lines.push(
      `${number('observations_created')} ${
        number('observations_created') === 1 ? 'Umsatz ergänzt' : 'Umsätze ergänzt'
      }`
    )
  }
  const review = number('review_items_created')
  return {
    lines,
    review,
    reviewSentence:
      review > 0
        ? `${review} ${review === 1 ? 'Umsatz muss' : 'Umsätze müssen'} später geprüft werden.`
        : null,
    replayed: result?.replayed === true,
  }
}

// ── The three steps, wired once ─────────────────────────────────────────────
// Each is a single call into a finished module. They live here rather than in
// the component for one reason: a component cannot be tested against a real PDF
// and a real matcher, and these are exactly the calls whose arguments matter.

/**
 * Read a file the user picked: its identity, and what the parser makes of it.
 *
 * The bytes are read once and never leave this function — the hash goes to the
 * database, the parsed bookings go to the preview, the PDF goes nowhere.
 *
 * @param {File|Blob} file
 * @param {{extract?: Function, parse?: Function, hash?: Function}} [deps]
 */
export async function readStatementFile(file, deps = {}) {
  const extract = deps.extract ?? extractPdfTextDocument
  const parse = deps.parse ?? parseDkbUmsatzexport
  const hashOf = deps.hash ?? sourceHash

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Hashed before anything else touches the buffer: pdfjs takes ownership of
  // what it is handed, and the identity of the file must not depend on that.
  const hash = await hashOf(bytes)
  const document = await extract(bytes)
  return { hash, result: parse(document) }
}

/**
 * The best text the database holds about each stored booking.
 *
 * A booking's `raw_description` is frozen at the moment it arrived, and rightly
 * so. But a later export often describes the same booking better — "Deutsche
 * Bahn" becomes "DB.Vertrieb.GmbH/508354771568" — and that richer text is kept
 * beside it as an observation rather than written over it.
 *
 * WHY THE MATCHER NEEDS IT. Every fact the matcher works from is derived from
 * the description, the reference included. So a booking whose reference only
 * ever appeared in the richer text has, as far as matching is concerned, no
 * reference at all — and the tiers that match on one can never recognise it
 * again. Reloading the app made that permanent: the session that imported the
 * richer text had it in hand, the next session did not.
 *
 * So the rows handed to the matcher carry the newest description the database
 * knows. The stored row is not touched and is never written back; this is a
 * reading of the evidence, not an edit of the booking.
 */
export function hydrateForMatching(transactions, observations = []) {
  const rows = Array.isArray(transactions) ? transactions : []
  const list = Array.isArray(observations) ? observations : []
  if (list.length === 0) return rows

  const best = new Map()
  for (const observation of list) {
    const id = observation?.transaction_id
    if (!id || typeof observation.observed_description !== 'string') continue
    const previous = best.get(id)
    // Newest wins. Ties keep the first seen, which is stable because the
    // repository reads observations in a fixed order.
    if (!previous || String(observation.created_at ?? '') > String(previous.created_at ?? '')) {
      best.set(id, observation)
    }
  }

  return rows.map((row) => {
    const observation = best.get(row?.id)
    if (!observation) return row
    if (observation.observed_description === row.raw_description) return row
    return {
      ...row,
      raw_description: observation.observed_description,
      external_reference: observation.observed_reference ?? row.external_reference ?? null,
    }
  })
}

/**
 * Reconcile the parsed file against what this account already holds.
 *
 * `accountId` is passed on purpose and is not optional in practice: stored
 * bookings carry an account and freshly parsed ones do not, so without it every
 * arrival would fall through as new and the import would double everything.
 * `reconcileImport` refuses that case outright — this is the one call site that
 * has to get it right.
 *
 * `overrideTransactionIds` is the other half of the same duty. A booking the
 * user decided about by hand is never quietly re-labelled by an import, and the
 * database enforces that whatever the plan claims — but a preview that did not
 * know about the override would promise "Ersetzt" for a booking that is about to
 * stand down, which is the preview telling the user the opposite of what will
 * happen.
 */
export function buildPlan({ parsed, existing = [], observations = [], overrideTransactionIds = [], accountId }) {
  return reconcileImport({
    existing: hydrateForMatching(existing, observations),
    incoming: parsed?.transactions ?? [],
    overrideTransactionIds,
    period: {
      start: parsed?.header?.period_start ?? null,
      end: parsed?.header?.period_end ?? null,
    },
    accountId,
  })
}

/** The payload the atomic RPC applies. Narrowed and re-checked by plan.js. */
export function buildPayload({ importId, accountId, parsed, plan }) {
  return buildApplyPayload({
    importId,
    accountId,
    bookings: parsed?.transactions ?? [],
    plan,
  })
}

export { OUTCOME_ORDER }
