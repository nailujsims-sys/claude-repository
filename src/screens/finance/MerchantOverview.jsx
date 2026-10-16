import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FinanceHint,
  FinanceListCard,
  FinanceMerchantRow,
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
import { merchantOverview } from '../../lib/finance/analytics'
import { FINANCE_ROUTES, merchantRoute } from '../../lib/finance/routes'
import {
  FinanceDetailHeader,
  FinanceDetailLoading,
  useFinanceBack,
  useFinanceScrollMemory,
} from './shared'

// „Händler" — alle Händler mit Ausgaben im gewählten Ausschnitt (v1.27).
//
// Dieselbe Liste wie „Top-Händler" auf der Übersicht, ohne die Grenze bei fünf
// (`merchantOverview` ist `topMerchants` ohne `limit`). Nur wer im Ausschnitt
// tatsächlich etwas gekostet hat, steht hier — ein Händler ohne Buchung in
// diesem Monat ist kein Händler dieses Monats.
export default function MerchantOverview() {
  const { categories, loading } = useFinance()
  const { scopeFor } = useFinanceView()
  const navigate = useNavigate()
  const back = useFinanceBack(FINANCE_ROUTES.overview)
  const accountLabel = useFinanceAccountLabel()
  const [sheet, setSheet] = useState(null)
  useFinanceScrollMemory()

  const scope = useMemo(() => scopeFor(), [scopeFor])
  const overview = useMemo(() => merchantOverview({ scope, categories }), [scope, categories])

  return (
    <div className="min-h-screen pb-28">
      <FinanceDetailHeader title="Händler" onBack={back} />
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
          <MerchantOverviewView
            merchants={overview.merchants}
            currency={scope.currency}
            onOpenMerchant={(key) => navigate(merchantRoute(key))}
          />
        )}
      </div>
      <FinanceScopeSheets sheet={sheet} onClose={() => setSheet(null)} />
    </div>
  )
}

/** Rein darstellend und ohne Router — für den Layout-Test exportiert. */
export function MerchantOverviewView({ merchants, currency, onOpenMerchant = null }) {
  return (
    <FinanceSection title="Alle Händler" className="mt-5">
      {merchants.length === 0 ? (
        <FinanceHint>In diesem Zeitraum ist noch keine Ausgabe einem Händler zugeordnet.</FinanceHint>
      ) : (
        <FinanceListCard>
          {merchants.map((merchant, index) => (
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
  )
}
