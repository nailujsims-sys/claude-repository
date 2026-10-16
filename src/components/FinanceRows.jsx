import { ChevronRight } from 'lucide-react'
import CategoryIcon from './CategoryIcon'
import MerchantAvatar from './MerchantAvatar'
import { formatAmountMinor, formatBookingDate, plural } from '../lib/finance/importFlow'

// Die Bausteine, aus denen jeder Finanz-Bildschirm seine Listen baut.
//
// WARUM DAS SEIT v1.27 EINE EIGENE DATEI IST. Bis v1.26.2 standen Kategorie-,
// Händler- und Buchungszeile als Markup in Finanzen.jsx, einmal, weil es sie
// einmal gab. Mit den Drilldowns erscheint jede davon auf drei bis vier
// Bildschirmen — und drei Kopien derselben zwanzig Klassen sind genau die
// Variantenbildung, die das Design-System ausschließt (Regel 1: gleiches
// Aussehen ⇒ gleiches Verhalten). Die Zeilen sind unverändert herausgezogen;
// neu ist nur, dass sie ein Knopf sein KÖNNEN.
//
// EINE ZEILE, DIE NAVIGIERT, TRÄGT DEN CHEVRON. Das ist das bestehende Muster
// dieser App — die Buchungszeile, „Buchungen prüfen", „Konten verwalten",
// die Listen — und es ist der Hinweis, an dem man eine antippbare Zeile von
// einer bloß lesbaren unterscheidet. Ohne `onOpen` bleibt eine Zeile, was sie
// war: eine Zeile ohne Chevron, auf die man nicht tippt.
//
// RÜCKMELDUNG AUF DEM DRUCK: `.press-tint`, wie jede andere Listenzeile. Die
// Höhe bleibt `min-h-[56px]` — über den 44 px, die ein Daumen braucht.

/**
 * Ein Abschnitt mit Überschrift und — optional — einer leisen Aktion rechts.
 *
 * `action` ist seit v1.27 eine echte Aktion ({label, onClick}) und kein bloßer
 * Text mehr. Die alte Form war ein `<span>`, das aussah wie ein Link und nichts
 * tat. Die Zurückhaltung bleibt: Ui-Schrift, keine Füllung, kein Akzent — nur
 * in Sekundärgrau statt Muted, weil eine Aktion lesbar sein muss (§22), und mit
 * einer 44 px hohen Trefferfläche, die über den Text hinausreicht, ohne die
 * Zeile höher zu machen.
 */
