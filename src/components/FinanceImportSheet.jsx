import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, Upload } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { SkeletonLine } from './Skeleton'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import {
  buildPayload,
  buildPlan,
  confirmSentence,
  describeApplyResult,
  describeParseFailure,
  failureLog,
  previewRows,
  summarizePlan,
  summaryLines,
  readStatementFile,
  supersessionSentence,
} from '../lib/finance/importFlow'

const DEFAULT_ACCOUNT_NAME = 'DKB Girokonto'

// The whole import, in one sheet.
//
// Six states and one path through them: pick a file, read it, name the account
// the first time, look at what arrived, save it, done. Every step is one screen
// of the same sheet rather than a stack of dialogs, because the flow is one
// decision — "is this the right statement, and do I want it" — and interrupting
// it twice would not make that decision better.
//
// NOTHING HERE DECIDES ANYTHING. The refusal is the parser's, the matching is
// reconcileImport's, the writing is the database's. This component calls them in
// order and renders the words src/lib/finance/importFlow.js hands it.
export default function FinanceImportSheet() {
  const { financeImport, closeFinanceImport } = useUI()
  const open = Boolean(financeImport)
  return open ? <Sheet onClose={closeFinanceImport} /> : null
}

function Sheet({ onClose }) {
  const {
    account, transactions, observations, overrideTransactionIds,
    createAccount, findImport, openImport, applyPlan, reload,
  } = useFinance()
  const fileRef = useRef(null)

  // 'pick' | 'reading' | 'already' | 'account' | 'preview' | 'applying' | 'done' | 'error'
  const [step, setStep] = useState('pick')
  const [accountName, setAccountName] = useState(DEFAULT_ACCOUNT_NAME)
  const [statement, setStatement] = useState(null) // { hash, result, fileName }
  const [plan, setPlan] = useState(null)
  const [totals, setTotals] = useState(null)
  const [rows, setRows] = useState([])
  const [failure, setFailure] = useState(null)
  const [outcome, setOutcome] = useState(null)
  // The account the plan was reconciled against. Held rather than read from the
  // context at submit time: on the first import it is created mid-flow, and the
  // booking that gets written must belong to the account the preview was
  // computed for — not to whatever the provider happens to hold a render later.
  const [targetAccountId, setTargetAccountId] = useState(null)

  const reset = useCallback(() => {
    setStep('pick')
    setStatement(null)
    setPlan(null)
    setTotals(null)
    setRows([])
    setFailure(null)
    setOutcome(null)
    setTargetAccountId(null)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  // Reconcile and describe. Split out because it runs at two moments: right
  // after reading the file when an account already exists, and after the
  // account has just been created.
  const prepare = useCallback(
    (parsed, accountId) => {
      const existing = transactions.filter((t) => t.account_id === accountId)
      const nextPlan = buildPlan({ parsed, existing, observations, overrideTransactionIds, accountId })
      setTargetAccountId(accountId)
      setPlan(nextPlan)
      const nextTotals = summarizePlan(nextPlan)
      setTotals(nextTotals)
      setRows(previewRows(parsed.transactions, nextPlan))
      setStep('preview')
    },
    [transactions, observations, overrideTransactionIds]
  )

  const onFile = useCallback(
    async (file) => {
      if (!file) return
      // Cleared straight away: without it, picking the same file again after a
      // refusal would not fire `change` at all and the button would look dead.
      if (fileRef.current) fileRef.current.value = ''
      setStep('reading')
      try {
        const { hash, result } = await readStatementFile(file)
        if (!result.ok) {
          setFailure(describeParseFailure(result))
          setStep('error')
          return
        }
        setStatement({ hash, result, fileName: file.name ?? null })

        // The same file, already applied. Said plainly instead of walked through
        // a preview of nothing — and the screen behind is resynced first,
        // because the most likely way to get here is an apply that committed on
        // the server while the answer never reached this device.
        const known = await findImport(hash)
        if (known?.status === 'imported') {
          await reload()
          setStep('already')
          return
        }

        if (account) prepare(result, account.id)
        else setStep('account')
      } catch (err) {
        // The code, never the object: see failureLog. Whatever went wrong while
        // reading, the user sees the same honest sentence — this file was not
        // imported — and the console gets no page of the statement.
        console.error(failureLog('lesen', err))
        setFailure(describeParseFailure({ errors: [{ code: 'read_failed', message: String(err?.message ?? err) }] }))
        setStep('error')
      }
    },
    [account, prepare, findImport, reload]
  )

  const onCreateAccount = useCallback(async () => {
    const name = accountName.trim() || DEFAULT_ACCOUNT_NAME
    setStep('reading')
    try {
      const row = await createAccount({ name, provider: 'DKB', currency: 'EUR' })
      prepare(statement.result, row.id)
    } catch (err) {
      console.error(failureLog('konto', err))
      setFailure({ headline: 'Das Konto konnte nicht angelegt werden.', details: [] })
      setStep('error')
    }
  }, [accountName, createAccount, prepare, statement])

  const onApply = useCallback(async () => {
    if (step === 'applying') return
    setStep('applying')
    try {
      const { row, reused } = await openImport({
        accountId: targetAccountId,
        sourceHash: statement.hash,
        sourceName: statement.fileName,
        periodStart: statement.result.header.period_start,
        periodEnd: statement.result.header.period_end,
      })
      const payload = buildPayload({
        importId: row.id,
        accountId: targetAccountId,
        parsed: statement.result,
        plan,
      })
      const result = await applyPlan(payload)
      setOutcome({ ...describeApplyResult(result, totals), reused })
      setStep('done')
    } catch (err) {
      // The most sensitive of the three: a constraint violation from the apply
      // function answers with the row that broke it.
      console.error(failureLog('import', err))
      setFailure({
        headline:
          'Der Import konnte nicht gespeichert werden. Es wurde nichts übernommen — du kannst es erneut versuchen.',
        details: [],
      })
      setStep('error')
    }
  }, [step, targetAccountId, openImport, statement, plan, totals, applyPlan])

  // No toast on the way out: the sheet has just said "Import abgeschlossen" in
  // full, and the screen behind it now shows the new count. A third
  // confirmation of the same fact is noise, not feedback.

  return (
    <BottomSheet open onClose={onClose} full title="Umsätze importieren">
      {/* No scroll container of its own: BottomSheet's body already is one,
          and a second one nested inside it swallows the momentum of a flick and
          keeps the last row under the fold on a phone. */}
      <div className="px-5 py-5 pb-10">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          // The button above is the control a person sees and reaches; this
          // element only carries the native picker. Left in the tab order it
          // would be an invisible stop inside the sheet's focus trap.
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => onFile(e.target.files?.[0])}
        />

        {step === 'pick' && <PickStep onPick={() => fileRef.current?.click()} />}
        {step === 'reading' && <ReadingStep />}
        {step === 'already' && <AlreadyStep onRetry={reset} onClose={onClose} />}
        {step === 'account' && (
          <AccountStep value={accountName} onChange={setAccountName} onSubmit={onCreateAccount} />
        )}
        {(step === 'preview' || step === 'applying') && (
          <PreviewStep
            totals={totals}
            rows={rows}
            statement={statement}
            busy={step === 'applying'}
            onApply={onApply}
          />
        )}
        {step === 'done' && <DoneStep outcome={outcome} onFinish={onClose} />}
        {step === 'error' && <ErrorStep failure={failure} onRetry={reset} />}
      </div>
    </BottomSheet>
  )
}

// ── Steps ────────────────────────────────────────────────────────────────────

function PickStep({ onPick }) {
  return (
    <div className="pt-2">
      <p className="text-body text-text-secondary">
        Lade den Umsatzexport als PDF aus dem DKB-Banking herunter und wähle ihn hier aus.
      </p>

      <button
        onClick={onPick}
        className="press-tint mt-5 flex w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        <Upload size={18} /> PDF auswählen
      </button>

      {/* The one sentence that matters for trust, in the quietest text the app
          has — a promise, not a warning. */}
      <p className="mt-4 text-caption text-text-muted">
        Die Datei wird nur auf diesem Gerät gelesen. Gespeichert werden ausschließlich die
        erkannten Umsätze, nie das PDF selbst.
      </p>
    </div>
  )
}

function ReadingStep() {
  return (
    <div className="pt-2" aria-live="polite">
      <p className="text-body text-text-secondary">Auszug wird gelesen und geprüft …</p>
      <div className="mt-5 space-y-3">
        <SkeletonLine className="h-4 w-2/3" />
        <SkeletonLine className="h-4 w-1/2" />
        <SkeletonLine className="h-4 w-3/4" />
      </div>
    </div>
  )
}

// Not an error: the file is fine and the bookings are already where they
// belong. The database would say so too — the apply function replays instead of
// writing — but making the user sit through an empty preview to find that out
// would be the app hiding what it already knows.
function AlreadyStep({ onRetry, onClose }) {
  return (
    <div className="pt-2">
      <p className="text-body text-text-primary">Dieser DKB-Export wurde bereits importiert.</p>
      <p className="mt-2 text-ui text-text-secondary">
        Es wurde nichts doppelt gespeichert.
      </p>
      <button
        onClick={onClose}
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        Fertig
      </button>
      <button
        onClick={onRetry}
        className="press-tint mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary"
      >
        <FileText size={18} /> Andere Datei wählen
      </button>
    </div>
  )
}

function AccountStep({ value, onChange, onSubmit }) {
  return (
    <div className="pt-2">
      <p className="text-body text-text-secondary">
        Für den ersten Import braucht es ein Konto, dem die Umsätze gehören.
      </p>

      <label className="mt-5 block">
        <span className="mb-2 block text-label font-medium text-text-secondary">Name</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
      </label>

      <p className="mt-2 text-caption text-text-muted">Währung: Euro</p>

      <button
        onClick={onSubmit}
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        Konto anlegen und fortfahren
      </button>
    </div>
  )
}

// Exported so a real browser can measure it. The preview is the one screen of
// this flow that has to survive hostile content — a description longer than the
// phone, an amount with thousands separators, five hundred bookings at once —
// and none of that can be checked in a DOM without layout. See
// tools/financeImportLayout.mjs.
export function PreviewStep({ totals, rows, statement, busy, onApply }) {
  const replaced = supersessionSentence(totals)
  const warnings = statement?.result?.warnings?.filter((w) => w.in_transaction) ?? []

  return (
    <div>
      <section className="rounded-card border border-subtle bg-bg-card px-4 py-4">
        <p className="text-section font-semibold text-text-primary">
          {totals.erkannt === 1 ? '1 Umsatz erkannt' : `${totals.erkannt} Umsätze erkannt`}
        </p>
        <ul className="mt-2 space-y-1">
          {summaryLines(totals).map((line) => (
            <li key={line} className="text-ui text-text-secondary">
              {line}
            </li>
          ))}
        </ul>
        {replaced && <p className="mt-3 text-ui text-text-secondary">{replaced}</p>}
      </section>

      <Details
        label="Technische Details"
        counts={totals}
        period={statement?.result?.header}
        warnings={warnings}
      />

      <p className="px-1 pb-2 pt-5 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        Umsätze
      </p>
      <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
        {rows.map((row, i) => (
          <PreviewRow key={row.index} row={row} showBorder={i < rows.length - 1} />
        ))}
      </div>

      <p className="mt-6 text-ui text-text-secondary">{confirmSentence(totals)}</p>
      <button
        onClick={onApply}
        disabled={busy}
        aria-busy={busy}
        className="press-tint mt-2 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Wird importiert …' : 'Umsätze importieren'}
      </button>
    </div>
  )
}

// A booking as a list row: what it was, when, how much, and what will happen to
// it. The status is text, not a colour field — the brief allows one accent, and
// a list of twenty-seven bookings is not where it belongs.
function PreviewRow({ row, showBorder }) {
  const tone =
    row.tone === 'accent'
      ? 'text-accent'
      : row.tone === 'attention'
        ? 'text-text-primary'
        : 'text-text-muted'
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${showBorder ? 'border-b border-subtle' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium text-text-primary">{row.title}</p>
        <p className="mt-0.5 text-caption text-text-muted">
          {row.date} · <span className={tone}>{row.status}</span>
        </p>
      </div>
      <p className="shrink-0 text-ui font-semibold tabular-nums text-text-primary">{row.amount}</p>
    </div>
  )
}

function DoneStep({ outcome, onFinish }) {
  return (
    <div className="pt-2">
      <p className="text-section font-semibold text-text-primary">Import abgeschlossen</p>

      {outcome.replayed && (
        <p className="mt-2 text-ui text-text-secondary">
          Dieser Auszug war bereits importiert — es wurde nichts doppelt gespeichert.
        </p>
      )}

      <ul className="mt-3 space-y-1">
        {outcome.lines.map((line) => (
          <li key={line} className="text-ui text-text-secondary">
            {line}
          </li>
        ))}
      </ul>

      {/* The review CTA deliberately leads nowhere yet: there is no screen to
          resolve a review item on, and a button into a half-built view is worse
          than a sentence. The item itself is safe in the database. */}
      {outcome.reviewSentence && (
        <p className="mt-4 rounded-card border border-subtle bg-bg-card px-4 py-3 text-ui text-text-secondary">
          {outcome.reviewSentence}
        </p>
      )}

      <button
        onClick={onFinish}
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        Fertig
      </button>
    </div>
  )
}

function ErrorStep({ failure, onRetry }) {
  const [openDetails, setOpenDetails] = useState(false)
  return (
    <div className="pt-2">
      <p className="text-body text-text-primary" role="alert">
        {failure.headline}
      </p>

      {failure.details.length > 0 && (
        <>
          <button
            onClick={() => setOpenDetails((v) => !v)}
            aria-expanded={openDetails}
            // py-3/-my-2 rather than py-1: measured in a real browser at 390 px the
            // strip was 29 px tall, well under what a thumb reliably hits. The
            // padding grows the target, the negative margin gives the four pixels
            // of visual spacing back, so nothing moves.
            className="press-tint -my-2 mt-4 flex items-center gap-1.5 rounded-btn py-3 text-ui text-text-secondary"
          >
            Details
            <ChevronDown
              size={16}
              className={`transition-transform motion-reduce:transition-none ${openDetails ? 'rotate-180' : ''}`}
            />
          </button>
          {openDetails && (
            <ul className="mt-2 space-y-2 rounded-card border border-subtle bg-bg-card px-4 py-3">
              {failure.details.map((detail, i) => (
                <li key={`${detail.code}-${i}`} className="text-caption text-text-secondary">
                  <span className="text-text-muted">{detail.code}</span> — {detail.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button
        onClick={onRetry}
        className="press-tint mt-6 flex w-full items-center justify-center gap-2 rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary"
      >
        <FileText size={18} /> Andere Datei wählen
      </button>
    </div>
  )
}

// The technical half of the preview: the vocabulary of the matcher, the period
// the file declares, and any position the PDF did not encode. Closed by default
// — a person importing a statement does not need the word "supersedes", but the
// person debugging one does.
function Details({ label, counts, period, warnings }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="press-tint -my-2 flex items-center gap-1.5 rounded-btn py-3 text-ui text-text-secondary"
      >
        {label}
        <ChevronDown
          size={16}
          className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-2 rounded-card border border-subtle bg-bg-card px-4 py-3">
          {period?.period_start && (
            <p className="text-caption text-text-secondary">
              Zeitraum laut Auszug: {period.period_start} bis {period.period_end}
            </p>
          )}
          <p className="mt-1 text-caption text-text-secondary">
            neu {counts.neu} · ersetzt {counts.ersetzt} · doppelt {counts.vorhanden} · ergänzt{' '}
            {counts.aktualisiert} · offen {counts.pruefen}
          </p>
          {counts.retouren > 0 && (
            <p className="mt-1 text-caption text-text-secondary">
              {counts.retouren} möglicher Retouren-Bezug erkannt
            </p>
          )}
          {warnings.length > 0 && (
            <p className="mt-1 text-caption text-text-muted">
              {warnings.length} Zeichen konnten nicht eindeutig gelesen werden und stehen als „�" im
              Text.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
