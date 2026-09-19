import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import TopBar from '../components/TopBar'
import Segmented from '../components/Segmented'
import CategoryIcon from '../components/CategoryIcon'
import MerchantAvatar from '../components/MerchantAvatar'
import FinancePeriodSheet from '../components/FinancePeriodSheet'
import FinanceAccountFilterSheet from '../components/FinanceAccountFilterSheet'
import FinanceTrendChart from '../components/FinanceTrendChart'
import { SkeletonExpenseList } from '../components/Skeleton'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import {
  DEFAULT_TREND_RANGE,
  TREND_RANGES,
  buildFinanceDashboard,
  currentMonthPeriod,
  excludedMerchants,
} from '../lib/finance/analytics'
import { formatAmountMinor, formatBookingDate, plural } from '../lib/finance/importFlow'
import { todayISO } from '../lib/date'

// Finanzen — das Dashboard.
//
// WAS SICH GEGENÜBER v1.25 ÄNDERT, und warum es kein Selbstzweck ist: bis hier
// hatte dieser Bildschirm nichts zu zeigen außer „wie viele Umsätze gibt es"
// und einem Weg hinein. Mit der zweistufigen Taxonomie (0014) gibt es zum ersten
// Mal etwas zu summieren, das eine Aussage trägt — und ein Zahlenfeld über einer
// Kategorie ist erst dann eine Aussage, wenn daneben steht, WELCHE Zeit gemeint
// ist und WESSEN Geld.
//
// KEINE ZAHL WIRD HIER GERECHNET. Alles, was unten steht, kommt aus einem
// einzigen Aufruf von `buildFinanceDashboard` — derselbe Zeitraum, dieselbe
// Vorzeichenregel, dieselbe Einordnung für jede Kachel. Das ist der eine Grund,
// warum die Summe der Kategorien nicht von der Summe darüber abweichen kann:
// es gibt sie nur einmal.
//
// WAS DIESER SCHIRM WEITERHIN SCHULDET. Der laute Weg hinein bleibt laut:
// „Hinzufügen" steht direkt unter der Kennzahl, weil Geld eintragen die
// häufigste Handlung dieses Moduls ist und ein Dashboard, das sie nach unten
// schiebt, ein schöneres und schlechteres Dashboard wäre. Die Kontoverwaltung
// bleibt erreichbar und bleibt leise, genau wie in v1.25.
//
// WAS ER NICHT TUT: keine Budgets, keine Abo-Erkennung, keine Vermögenskurve,
// keine KI-Einsichten. Jede dieser Kacheln wäre eine Behauptung über Daten, die
// heute niemand geprüft hat.

const TABS = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'bookings', label: 'Buchungen' },
]

