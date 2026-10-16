import { useMemo, useState } from 'react'
import FinanceTransactionSheet from '../../components/FinanceTransactionSheet'
import {
  FinanceHint,
  FinanceListCard,
  FinanceSection,
  FinanceTransactionRow,
} from '../../components/FinanceRows'
import {
  FinanceScopeBar,
  FinanceScopeSheets,
  useFinanceAccountLabel,
} from '../../components/FinanceScope'
import { useFinance } from '../../context/FinanceContext'
import { useFinanceView } from '../../context/FinanceViewContext'
import { useUI } from '../../context/UIContext'
import { unassignedDetail } from '../../lib/finance/analytics'
import { needsDecision } from '../../lib/finance/classificationQueue'
import { FINANCE_ROUTES } from '../../lib/finance/routes'
import { formatAmountMinor, plural } from '../../lib/finance/importFlow'
import {
  FinanceDetailHeader,
  FinanceDetailLoading,
  FinanceLinkRow,
  useFinanceBack,
  useFinanceScrollMemory,
} from './shared'

// „Nicht zugeordnet" — ein Zustand, keine Kategorie (v1.27).
//
// WAS HIER BEWUSST FEHLT: Entwicklung, Top-Händler, Anteil, Vergleich. Das
// wären Aussagen über einen Ausgabenbereich, und „noch nicht einsortiert" ist
// keiner. Was bleibt, ist die ehrliche Antwort auf „welche Buchungen sind das?"
// — und, wenn welche davon auf eine Entscheidung warten, der Weg dorthin.
//
// WARUM NICHT EINFACH DIE REVIEW-INBOX: die Inbox ist zeitraum- und
// kontounabhängig (v1.26.2) und enthält auch Buchungen MIT Kategorie, deren
// Händler offen ist. „Nicht zugeordnet" auf dieser Seite meint den gewählten
// Ausschnitt. Beides gleichzusetzen wäre falsch; also zeigt diese Seite ihre
// Buchungen und bietet die Inbox zusätzlich an, wenn darin etwas offen ist.
export default function UnassignedDetail() {
  const { loading } = useFinance()
  const { openFinanceClassify } = useUI()
  const { scopeFor } = useFinanceView()
  const back = useFinanceBack(FINANCE_ROUTES.categories)
  const accountLabel = useFinanceAccountLabel()
  const [sheet, setSheet] = useState(null)
  const [openTransactionId, setOpenTransactionId] = useState(null)
  useFinanceScrollMemory()

  const scope = useMemo(() => scopeFor(), [scopeFor])
  const detail = useMemo(() => unassignedDetail({ scope }), [scope])
  const openReview = useMemo(() => scope.allEntries.filter(needsDecision).length, [scope])

  const openEntry = openTransactionId
    ? scope.allEntries.find((e) => e.id === openTransactionId) ?? null
    : null

  return (
    <div className="min-h-screen pb-28">
      <FinanceDetailHeader title="Nicht zugeordnet" onBack={back} />
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
        ) : (
          <>
            <p className="mt-3 px-1 text-caption text-text-secondary">
              {plural(detail.count, 'Buchung', 'Buchungen')}
              {detail.monetary ? ` · ${formatAmountMinor(detail.amount, detail.currency)}` : ''} —
              sie zählen in den Gesamtausgaben, aber in keiner Kategorie.
            </p>
            {openReview > 0 && (
              <FinanceLinkRow
                label={plural(openReview, 'Buchung prüfen', 'Buchungen prüfen')}
                onClick={openFinanceClassify}
              />
            )}
            <FinanceSection title="Buchungen">
              {detail.bookings.length === 0 ? (
                <FinanceHint>In diesem Zeitraum ist jede Ausgabe einer Kategorie zugeordnet.</FinanceHint>
              ) : (
                <FinanceListCard>
                  {detail.bookings.map((entry, index) => (
                    <FinanceTransactionRow
                      key={entry.id}
                      entry={entry}
                      bordered={index > 0}
                      onOpen={() => setOpenTransactionId(entry.id)}
                    />
                  ))}
                </FinanceListCard>
              )}
            </FinanceSection>
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
