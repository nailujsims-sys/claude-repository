import { MONTHS_DE } from '../../date'

// Der Zeitraum des Dashboards, und wogegen er verglichen wird.
//
// EIN MODELL, VIER ARTEN: `month`, `year`, `last30`, `custom`. Alles andere —
// der Titel der Filterzeile, die Zeile unter der KPI, die Grenzen jeder Summe —
// wird daraus abgeleitet. Ein Bildschirm, der sich seinen Zeitraum selbst
// zusammenrechnet, ist ein Bildschirm, der beim nächsten Monatswechsel etwas
// anderes anzeigt als der daneben.
//
// KALENDERDATEN, KEINE ZEITSTEMPEL. `booking_date` ist eine `date`-Spalte, und
// dieses Modul rechnet ausschließlich mit 'YYYY-MM-DD'-Zeichenketten und mit
// UTC-Datumsarithmetik. Kein `new Date('2026-09-01')` in Ortszeit, keine
// Sommerzeit, kein Tag, der je nach Gerät dazu- oder wegfällt. Vergleiche sind
// Zeichenkettenvergleiche, was bei ISO-Daten exakt der Datumsordnung entspricht.
//
// DER VERGLEICH IST DIE EIGENTLICHE ARBEIT. „+8 % gegenüber dem Vormonat" ist
// nur dann ehrlich, wenn beide Seiten gleich lang sind: ein laufender September
// am 12. darf nicht gegen den ganzen August stehen. Also:
//
//   laufender Monat      01.–heute   gegen  01.–selber Tag im Vormonat
//                                            (höchstens dessen letzter Tag)
//   abgeschlossener Monat  ganzer Monat gegen ganzen Vormonat
//   laufendes Jahr       01.01.–heute gegen denselben Zeitraum im Vorjahr
//   abgeschlossenes Jahr   ganzes Jahr  gegen ganzes Vorjahr
//   last30               30 Tage inkl. heute gegen die 30 Tage davor
//   custom               der Zeitraum gegen den gleich langen davor
//
// Der 29. Februar ist der Fall, an dem das schiefgeht, wenn man es naiv macht:
// der 29.02.2028 hat keinen Gegentag im Januar-Vormonat-Sinn und keinen im Jahr
// 2027. Beide Stellen klemmen deshalb auf den letzten Tag des Zielmonats,
// anstatt in den Folgemonat zu rutschen.
//
// Pur: kein React, kein Supabase, keine Uhr außer der, die hereingereicht wird.

export const PERIOD_KINDS = Object.freeze(['month', 'year', 'last30', 'custom'])