export default function Finanzen() {
  const {
    transactions, accounts, archivedAccounts, patterns, merchants, categories,
    categoryRules, overrides, aiSuggestions, loading, error,
  } = useFinance()
  const { openFinanceAdd, openFinanceAccounts, openFinanceClassify, openFinanceExclusions } = useUI()

  const today = todayISO()
  const [tab, setTab] = useState('overview')
  // Der Standard ist der laufende Kalendermonat — die Frage, die ein Mensch an
  // seine Ausgaben zuerst stellt.
  const [period, setPeriod] = useState(() => currentMonthPeriod(today))
  // `null` heißt „Alle Konten", archivierte eingeschlossen.
  const [accountId, setAccountId] = useState(null)
  const [trendRange, setTrendRange] = useState(DEFAULT_TREND_RANGE)
  const [sheet, setSheet] = useState(null) // 'period' | 'account' | null

  const dashboard = useMemo(
    () =>
      buildFinanceDashboard({
        transactions, accounts, categories, merchants, patterns,
        rules: categoryRules, overrides, aiSuggestions,
        period, accountId, trendRange, today,
      }),
    [transactions, accounts, categories, merchants, patterns, categoryRules, overrides,
     aiSuggestions, period, accountId, trendRange, today]
  )

  const excluded = useMemo(() => excludedMerchants(merchants), [merchants])
  const archivedIds = useMemo(() => archivedAccounts.map((a) => a.id), [archivedAccounts])
  // Die Währung sagt die Pipeline, nicht dieser Screen — sie hat die Buchungen
  // gesehen. Heute ist das immer EUR; wer ein Konto in einer anderen Währung
  // anlegt, bekommt deren Zeichen statt eines falschen.
  const currency = dashboard.currency

  const isEmpty = !loading && transactions.length === 0
  const accountLabel = accountId
    ? accounts.find((a) => a.id === accountId)?.name ?? 'Konto'
    : 'Alle Konten'

  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Finanzen" />

      <div className="px-5">
        {loading ? (
          <div className="pt-4">
            <SkeletonExpenseList />
          </div>
        ) : isEmpty ? (
          <>
            <AddButton onClick={openFinanceAdd} />
            <EmptyState failed={Boolean(error)} />
          </>
        ) : (
          <>
            {/* Die Tabs gehören zum Bildschirm, nicht in die TopBar — dieselbe
                Regel, nach der der Kalender seine Datumszeile unter die Leiste
                stellt (G22). */}
            <Segmented
              options={TABS}
              value={tab}
              onChange={setTab}
              ariaLabel="Finanzen-Ansicht"
              className="mt-1"
            />

            <div className="mt-3 flex gap-2">
              <FilterButton
                label={dashboard.periodLabel}
                onClick={() => setSheet('period')}
                ariaLabel="Zeitraum ändern"
              />
              <FilterButton
                label={accountLabel}
                onClick={() => setSheet('account')}
                ariaLabel="Konto ändern"
              />
            </div>

            {dashboard.summary.latestBookingDate && (
              <p className="mt-2 px-1 text-caption text-text-muted">
                Daten bis {formatBookingDate(dashboard.summary.latestBookingDate)}
              </p>
            )}

            {tab === 'overview' ? (
              dashboard.mixedCurrency ? (
                <MixedCurrency
                  dashboard={dashboard}
                  onPickAccount={() => setSheet('account')}
                  onAdd={openFinanceAdd}
                  onClassify={openFinanceClassify}
                />
              ) : (
                <Overview
                  dashboard={dashboard}
                  currency={currency}
                  trendRange={trendRange}
                  onTrendRange={setTrendRange}
                  onAdd={openFinanceAdd}
                  onClassify={openFinanceClassify}
                />
              )
            ) : (
              <Bookings dashboard={dashboard} />
            )}

            {excluded.length > 0 && (
              <QuietRow onClick={openFinanceExclusions} label="Aus Auswertung ausgeschlossen">
                <span className="shrink-0 tabular-nums text-body text-text-secondary">
                  {excluded.length}
                </span>
              </QuietRow>
            )}

            {accounts.length > 0 && (
              <QuietRow onClick={openFinanceAccounts} label="Konten verwalten" />
            )}
          </>
        )}
      </div>

      <FinancePeriodSheet
        open={sheet === 'period'}
        onClose={() => setSheet(null)}
        value={period}
        today={today}
        onApply={setPeriod}
      />
      <FinanceAccountFilterSheet
        open={sheet === 'account'}
        onClose={() => setSheet(null)}
        accounts={accounts}
        archivedIds={archivedIds}
        value={accountId}
        onChange={setAccountId}
      />
    </div>
  )
}

