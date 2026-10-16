import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import TopBar from '../components/TopBar'
import Segmented from '../components/Segmented'
import MerchantAvatar from '../components/MerchantAvatar'
import FinanceTrendChart from '../components/FinanceTrendChart'
import FinanceTransactionSheet from '../components/FinanceTransactionSheet'
import {
  FinanceCategoryRow,
  FinanceChangeLine,
  FinanceHint,
  FinanceListCard,
  FinanceMerchantRow,
  FinanceSection,
  FinanceTransactionRow,
} from '../components/FinanceRows'
import {
  FinanceMixedNotice,
  FinanceScopeBar,
  FinanceScopeSheets,
  useFinanceAccountLabel,
} from '../components/FinanceScope'
import { SkeletonExpenseList } from '../components/Skeleton'
import { useFinance } from '../context/FinanceContext'
import { useFinanceView } from '../context/FinanceViewContext'
import { useUI } from '../context/UIContext'
import { useFinanceScrollMemory } from './finance/shared'
import {
  TREND_RANGES,
  buildFinanceDashboard,
  excludedMerchants,
  newestFirst,
} from '../lib/finance/analytics'
import { FINANCE_ROUTES, categoryRoute, merchantRoute } from '../lib/finance/routes'
import { formatAmountMinor, formatBookingDate, plural } from '../lib/finance/importFlow'

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
//
// SEIT v1.27 IST DIE ÜBERSICHT NAVIGIERBAR. „Alle anzeigen", jede Kategorie-
// und jede Händlerzeile führen auf eine eigene Seite (src/screens/finance/).
// Zeitraum, Konto und Verlaufsspanne liegen dafür nicht mehr hier, sondern im
// FinanceViewContext — derselbe Zustand für alle Finanz-Bildschirme, damit
// „Letzte 30 Tage · DKB" nach dem Zurück noch dasteht. Die Einordnung aller
// Buchungen kommt von dort ebenfalls, einmal aufgelöst.

const TABS = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'bookings', label: 'Buchungen' },
]

