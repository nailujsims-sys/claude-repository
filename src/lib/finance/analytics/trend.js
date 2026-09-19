import { MONTHS_DE } from '../../date'
import { daysInMonth } from './period'

// „Ausgabenentwicklung" — dieselbe Ausgabenregel, nur über eine Zeitachse.
//
// DIE BALKEN WERDEN HIER GERECHNET UND NICHT IM CHART. Eine Komponente, die aus
// Buchungen Balkenhöhen macht, ist eine zweite Auswertung — mit eigener
// Vorstellung davon, was ein Monat ist und was eine Retoure bedeutet. Das Chart
// bekommt fertige Eimer: Beschriftung, Anfang, Ende, Betrag, angeschnitten
// ja/nein. Mehr braucht es nicht, und mehr darf es nicht wissen.
//
// DIE GRANULARITÄT GEHÖRT ZUM ZEITRAUM. Drei Jahre in Monatsbalken sind
// sechsunddreißig Striche auf 350 Pixeln; ein Jahrzehnt in Quartalen ebenso.
// Deshalb: bis zu einem Jahr Monate, bei drei Jahren Quartale, bei „Max" Jahre.
//
// DER LAUFENDE EIMER IST ANGESCHNITTEN. Der September am 12. ist kein
// niedriger September, er ist ein unfertiger — `isPartial` sagt es, und die
// Oberfläche zeigt denselben Balken mit weniger Deckkraft, statt einen
// Einbruch zu behaupten, den es nicht gibt.
//
// Der Zeitraum-Filter des Dashboards gilt hier NICHT: der Verlauf hat seine
// eigene Achse und seinen eigenen Schalter. Der Kontenfilter gilt sehr wohl —
// er sagt, wessen Geld gemeint ist, und das ändert sich nicht, nur weil man auf
// eine andere Zeitspanne schaut.

export const TREND_RANGES = Object.freeze([
  { id: '3M', label: '3M', months: 3, granularity: 'month' },
  { id: '6M', label: '6M', months: 6, granularity: 'month' },
  { id: '1J', label: '1J', months: 12, granularity: 'month' },
  { id: '3J', label: '3J', months: 36, granularity: 'quarter' },
  { id: 'Max', label: 'Max', months: null, granularity: 'year' },
])

export const DEFAULT_TREND_RANGE = '6M'

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const parts = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const monthBucket = (year, month) => ({
  key: `${year}-${pad(month)}`,
  label: (MONTHS_DE[month - 1] ?? '').slice(0, 3),
  fullLabel: `${MONTHS_DE[month - 1] ?? ''} ${year}`,
  start: iso(year, month, 1),
  end: iso(year, month, daysInMonth(year, month)),
})

const quarterBucket = (year, quarter) => {
  const first = quarter * 3 - 2
  const last = quarter * 3
  return {
    key: `${year}-Q${quarter}`,
    label: `Q${quarter}`,
    fullLabel: `Q${quarter} ${year}`,
    start: iso(year, first, 1),
    end: iso(year, last, daysInMonth(year, last)),
  }
}

const yearBucket = (year) => ({
  key: String(year),
  label: String(year).slice(2),
  fullLabel: String(year),
  start: iso(year, 1, 1),
  end: iso(year, 12, 31),
})

/**
 * Die Eimer einer Zeitspanne, ältester zuerst.
 *
 * @param {string} rangeId
 * @param {string} todayIso
 * @param {string|null} earliestIso  das älteste Buchungsdatum — nur „Max" liest es
 */
export function trendBuckets(rangeId, todayIso, earliestIso = null) {
  const range = TREND_RANGES.find((r) => r.id === rangeId) ?? TREND_RANGES[1]
  const today = parts(todayIso)
  if (!today) return []
  const [year, month] = today

  if (range.granularity === 'month') {
    const buckets = []
    for (let i = range.months - 1; i >= 0; i -= 1) {
      const total = year * 12 + (month - 1) - i
      buckets.push(monthBucket(Math.floor(total / 12), (total % 12) + 1))
    }
    return buckets
  }

  if (range.granularity === 'quarter') {
    const currentQuarter = Math.ceil(month / 3)
    const count = range.months / 3
    const buckets = []
    for (let i = count - 1; i >= 0; i -= 1) {
      const total = year * 4 + (currentQuarter - 1) - i
      buckets.push(quarterBucket(Math.floor(total / 4), (total % 4) + 1))
    }
    return buckets
  }

  // Max: von der ältesten Buchung bis heute. Ohne eine einzige Buchung bleibt
  // das laufende Jahr übrig — ein leerer Balken ist ehrlicher als eine leere
  // Fläche ohne Achse.
  const first = parts(earliestIso)?.[0] ?? year
  const from = Math.min(first, year)
  const buckets = []
  for (let y = from; y <= year; y += 1) buckets.push(yearBucket(y))
  return buckets
}

/**
 * Die Ausgabenentwicklung.
 *
 * @param {{
 *   entries?: Array<object>,
 *   range?: string,
 *   today: string,
 * }} input
 * @returns {{range: string, granularity: string, buckets: Array<object>, max: number}}
 */
export function trendSeries({ entries = [], range = DEFAULT_TREND_RANGE, today } = {}) {
  const definition = TREND_RANGES.find((r) => r.id === range) ?? TREND_RANGES[1]

  let earliest = null
  for (const entry of entries) {
    if (!entry?.included || !entry.bookingDate) continue
    if (!earliest || entry.bookingDate < earliest) earliest = entry.bookingDate
  }

  const buckets = trendBuckets(definition.id, today, earliest).map((bucket) => ({
    ...bucket,
    amount: 0,
    count: 0,
    // Auch am letzten Tag noch angeschnitten: der Tag ist nicht vorbei, und ein
    // Balken, der sich am 30. September fertig nennt, behauptet einen Monat, von
    // dem noch Stunden fehlen.
    isPartial: today >= bucket.start && today <= bucket.end,
  }))

  // Ein Lauf über die Buchungen, ein Lauf über die Eimer: bei höchstens 36
  // Eimern ist die lineare Suche billiger als eine Map, und sie bleibt lesbar.
  for (const entry of entries) {
    if (!entry?.included || !entry.bookingDate) continue
    const expense = entry.effect?.expense ?? 0
    if (expense === 0 && entry.transactionType !== 'refund') continue
    const bucket = buckets.find(
      (b) => entry.bookingDate >= b.start && entry.bookingDate <= b.end
    )
    if (!bucket) continue
    bucket.amount += expense
    bucket.count += 1
  }

  return {
    range: definition.id,
    granularity: definition.granularity,
    buckets,
    max: buckets.reduce((m, b) => Math.max(m, b.amount), 0),
  }
}