// Zwei Währungen, und deshalb keine Zahl.
//
// WARUM HIER NICHTS STEHT, WAS WIE EINE SUMME AUSSIEHT: die Beträge liegen in
// Minor Units ohne Kurs. 24,83 € und 24,83 AU$ zusammenzuzählen ergibt 49,66
// von nichts — und das Schlimme daran ist nicht der Fehler, sondern dass er
// aussieht wie ein Ergebnis. Also sagt dieser Bildschirm, was los ist, und
// bietet die Abhilfe an, statt eine Zahl zu zeigen, der niemand trauen kann.
//
// Was WEITERHIN geht, weil es keine Summe ist: die offenen Zuordnungen, der
// Weg hinein, und der Buchungen-Tab — dort trägt jede Zeile ihre eigene
// Währung und steht für sich.
export function MixedCurrency({ dashboard, onPickAccount, onAdd, onClassify }) {
  return (
    <>
      <section className="mt-3 rounded-card border border-subtle bg-bg-card px-4 py-4">
        <h2 className="text-section font-semibold text-text-primary">Mehrere Währungen</h2>
        <p className="mt-1.5 text-body text-text-secondary">
          Wähle ein einzelnes Konto, um Beträge korrekt auszuwerten.
        </p>
        <p className="mt-2 text-caption text-text-muted">
          In dieser Auswahl liegen {dashboard.currencies.join(' und ')}. Umgerechnet wird nicht —
          eine Summe über zwei Währungen wäre keine.
        </p>
        <button
          onClick={onPickAccount}
          className="press-tint mt-4 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
        >
          Konto wählen
        </button>
      </section>

      <AddButton onClick={onAdd} />

      {dashboard.summary.openClassifications > 0 && (
        <OpenClassifications
          count={dashboard.summary.openClassifications}
          onClick={onClassify}
        />
      )}

      <p className="mt-6 px-1 text-caption text-text-secondary">
        Die einzelnen Buchungen stehen im Tab „Buchungen" — jede mit ihrer eigenen Währung.
      </p>
    </>
  )
}