export default function Finanzen() {
  const {
    transactions, accounts, merchants, categories, loading, error,
  } = useFinance()
  const { openFinanceAdd, openFinanceAccounts, openFinanceClassify, openFinanceExclusions } = useUI()
  // Der Standard ist der laufende Kalendermonat — die Frage, die ein Mensch an
  // seine Ausgaben zuerst stellt (`period = null`, siehe FinanceViewContext).
  const { today, period, accountId, trendRange, setTrendRange, resolveEntries } = useFinanceView()
  const navigate = useNavigate()
  useFinanceScrollMemory()

  const [tab, setTab] = useState('overview')
  const [sheet, setSheet] = useState(null) // 'period' | 'account' | null
  // Welche Buchung gerade offen ist — als ID und nicht als Objekt, damit das
  // Sheet nach jedem Reload den frischen Eintrag sieht statt einer Kopie von
  // vorhin. Ist die Buchung weg (gelöscht, hier oder auf einem anderen Gerät),
  // findet sich nichts, und es wird nichts gezeigt.
  const [openTransactionId, setOpenTransactionId] = useState(null)

  const dashboard = useMemo(
    () =>
      buildFinanceDashboard({
        resolved: resolveEntries(), accounts, categories,
        period, accountId, trendRange, today,
      }),
    [resolveEntries, accounts, categories, period, accountId, trendRange, today]
  )

  const excluded = useMemo(() => excludedMerchants(merchants), [merchants])
  // Die Währung sagt die Pipeline, nicht dieser Screen — sie hat die Buchungen
  // gesehen. Heute ist das immer EUR; wer ein Konto in einer anderen Währung
  // anlegt, bekommt deren Zeichen statt eines falschen.
  const currency = dashboard.currency

  const openEntry = openTransactionId
    ? dashboard.entries.find((e) => e.id === openTransactionId) ?? null
    : null

  const isEmpty = !loading && transactions.length === 0
  const accountLabel = useFinanceAccountLabel()

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

            <FinanceScopeBar
              periodLabel={dashboard.periodLabel}
              accountLabel={accountLabel}
              onPeriod={() => setSheet('period')}
              onAccount={() => setSheet('account')}
            />

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
                  onAllCategories={() => navigate(FINANCE_ROUTES.categories)}
                  onOpenCategory={(id) => navigate(categoryRoute(id))}
                  onAllMerchants={() => navigate(FINANCE_ROUTES.merchants)}
                  onOpenMerchant={(key) => navigate(merchantRoute(key))}
                />
              )
            ) : (
              <Bookings dashboard={dashboard} onOpen={setOpenTransactionId} />
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

      <FinanceScopeSheets sheet={sheet} onClose={() => setSheet(null)} />
      {openEntry && (
        <FinanceTransactionSheet entry={openEntry} onClose={() => setOpenTransactionId(null)} />
      )}
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
      <FinanceMixedNotice currencies={dashboard.currencies} onPickAccount={onPickAccount} />

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
//
// Die Navigation kommt als Rückruf herein und nicht über `useNavigate`: so
// bleibt der Block ohne Router renderbar, und der Layout-Test misst weiterhin
// genau das, was auf dem Schirm steht.
export function Overview({
  dashboard, currency, trendRange, onTrendRange, onAdd, onClassify,
  onAllCategories = null, onOpenCategory = null, onAllMerchants = null, onOpenMerchant = null,
}) {
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

      {/* „Alle anzeigen" steht da, sobald es überhaupt Kategorien gibt — auch
          bei nur drei Zeilen: die Kategorie-Seite zeigt zusätzlich die leeren
          Kategorien und „Nicht zugeordnet", also mehr als diese Karte. */}
      <FinanceSection
        title="Ausgaben nach Kategorie"
        action={
          categories.parents.length > 0 && onAllCategories
            ? { label: 'Alle anzeigen', onClick: onAllCategories }
            : null
        }
      >
        {categories.top.length === 0 ? (
          <FinanceHint>In diesem Zeitraum ist noch keine Ausgabe einer Kategorie zugeordnet.</FinanceHint>
        ) : (
          <FinanceListCard>
            {categories.top.map((row, index) => (
              <FinanceCategoryRow
                key={row.category?.id ?? index}
                row={row}
                currency={currency}
                bordered={index > 0}
                onOpen={
                  onOpenCategory && row.category?.id ? () => onOpenCategory(row.category.id) : null
                }
              />
            ))}
          </FinanceListCard>
        )}
        {categories.unassigned.count > 0 && (
          <p className="mt-2 px-1 text-caption text-text-secondary">
            {plural(categories.unassigned.count, 'Buchung ist', 'Buchungen sind')} noch keiner
            Kategorie zugeordnet ({formatAmountMinor(categories.unassigned.amount, currency)}) —
            sie zählen in den Gesamtausgaben.
          </p>
        )}
      </FinanceSection>

      <FinanceSection title="Ausgabenentwicklung">
        <Segmented
          options={TREND_RANGES.map((r) => ({ id: r.id, label: r.label }))}
          value={trendRange}
          onChange={onTrendRange}
          ariaLabel="Zeitspanne der Entwicklung"
        />
        <div className="mt-4 rounded-card bg-bg-card px-4 py-4">
          <FinanceTrendChart series={trend} currency={currency} />
        </div>
      </FinanceSection>

      <FinanceSection
        title="Top-Händler"
        action={
          merchants.merchants.length > 0 && onAllMerchants
            ? { label: 'Alle anzeigen', onClick: onAllMerchants }
            : null
        }
      >
        {merchants.merchants.length === 0 ? (
          <FinanceHint>In diesem Zeitraum ist noch keine Ausgabe einem Händler zugeordnet.</FinanceHint>
        ) : (
          <FinanceListCard>
            {merchants.merchants.map((merchant, index) => (
              <FinanceMerchantRow
                key={merchant.key}
                merchant={merchant}
                currency={currency}
                bordered={index > 0}
                onOpen={onOpenMerchant ? () => onOpenMerchant(merchant.key) : null}
              />
            ))}
          </FinanceListCard>
        )}
      </FinanceSection>

      {biggest.length > 0 && (
        <FinanceSection title="Größte Ausgaben">
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
        </FinanceSection>
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
      <FinanceChangeLine change={change} comparisonLabel={comparisonLabel} />

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

// ── Buchungen ───────────────────────────────────────────────────────────────
//
// Die schlichte Liste dessen, was im gewählten Zeitraum auf den gewählten Konten
// gebucht wurde — dieselben aufgelösten Einträge wie die Übersicht, nur ohne
// Summe. Bewusst ohne Suche und ohne Filter: der vollständige Buchungen-Tab ist
// ein eigenes Stück Arbeit, und eine halbe Suchleiste, die nichts findet, wäre
// schlimmer als keine.
//
// SEIT v1.26.1 IST JEDE ZEILE EIN KNOPF. Sie sah vorher schon aus wie eine
// Listenzeile, auf die man tippt, und tat nichts — genau die Art von Zeile, die
// eine App unzuverlässig wirken lässt. Sie öffnet jetzt das Detail-Sheet, in dem
// steht, was in die Zeile nicht hineinpasst, und in dem die Buchung gelöscht
// werden kann.
export function Bookings({ dashboard, onOpen }) {
  const rows = useMemo(() => newestFirst(dashboard.periodEntries), [dashboard.periodEntries])

  if (rows.length === 0) {
    return (
      <FinanceSection title="Buchungen">
        <FinanceHint>In diesem Zeitraum gibt es auf diesen Konten keine Buchung.</FinanceHint>
      </FinanceSection>
    )
  }

  return (
    <FinanceSection title="Buchungen">
      <FinanceListCard>
        {rows.map((entry, index) => (
          <FinanceTransactionRow
            key={entry.id}
            entry={entry}
            bordered={index > 0}
            onOpen={() => onOpen?.(entry.id)}
          />
        ))}
      </FinanceListCard>
    </FinanceSection>
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