export function FinanceSection({ title, action = null, children, className = 'mt-6' }) {
  return (
    <section className={className}>
      <div className="flex min-h-[24px] items-center gap-3 px-1">
        <h2 className="min-w-0 flex-1 truncate text-section font-semibold text-text-primary">
          {title}
        </h2>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="press-tint -my-2.5 -mr-2 flex min-h-[44px] shrink-0 items-center rounded-chip px-2 text-ui text-text-secondary"
          >
            {action.label}
          </button>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function FinanceHint({ children }) {
  return <p className="px-1 text-caption text-text-secondary">{children}</p>
}

/** Die eine Karte, in der eine Liste von Zeilen steht. */
export function FinanceListCard({ children }) {
  return <div className="rounded-card bg-bg-card px-4 py-1">{children}</div>
}

const rowClass = (bordered, interactive) =>
  `flex min-h-[56px] w-full items-center gap-3 py-2.5 text-left ${
    interactive ? 'press-tint' : ''
  } ${bordered ? 'border-t border-subtle' : ''}`

/** Eine Zeile, die ein Knopf ist, wenn sie etwas öffnet — sonst nicht. */
function Row({ onOpen, ariaLabel, bordered, children }) {
  if (!onOpen) return <div className={rowClass(bordered, false)}>{children}</div>
  return (
    <button type="button" onClick={onOpen} aria-label={ariaLabel} className={rowClass(bordered, true)}>
      {children}
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}

/**
 * Eine Kategoriezeile: Icon, Name, Betrag, Anteil, Balken.
 *
 * `row.percentage` ist die Länge des Balkens UND die Zahl daneben — wovon der
 * Anteil gemessen wird, entscheidet der Aufrufer (Übersicht: alle Ausgaben;
 * Aufteilung: die Oberkategorie). `icon = false` lässt das Icon weg, wo jede
 * Zeile dasselbe hätte; `iconSlug` nimmt das Icon einer anderen Kategorie
 * (eine Unterkategorie hat keines und zeigt das ihrer Oberkategorie).
 *
 * `row.empty` — eine Kategorie ohne Buchung im Zeitraum — wird ruhig
 * gezeichnet: ohne Balken und ohne Prozentzahl, weil beides bei 0 nichts sagt.
 */
export function FinanceCategoryRow({
  row,
  currency,
  bordered = false,
  onOpen = null,
  icon = true,
  iconSlug = null,
}) {
  const label = row.label ?? row.category?.label ?? 'Kategorie'
  const empty = row.empty === true
  const percent = empty || row.percentage === null || row.percentage === undefined
    ? null
    : Math.round(row.percentage)
  return (
    <Row onOpen={onOpen} ariaLabel={onOpen ? `Kategorie öffnen: ${label}` : undefined} bordered={bordered}>
      {icon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-bg-input text-text-secondary">
          <CategoryIcon slug={iconSlug ?? row.category?.slug} size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={`min-w-0 flex-1 truncate text-body ${empty ? 'text-text-secondary' : 'text-text-primary'}`}>
            {label}
          </p>
          <span
            className={`shrink-0 tabular-nums text-body ${
              empty ? 'text-text-muted' : 'font-semibold text-text-primary'
            }`}
          >
            {formatAmountMinor(row.amount, currency)}
          </span>
          {percent !== null && (
            // Mindestens so breit wie „99 %", damit die Spalte bündig steht —
            // und breiter, wenn es „100 %" ist (in der Aufteilung einer
            // Oberkategorie mit einem Kind der Normalfall), statt umzubrechen.
            <span className="min-w-9 shrink-0 whitespace-nowrap text-right tabular-nums text-caption text-text-secondary">
              {percent} %
            </span>
          )}
        </div>
        {/* Alle Balken blau. Eine Farbe je Kategorie wäre eine Palette, die
            niemand entschieden hat — die Länge trägt die Aussage. */}
        {!empty && (
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-input">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
            />
          </div>
        )}
      </div>
    </Row>
  )
}

/** Eine Händlerzeile: Avatar, Name, Anzahl Buchungen, Betrag. */
export function FinanceMerchantRow({ merchant, currency, bordered = false, onOpen = null }) {
  return (
    <Row
      onOpen={onOpen}
      ariaLabel={onOpen ? `Händler öffnen: ${merchant.name}` : undefined}
      bordered={bordered}
    >
      <MerchantAvatar merchant={merchant.merchant} name={merchant.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-text-primary">{merchant.name}</p>
        <p className="truncate text-caption text-text-secondary">
          {plural(merchant.count, 'Buchung', 'Buchungen')}
        </p>
      </div>
      <span className="shrink-0 tabular-nums text-body font-semibold text-text-primary">
        {formatAmountMinor(merchant.amount, currency)}
      </span>
    </Row>
  )
}

/**
 * Eine Buchungszeile — dieselbe auf dem Buchungen-Tab und auf jeder
 * Detailseite. Sie trägt ihre EIGENE Währung, nicht die des Ausschnitts: eine
 * einzelne Buchung ist keine Summe und braucht keinen Kurs.
 *
 * `detail` hängt eine Angabe an die Datumszeile an (z. B. die Unterkategorie
 * auf der Seite eines Händlers), wo der Titel allein nicht unterscheidet.
 */
export function FinanceTransactionRow({ entry, bordered = false, onOpen = null, detail = null }) {
  const title = entry.merchantName || entry.description
  return (
    <Row onOpen={onOpen} ariaLabel={onOpen ? `Buchung öffnen: ${title}` : undefined} bordered={bordered}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-text-primary">{title}</p>
        <p className="truncate text-caption text-text-secondary">
          {formatBookingDate(entry.bookingDate)}
          {detail ? ` · ${detail}` : ''}
          {entry.included ? '' : ' · zählt nicht'}
        </p>
      </div>
      <span
        className={`shrink-0 tabular-nums text-body font-semibold ${
          entry.amountMinor > 0 ? 'text-success' : 'text-text-primary'
        }`}
      >
        {formatAmountMinor(entry.amountMinor, entry.currency)}
      </span>
    </Row>
  )
}

/**
 * „+6 % ggü. 1.–16. August" — die Vergleichszeile, wie sie unter der Kennzahl
 * des Dashboards steht.
 *
 * DIE FARBE SAGT NICHTS ÜBER AUSGABEN. Mehr ausgegeben ist nicht rot: ob das
 * gut oder schlecht war, weiß dieser Bildschirm nicht (§14). Akzent für die
 * Zahl, Sekundärgrau für den Rest.
 */
export function FinanceChangeLine({ change, comparisonLabel, className = 'mt-1' }) {
  return (
    <p className={`${className} text-caption text-text-secondary`}>
      {change?.comparable ? (
        <>
          <span className="font-semibold text-accent">
            {change.absolute >= 0 ? '+' : '−'}
            {Math.abs(Math.round(change.percent))} %
          </span>{' '}
          ggü. {comparisonLabel}
        </>
      ) : (
        // Kein Vergleichswert heißt keine Prozentzahl. „+100 %" gegenüber 0 €
        // wäre eine erfundene Zahl an der auffälligsten Stelle des Schirms.
        <>Kein Vergleichswert für {comparisonLabel}</>
      )}
    </p>
  )
}