// ── Übersicht ───────────────────────────────────────────────────────────────
//
// Exportiert wie `AccountList` und `AccountDetail` in FinanceAccountsSheet, und
// aus demselben Grund: tools/financeDashboardLayout.mjs rendert diesen Block in
// einem echten Browser und misst ihn bei 390, 430 und Desktop. Eine Attrappe des
// Markups im Test wäre ein Test über die Attrappe.
export function Overview({ dashboard, currency, trendRange, onTrendRange, onAdd, onClassify }) {
  const { summary, categories, merchants, biggest, trend } = dashboard

  return (
    <>
      <KpiCard summary={summary} currency={currency} comparisonLabel={dashboard.comparisonLabel} />

      <AddButton onClick={onAdd} />

      {/* Nur wenn etwas offen ist. Eine leere Warteschlange bekommt keine Zeile,
          die sagt, dass sie leer ist — §18: Rückmeldung ist verhältnismäßig. */}
      {summary.openClassifications > 0 && (
        <OpenClassifications count={summary.openClassifications} onClick={onClassify} />
      )}

      <Section
        title="Ausgaben nach Kategorie"
        action={categories.parents.length > 0 ? 'Alle anzeigen' : null}
      >
        {categories.top.length === 0 ? (
          <Hint>In diesem Zeitraum ist noch keine Ausgabe einer Kategorie zugeordnet.</Hint>
        ) : (
          <div className="rounded-card bg-bg-card px-4 py-1">
            {categories.top.map((row, index) => (
              <CategoryRow
                key={row.category?.id ?? index}
                row={row}
                currency={currency}
                bordered={index > 0}
              />
            ))}
          </div>
        )}
        {categories.unassigned.count > 0 && (
          <p className="mt-2 px-1 text-caption text-text-secondary">
            {plural(categories.unassigned.count, 'Buchung ist', 'Buchungen sind')} noch keiner
            Kategorie zugeordnet ({formatAmountMinor(categories.unassigned.amount, currency)}) —
            sie zählen in den Gesamtausgaben.
          </p>
        )}
      </Section>

      <Section title="Ausgabenentwicklung">
        <Segmented
          options={TREND_RANGES.map((r) => ({ id: r.id, label: r.label }))}
          value={trendRange}
          onChange={onTrendRange}
          ariaLabel="Zeitspanne der Entwicklung"
        />
        <div className="mt-4 rounded-card bg-bg-card px-4 py-4">
          <FinanceTrendChart series={trend} currency={currency} />
        </div>
      </Section>

      <Section title="Top-Händler" action={merchants.merchants.length > 0 ? 'Alle anzeigen' : null}>
        {merchants.merchants.length === 0 ? (
          <Hint>In diesem Zeitraum ist noch keine Ausgabe einem Händler zugeordnet.</Hint>
        ) : (
          <div className="rounded-card bg-bg-card px-4 py-1">
            {merchants.merchants.map((merchant, index) => (
              <div
                key={merchant.key}
                className={`flex min-h-[56px] items-center gap-3 py-2.5 ${
                  index > 0 ? 'border-t border-subtle' : ''
                }`}
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
              </div>
            ))}
          </div>
        )}
      </Section>

      {biggest.length > 0 && (
        <Section title="Größte Ausgaben">
          {/* Keine Karte je Zeile: drei Karten untereinander wären dreimal
              dieselbe Betonung für eine Liste, die eine Liste ist. */}
          <div className="rounded-card bg-bg-card px-4 py-1">
            {biggest.map((item, index) => (
              <div
                key={item.id}
                className={`flex min-h-[56px] items-center gap-3 py-2.5 ${
                  index > 0 ? 'border-t border-subtle' : ''
                }`}
              >
                <MerchantAvatar name={item.title} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-text-primary">{item.title}</p>
                  <p className="truncate text-caption text-text-secondary">
                    {item.category.label || 'Nicht zugeordnet'}
                    {item.bookingDate ? ` · ${formatBookingDate(item.bookingDate)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-body font-semibold text-text-primary">
                  {formatAmountMinor(item.amount, currency)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// Eine dominante Karte, und nur eine.
//
// DIE FARBE SAGT NICHTS ÜBER AUSGABEN. „+8 %" ist nicht rot: ob mehr ausgeben
// gut oder schlecht war, weiß dieser Bildschirm nicht, und eine Farbe, die es
// behauptet, wäre eine Wertung, die der Nutzer nicht bestellt hat (§14: Hierarchie
// über Größe und Position, nicht über Farbe). Der Cashflow darf grün oder rot
// sein — dort IST das Vorzeichen die Aussage.
function KpiCard({ summary, currency, comparisonLabel }) {
  const change = summary.expenseChange
  return (
    <section className="mt-3 rounded-card border border-subtle bg-bg-card px-4 py-4">
      <h2 className="text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        Ausgaben
      </h2>
      <p className="mt-1.5 text-page font-bold tabular-nums leading-tight text-text-primary">
        {formatAmountMinor(summary.expenses, currency)}
      </p>
      <p className="mt-1 text-caption text-text-secondary">
        {change.comparable ? (
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

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-subtle pt-3">
        <div className="min-w-0">
          <p className="text-label text-text-secondary">Einnahmen</p>
          <p className="mt-0.5 truncate text-body font-semibold tabular-nums text-text-primary">
            {formatAmountMinor(summary.income, currency)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-label text-text-secondary">Cashflow</p>
          <p
            className={`mt-0.5 truncate text-body font-semibold tabular-nums ${
              summary.cashflow > 0
                ? 'text-success'
                : summary.cashflow < 0
                  ? 'text-danger'
                  : 'text-text-primary'
            }`}
          >
            {summary.cashflow > 0 ? '+' : ''}
            {formatAmountMinor(summary.cashflow, currency)}
          </p>
        </div>
      </div>
    </section>
  )
}

function CategoryRow({ row, currency, bordered }) {
  const percent = row.percentage === null ? null : Math.round(row.percentage)
  return (
    <div className={`flex min-h-[56px] items-center gap-3 py-2.5 ${bordered ? 'border-t border-subtle' : ''}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-bg-input text-text-secondary">
        <CategoryIcon slug={row.category?.slug} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-body text-text-primary">
            {row.category?.label ?? 'Kategorie'}
          </p>
          <span className="shrink-0 tabular-nums text-body font-semibold text-text-primary">
            {formatAmountMinor(row.amount, currency)}
          </span>
          {percent !== null && (
            <span className="w-9 shrink-0 text-right tabular-nums text-caption text-text-secondary">
              {percent} %
            </span>
          )}
        </div>
        {/* Alle Balken blau. Eine Farbe je Kategorie wäre eine Palette, die
            niemand entschieden hat — die Länge trägt die Aussage. */}
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-input">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Buchungen ───────────────────────────────────────────────────────────────
//
// Die schlichte Liste dessen, was im gewählten Zeitraum auf den gewählten Konten
// gebucht wurde — dieselben aufgelösten Einträge wie die Übersicht, nur ohne
// Summe. Bewusst ohne Suche, ohne Filter und ohne Bearbeiten: der vollständige
// Buchungen-Tab ist ein eigenes Stück Arbeit, und eine halbe Suchleiste, die
// nichts findet, wäre schlimmer als keine.
export function Bookings({ dashboard }) {
  const rows = useMemo(
    () =>
      dashboard.periodEntries
        .slice()
        .sort(
          (a, b) =>
            String(b.bookingDate ?? '').localeCompare(String(a.bookingDate ?? '')) ||
            String(a.id ?? '').localeCompare(String(b.id ?? ''))
        ),
    [dashboard.periodEntries]
  )

  if (rows.length === 0) {
    return (
      <Section title="Buchungen">
        <Hint>In diesem Zeitraum gibt es auf diesen Konten keine Buchung.</Hint>
      </Section>
    )
  }

  return (
    <Section title="Buchungen">
      <div className="rounded-card bg-bg-card px-4 py-1">
        {rows.map((entry, index) => (
          <div
            key={entry.id}
            className={`flex min-h-[56px] items-center gap-3 py-2.5 ${
              index > 0 ? 'border-t border-subtle' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-text-primary">
                {entry.merchantName || entry.description}
              </p>
              <p className="truncate text-caption text-text-secondary">
                {formatBookingDate(entry.bookingDate)}
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
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Bausteine ───────────────────────────────────────────────────────────────

function OpenClassifications({ count, onClick }) {
  return (
    <button
      onClick={onClick}
      className="press-tint mt-3 flex min-h-[44px] w-full items-center gap-3 rounded-card bg-bg-card px-4 py-2.5 text-left"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="min-w-0 flex-1 text-body text-text-primary">
        {plural(count, 'Buchung prüfen', 'Buchungen prüfen')}
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}

function AddButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="press-tint mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
    >
      <Plus size={18} /> Hinzufügen
    </button>
  )
}

function FilterButton({ label, onClick, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="press-tint flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 rounded-btn bg-bg-input px-3.5 py-2 text-left"
    >
      <span className="min-w-0 flex-1 truncate text-ui text-text-primary">{label}</span>
      <ChevronDown size={16} className="shrink-0 text-text-secondary" />
    </button>
  )
}

function Section({ title, action = null, children }) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline gap-3 px-1">
        <h2 className="min-w-0 flex-1 truncate text-section font-semibold text-text-primary">
          {title}
        </h2>
        {action && <span className="shrink-0 text-ui text-text-muted">{action}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Hint({ children }) {
  return <p className="px-1 text-caption text-text-secondary">{children}</p>
}

function QuietRow({ onClick, label, children = null }) {
  return (
    <button
      onClick={onClick}
      className="press-tint mt-3 flex min-h-[44px] w-full items-center gap-3 rounded-card bg-bg-card px-4 py-2 text-left"
    >
      <span className="min-w-0 flex-1 text-body text-text-primary">{label}</span>
      {children}
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}

// Same two meanings as everywhere else in the app: "nothing here yet" is a
// normal state with an invitation, "we could not reach the database" is not and
// says so honestly.
function EmptyState({ failed = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-section font-semibold text-text-secondary">
        {failed ? 'Keine Daten geladen' : 'Noch keine Umsätze'}
      </p>
      <p className="mt-1 max-w-[280px] text-ui text-text-secondary">
        {failed
          ? 'Sobald die Verbindung wieder steht, sind deine Umsätze da.'
          : 'Trage eine Buchung von Hand ein oder lass deinen Kontoauszug über ChatGPT einlesen.'}
      </p>
    </div>
  )
}
