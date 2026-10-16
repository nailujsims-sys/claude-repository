import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FinanceCategoryRow,
  FinanceHint,
  FinanceListCard,
  FinanceSection,
} from '../../components/FinanceRows'
import {
  FinanceMixedNotice,
  FinanceScopeBar,
  FinanceScopeSheets,
  useFinanceAccountLabel,
} from '../../components/FinanceScope'
import { useFinance } from '../../context/FinanceContext'
import { useFinanceView } from '../../context/FinanceViewContext'
import { categoryOverview } from '../../lib/finance/analytics'
import { FINANCE_ROUTES, categoryRoute } from '../../lib/finance/routes'
import { formatAmountMinor, plural } from '../../lib/finance/importFlow'
import {
  FinanceDetailHeader,
  FinanceDetailLoading,
  FinanceLinkRow,
  useFinanceBack,
  useFinanceScrollMemory,
} from './shared'

// „Kategorien" — alle Oberkategorien des gewählten Ausschnitts (v1.27).
//
// Keine neue Kachelwand: oben dieselbe Filterzeile wie auf der Übersicht,
// darunter dieselben Kategoriezeilen, nur alle statt fünf. Die Zahlen kommen
// aus `categoryOverview`, das seinerseits `categoryBreakdown` ist — eine Zeile
// hier IST die Zeile der Übersicht.
//
// „NICHT ZUGEORDNET" STEHT GETRENNT AM ENDE, nicht in der Liste. Es ist kein
// Ausgabenbereich, sondern offene Arbeit; eine Zeile mit Icon und Balken
// zwischen „Wohnen" und „Freizeit" würde genau das behaupten. Ein Tipp darauf
// zeigt die betroffenen Buchungen — als Zustand, nicht als Kategorie.
export default function CategoryOverview() {
  const { categories, loading } = useFinance()
  const { scopeFor } = useFinanceView()
  const navigate = useNavigate()
  const back = useFinanceBack(FINANCE_ROUTES.overview)
  const accountLabel = useFinanceAccountLabel()
  const [sheet, setSheet] = useState(null)
  useFinanceScrollMemory()

  const scope = useMemo(() => scopeFor(), [scopeFor])
  const overview = useMemo(
    () => (scope.mixedCurrency ? null : categoryOverview({ entries: scope.inRange, categories })),
    [scope, categories]
  )

  return (
    <div className="min-h-screen pb-28">
      <FinanceDetailHeader title="Kategorien" onBack={back} />
      <div className="px-5">
        <FinanceScopeBar
          className="mt-1"
          periodLabel={scope.periodLabel}
          accountLabel={accountLabel}
          onPeriod={() => setSheet('period')}
          onAccount={() => setSheet('account')}
        />
        {loading ? (
          <FinanceDetailLoading />
        ) : scope.mixedCurrency ? (
          <FinanceMixedNotice currencies={scope.currencies} onPickAccount={() => setSheet('account')} />
        ) : (
          <CategoryOverviewView
            overview={overview}
            currency={scope.currency}
            onOpenCategory={(id) => navigate(categoryRoute(id))}
            onOpenUnassigned={() => navigate(FINANCE_ROUTES.unassigned)}
          />
        )}
      </div>
      <FinanceScopeSheets sheet={sheet} onClose={() => setSheet(null)} />
    </div>
  )
}

// Rein darstellend und ohne Router — tools/financeDrilldownLayout.mjs rendert
// genau diesen Block in einem echten Browser.
export function CategoryOverviewView({ overview, currency, onOpenCategory = null, onOpenUnassigned = null }) {
  const { rows, unassigned } = overview
  return (
    <>
      <FinanceSection title="Alle Kategorien" className="mt-5">
        {rows.length === 0 ? (
          <FinanceHint>Es sind noch keine Kategorien angelegt.</FinanceHint>
        ) : (
          <FinanceListCard>
            {rows.map((row, index) => (
              <FinanceCategoryRow
                key={row.category?.id ?? index}
                row={row}
                currency={currency}
                bordered={index > 0}
                onOpen={onOpenCategory && row.category?.id ? () => onOpenCategory(row.category.id) : null}
              />
            ))}
          </FinanceListCard>
        )}
      </FinanceSection>

      {unassigned.count > 0 && (
        <FinanceLinkRow label="Nicht zugeordnet" onClick={onOpenUnassigned} className="mt-3">
          <span className="shrink-0 tabular-nums text-caption text-text-secondary">
            {plural(unassigned.count, 'Buchung', 'Buchungen')} ·{' '}
            {formatAmountMinor(unassigned.amount, currency)}
          </span>
        </FinanceLinkRow>
      )}
    </>
  )
}
