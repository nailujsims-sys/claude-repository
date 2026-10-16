import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Segmented from '../../components/Segmented'
import MerchantAvatar from '../../components/MerchantAvatar'
import FinanceTrendChart from '../../components/FinanceTrendChart'
import FinanceTransactionSheet from '../../components/FinanceTransactionSheet'
import {
  FinanceCategoryRow,
  FinanceHint,
  FinanceListCard,
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
import { TREND_RANGES, merchantDetail } from '../../lib/finance/analytics'
import { FINANCE_ROUTES, categoryRoute, decodeMerchantKey } from '../../lib/finance/routes'
import { formatAmountMinor, plural } from '../../lib/finance/importFlow'
import {
  FinanceDetailHeader,
  FinanceDetailLoading,
  FinanceSummaryCard,
  useFinanceBack,
  useFinanceScrollMemory,
} from './shared'

// Ein Händler (v1.27) — ein angelegter (`finance_merchants`-ID) oder ein bloß
// benannter (`name:…`); die Adresse sagt welcher, siehe src/lib/finance/routes.js.
//
// Zusammenfassung, Entwicklung, wofür (Unterkategorien), welche Buchungen. Jede
// Zahl kommt aus `merchantDetail`.
export default function MerchantDetail() {
  const { merchantKey: segment } = useParams()
  const merchantKey = decodeMerchantKey(segment)
  const { categories, loading } = useFinance()
  const { scopeFor, trendRange, setTrendRange } = useFinanceView()
  const navigate = useNavigate()
  const back = useFinanceBack(FINANCE_ROUTES.merchants)
  const accountLabel = useFinanceAccountLabel()
  const [sheet, setSheet] = useState(null)
  const [openTransactionId, setOpenTransactionId] = useState(null)
  useFinanceScrollMemory()

  const scope = useMemo(() => scopeFor(), [scopeFor])
  const detail = useMemo(
    () => merchantDetail({ scope, categories, merchantKey, trendRange }),
    [scope, categories, merchantKey, trendRange]
  )

  const openEntry = openTransactionId
    ? scope.allEntries.find((e) => e.id === openTransactionId) ?? null
    : null

  if (!detail.found) {
    return (
      <div className="min-h-screen pb-28">
        <FinanceDetailHeader title="Händler" onBack={back} />
        {loading ? (
          <FinanceDetailLoading />
        ) : (
          <p className="mt-20 px-5 text-center text-body text-text-secondary">
            Händler nicht gefunden.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-28">
      <FinanceDetailHeader
        title={detail.name}
        onBack={back}
        leading={<MerchantAvatar merchant={detail.merchant} name={detail.name} size="sm" />}
      />
      <div className="px-5">
        <FinanceScopeBar
          className="mt-1"
          periodLabel={scope.periodLabel}
          accountLabel={accountLabel}
          onPeriod={() => setSheet('period')}
          onAccount={() => setSheet('account')}
        />
        <MerchantDetailView
          detail={detail}
          comparisonLabel={scope.comparisonLabel}
          currencies={scope.currencies}
          trendRange={trendRange}
          onTrendRange={setTrendRange}
          onPickAccount={() => setSheet('account')}
          onOpenCategory={(id) => navigate(categoryRoute(id))}
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
export function MerchantDetailView({
  detail,
  comparisonLabel,
  currencies = [],
  trendRange,
  onTrendRange,
  onPickAccount = null,
  onOpenCategory = null,
  onOpenTransaction = null,
}) {
  const { currency } = detail
  return (
    <>
      {detail.monetary ? (
        <FinanceSummaryCard
          amount={detail.amount}
          currency={currency}
          caption={plural(detail.count, 'Buchung', 'Buchungen')}
          change={detail.change}
          comparisonLabel={comparisonLabel}
        />
      ) : (
        <FinanceMixedNotice currencies={currencies} onPickAccount={onPickAccount} />
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

      {(detail.categories.length > 0 || detail.unassigned.count > 0) && detail.monetary && (
        <FinanceSection title="Kategorien">
          {detail.categories.length > 0 && (
            <FinanceListCard>
              {detail.categories.map((row, index) => (
                <FinanceCategoryRow
                  key={row.category?.id ?? index}
                  row={row}
                  currency={currency}
                  bordered={index > 0}
                  iconSlug={row.parent?.slug ?? null}
                  onOpen={onOpenCategory && row.category?.id ? () => onOpenCategory(row.category.id) : null}
                />
              ))}
            </FinanceListCard>
          )}
          {/* „Nicht zugeordnet" ist auch hier keine Kategorie, sondern ein
              Hinweis darunter. */}
          {detail.unassigned.count > 0 && (
            <p className="mt-2 px-1 text-caption text-text-secondary">
              {plural(detail.unassigned.count, 'Buchung ist', 'Buchungen sind')} noch keiner
              Kategorie zugeordnet ({formatAmountMinor(detail.unassigned.amount, currency)}).
            </p>
          )}
        </FinanceSection>
      )}

      <FinanceSection title="Buchungen">
        {detail.bookings.length === 0 ? (
          <FinanceHint>In diesem Zeitraum gibt es bei diesem Händler keine Buchung.</FinanceHint>
        ) : (
          <FinanceListCard>
            {detail.bookings.map((entry, index) => (
              <FinanceTransactionRow
                key={entry.id}
                entry={entry}
                bordered={index > 0}
                detail={entry.category?.label ?? null}
                onOpen={onOpenTransaction ? () => onOpenTransaction(entry.id) : null}
              />
            ))}
          </FinanceListCard>
        )}
      </FinanceSection>
    </>
  )
}
