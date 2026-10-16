import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Segmented from '../../components/Segmented'
import FinanceTrendChart from '../../components/FinanceTrendChart'
import FinanceTransactionSheet from '../../components/FinanceTransactionSheet'
import {
  FinanceCategoryRow,
  FinanceHint,
  FinanceListCard,
  FinanceMerchantRow,
  FinanceSection,
  FinanceTransactionRow,
} from '../../components/FinanceRows'
import {
  FinanceMixedNotice,
  FinanceScopeBar,
  FinanceScopeSheets,
  useFinanceAccountLabel,
} from '../../components/FinanceScope'
import { useFinance } from '../../context/FinanceContext'
import { useFinanceView } from '../../context/FinanceViewContext'
import { TREND_RANGES, categoryDetail } from '../../lib/finance/analytics'
import { FINANCE_ROUTES, categoryRoute, merchantRoute } from '../../lib/finance/routes'
import { plural } from '../../lib/finance/importFlow'
import {
  FinanceDetailHeader,
  FinanceDetailLoading,
  FinanceLinkRow,
  FinanceSummaryCard,
  useFinanceBack,
  useFinanceScrollMemory,
} from './shared'

// Eine Kategorie — Ober- oder Unterkategorie, dieselbe Route (v1.27).
//
// DIE REIHENFOLGE IST DIE FRAGE, DIE MAN STELLT: wie viel (Zusammenfassung),
// wofür genau (Aufteilung — nur bei einer Oberkategorie), seit wann
// (Entwicklung), wo (Top-Händler), und welche Buchungen es waren. Jede Zahl
// kommt aus `categoryDetail`; dieser Bildschirm rechnet nichts.
//
// ZWEI EBENEN, KEINE DRITTE. Eine Oberkategorie zeigt ihre Kinder, ein Kind
// zeigt keine weitere Aufteilung, sondern einen leisen Weg zurück zu seiner
// Oberkategorie — „Teil von Essen & Trinken", keine Brotkrumenleiste.
export default function CategoryDetail() {
  const { categoryId } = useParams()
  const { categories, loading } = useFinance()
  const { scopeFor, trendRange, setTrendRange } = useFinanceView()
  const navigate = useNavigate()
  const back = useFinanceBack(FINANCE_ROUTES.categories)
  const accountLabel = useFinanceAccountLabel()
  const [sheet, setSheet] = useState(null)
  const [openTransactionId, setOpenTransactionId] = useState(null)
  useFinanceScrollMemory()

  const scope = useMemo(() => scopeFor(), [scopeFor])
  const detail = useMemo(
    () => categoryDetail({ scope, categories, categoryId, trendRange }),
    [scope, categories, categoryId, trendRange]
  )

  // Als ID gehalten, nicht als Objekt — nach einem Löschen findet sich nichts
  // mehr, und das Sheet geht zu (wie auf dem Buchungen-Tab).
  const openEntry = openTransactionId
    ? scope.allEntries.find((e) => e.id === openTransactionId) ?? null
    : null

  if (!detail.found) {
    return (
      <div className="min-h-screen pb-28">
        <FinanceDetailHeader title="Kategorie" onBack={back} />
        {loading ? (
          <FinanceDetailLoading />
        ) : (
          <p className="mt-20 px-5 text-center text-body text-text-secondary">
            Kategorie nicht gefunden.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-28">
      <FinanceDetailHeader title={detail.label} onBack={back} />
      <div className="px-5">
        <FinanceScopeBar
          className="mt-1"
          periodLabel={scope.periodLabel}
          accountLabel={accountLabel}
          onPeriod={() => setSheet('period')}
          onAccount={() => setSheet('account')}
        />
        <CategoryDetailView
          detail={detail}
          comparisonLabel={scope.comparisonLabel}
          currencies={scope.currencies}
          trendRange={trendRange}
          onTrendRange={setTrendRange}
          onPickAccount={() => setSheet('account')}
          onOpenCategory={(id) => navigate(categoryRoute(id))}
          onOpenMerchant={(key) => navigate(merchantRoute(key))}
          onOpenTransaction={setOpenTransactionId}
        />
      </div>
      <FinanceScopeSheets sheet={sheet} onClose={() => setSheet(null)} />
      {openEntry && (
        <FinanceTransactionSheet entry={openEntry} onClose={() => setOpenTransactionId(null)} />
      )}
    </div>
  )
}

/** Rein darstellend und ohne Router — für den Layout-Test exportiert. */
export function CategoryDetailView({
  detail,
  comparisonLabel,
  currencies = [],
  trendRange,
  onTrendRange,
  onPickAccount = null,
  onOpenCategory = null,
  onOpenMerchant = null,
  onOpenTransaction = null,
}) {
  const { currency } = detail
  const caption = [
    detail.percentage !== null ? `${Math.round(detail.percentage)} % deiner Ausgaben` : null,
    plural(detail.count, 'Buchung', 'Buchungen'),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {detail.monetary ? (
        <FinanceSummaryCard
          amount={detail.amount}
          currency={currency}
          caption={caption}
          change={detail.change}
          comparisonLabel={comparisonLabel}
        />
      ) : (
        <FinanceMixedNotice currencies={currencies} onPickAccount={onPickAccount} />
      )}

      {!detail.isParent && detail.parent && (
        <FinanceLinkRow
          label={`Teil von ${detail.parent.label}`}
          onClick={onOpenCategory ? () => onOpenCategory(detail.parent.id) : undefined}
        />
      )}

      {detail.isParent && detail.children.length > 0 && (
        <FinanceSection title="Aufteilung">
          <FinanceListCard>
            {detail.children.map((row, index) => (
              <FinanceCategoryRow
                key={row.category?.id ?? index}
                row={row}
                currency={currency}
                bordered={index > 0}
                icon={false}
                onOpen={onOpenCategory && row.category?.id ? () => onOpenCategory(row.category.id) : null}
              />
            ))}
          </FinanceListCard>
        </FinanceSection>
      )}

      {detail.monetary && (
        <FinanceSection title="Entwicklung">
          <Segmented
            options={TREND_RANGES.map((r) => ({ id: r.id, label: r.label }))}
            value={trendRange}
            onChange={onTrendRange}
            ariaLabel="Zeitspanne der Entwicklung"
          />
          <div className="mt-4 rounded-card bg-bg-card px-4 py-4">
            <FinanceTrendChart series={detail.trend} currency={currency} />
          </div>
        </FinanceSection>
      )}

      {/* Kein Händler, kein Abschnitt — eine leere Karte mit „keine Händler"
          wäre Fläche ohne Aussage. */}
      {detail.merchants.length > 0 && (
        <FinanceSection title="Top-Händler">
          <FinanceListCard>
            {detail.merchants.map((merchant, index) => (
              <FinanceMerchantRow
                key={merchant.key}
                merchant={merchant}
                currency={currency}
                bordered={index > 0}
                onOpen={onOpenMerchant ? () => onOpenMerchant(merchant.key) : null}
              />
            ))}
          </FinanceListCard>
        </FinanceSection>
      )}

      <FinanceSection title="Buchungen">
        {detail.bookings.length === 0 ? (
          <FinanceHint>In diesem Zeitraum gibt es in dieser Kategorie keine Buchung.</FinanceHint>
        ) : (
          <FinanceListCard>
            {detail.bookings.map((entry, index) => (
              <FinanceTransactionRow
                key={entry.id}
                entry={entry}
                bordered={index > 0}
                // Bei einer Oberkategorie unterscheidet erst die Unterkategorie
                // „REWE" von „REWE".
                detail={detail.isParent && entry.category?.id !== detail.category.id
                  ? entry.category?.label ?? null
                  : null}
                onOpen={onOpenTransaction ? () => onOpenTransaction(entry.id) : null}
              />
            ))}
          </FinanceListCard>
        )}
      </FinanceSection>
    </>
  )
}