const pad = (n) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' → [Jahr, Monat (1–12), Tag] */
const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`

/** Wie viele Tage der Monat hat — der einzige Ort, an dem Schaltjahre vorkommen. */
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Ein Kalendertag plus n Tage, in UTC gerechnet. */
export function shiftDays(isoDate, n) {
  const p = parts(isoDate)
  if (!p) return null
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]))
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Wie viele Kalendertage zwischen zwei Daten liegen (b − a). */
export function daysBetween(a, b) {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa || !pb) return 0
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2])
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2])
  return Math.round((tb - ta) / 86400000)
}

/**
 * Derselbe Tag in einem anderen Monat — geklemmt statt übergelaufen.
 *
 * Der 31. März minus einen Monat ist der 28. (oder 29.) Februar, nicht der
 * 3. März. Genau hier entsteht sonst der Off-by-one, den die Vorgabe ausschließt.
 */
function clampedDay(year, month, day) {
  return iso(year, month, Math.min(day, daysInMonth(year, month)))
}

/** Der Monat, in dem dieses Datum liegt. */
export const monthPeriod = (isoDate) => {
  const p = parts(isoDate)
  return p ? { kind: 'month', year: p[0], month: p[1] } : null
}

/** Das Jahr, in dem dieses Datum liegt. */
export const yearPeriod = (isoDate) => {
  const p = parts(isoDate)
  return p ? { kind: 'year', year: p[0] } : null
}

/** Der Standard: der laufende Kalendermonat. */
export const currentMonthPeriod = (todayIso) => monthPeriod(todayIso)

/**
 * Ein Zeitraum, auf eine Form gebracht, der man trauen kann.
 *
 * Ein unbekannter oder unvollständiger Zeitraum wird zum laufenden Monat, statt
 * eine Auswertung über `undefined` zu erzeugen. Ein `custom` mit vertauschten
 * Enden wird getauscht — der Nutzer meinte offensichtlich den Zeitraum dazwischen.
 */
export function normalizePeriod(period, todayIso) {
  const fallback = currentMonthPeriod(todayIso)
  if (!period || typeof period !== 'object') return fallback
  const kind = PERIOD_KINDS.includes(period.kind) ? period.kind : null
  if (!kind) return fallback

  if (kind === 'month') {
    const year = Number(period.year)
    const month = Number(period.month)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return fallback
    }
    return { kind, year, month }
  }

  if (kind === 'year') {
    const year = Number(period.year)
    return Number.isInteger(year) ? { kind, year } : fallback
  }

  if (kind === 'last30') return { kind }

  const from = parts(period.from) ? period.from : null
  const to = parts(period.to) ? period.to : null
  if (!from || !to) return fallback
  return from <= to ? { kind, from, to } : { kind, from: to, to: from }
}

/**
 * Die Grenzen eines Zeitraums, beide Enden eingeschlossen.
 *
 * `running` sagt, ob der Zeitraum heute noch läuft — daran hängt der Vergleich
 * und der angeschnittene Balken im Verlauf.
 *
 * @param {object} period
 * @param {string} todayIso
 * @returns {{from: string, to: string, running: boolean}}
 */
export function periodRange(period, todayIso) {
  const p = normalizePeriod(period, todayIso)
  const today = parts(todayIso) ? todayIso : null

  if (p.kind === 'month') {
    const from = iso(p.year, p.month, 1)
    const last = iso(p.year, p.month, daysInMonth(p.year, p.month))
    // Ein laufender Monat endet heute, nicht am 30. — sonst vergleicht man
    // zwölf Tage gegen einunddreißig und nennt das Ergebnis „−61 %".
    const running = Boolean(today) && today >= from && today <= last
    return { from, to: running ? today : last, running }
  }

  if (p.kind === 'year') {
    const from = iso(p.year, 1, 1)
    const last = iso(p.year, 12, 31)
    const running = Boolean(today) && today >= from && today <= last
    return { from, to: running ? today : last, running }
  }

  if (p.kind === 'last30') {
    const to = today ?? iso(1970, 1, 1)
    return { from: shiftDays(to, -29), to, running: true }
  }

  const running = Boolean(today) && today >= p.from && today <= p.to
  return { from: p.from, to: p.to, running }
}

/**
 * Der Zeitraum, gegen den verglichen wird — oder null, wenn es keinen gibt.
 *
 * @param {object} period
 * @param {string} todayIso
 * @returns {{from: string, to: string}|null}
 */
export function comparisonRange(period, todayIso) {
  const p = normalizePeriod(period, todayIso)
  const range = periodRange(p, todayIso)

  if (p.kind === 'month') {
    const prevYear = p.month === 1 ? p.year - 1 : p.year
    const prevMonth = p.month === 1 ? 12 : p.month - 1
    const from = iso(prevYear, prevMonth, 1)
    if (!range.running) {
      return { from, to: iso(prevYear, prevMonth, daysInMonth(prevYear, prevMonth)) }
    }
    // Gleich lang, und am 31. gegen den 28. geklemmt statt übergelaufen.
    const day = parts(range.to)[2]
    return { from, to: clampedDay(prevYear, prevMonth, day) }
  }

  if (p.kind === 'year') {
    const from = iso(p.year - 1, 1, 1)
    if (!range.running) return { from, to: iso(p.year - 1, 12, 31) }
    const [, month, day] = parts(range.to)
    // 29. Februar im Schaltjahr → 28. Februar im Vorjahr.
    return { from, to: clampedDay(p.year - 1, month, day) }
  }

  // last30 und custom: der unmittelbar davorliegende, gleich lange Zeitraum.
  const length = daysBetween(range.from, range.to) + 1
  const to = shiftDays(range.from, -1)
  return { from: shiftDays(to, -(length - 1)), to }
}

/** Liegt dieses Buchungsdatum im Zeitraum? Beide Enden zählen mit. */
export const rangeContains = (range, isoDate) =>
  Boolean(range) && typeof isoDate === 'string' && isoDate >= range.from && isoDate <= range.to

const monthName = (month) => MONTHS_DE[month - 1] ?? ''

/**
 * Wie der Zeitraum in der Filterzeile heißt: „September 2026", „2026",
 * „Letzte 30 Tage", „13. Aug. – 12. Sep. 2026".
 */
export function describePeriod(period, todayIso) {
  const p = normalizePeriod(period, todayIso)
  if (p.kind === 'month') return `${monthName(p.month)} ${p.year}`
  if (p.kind === 'year') return String(p.year)
  if (p.kind === 'last30') return 'Letzte 30 Tage'
  return describeRange(periodRange(p, todayIso))
}

const SHORT_MONTHS_DE = [
  'Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni',
  'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.',
]

/** Ein Tag, kurz: „12. Sep." — mit Jahr nur, wenn es ein anderes ist. */
export function describeDay(isoDate, { withYear = false } = {}) {
  const p = parts(isoDate)
  if (!p) return ''
  const base = `${p[2]}. ${SHORT_MONTHS_DE[p[1] - 1]}`
  return withYear ? `${base} ${p[0]}` : base
}

/**
 * Eine Spanne, so kurz wie sie eindeutig bleibt: „1.–12. September",
 * „13. Aug. – 12. Sep.", „13. Aug. 2025 – 12. Sep. 2026".
 */
export function describeRange(range) {
  if (!range) return ''
  const a = parts(range.from)
  const b = parts(range.to)
  if (!a || !b) return ''
  if (a[0] === b[0] && a[1] === b[1]) {
    return a[2] === b[2]
      ? `${a[2]}. ${monthName(a[1])}`
      : `${a[2]}.–${b[2]}. ${monthName(a[1])}`
  }
  const sameYear = a[0] === b[0]
  return `${describeDay(range.from, { withYear: !sameYear })} – ${describeDay(range.to, { withYear: true })}`
}
