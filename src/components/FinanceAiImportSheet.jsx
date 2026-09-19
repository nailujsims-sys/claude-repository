import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Check, ChevronDown, ChevronRight, Copy, Sparkles } from 'lucide-react'
import BottomSheet from './BottomSheet'
import Toggle from './Toggle'
import FinanceAccountPicker from './FinanceAccountPicker'
import FinanceLearningScopeSheet from './FinanceLearningScopeSheet'
import FinanceMemoriesSheet from './FinanceMemoriesSheet'
import { CategoryChipSelect, ChipSelect } from './FinanceManualSheet'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { useToast } from '../context/ToastContext'
import { TRANSACTION_TYPES, transactionTypeLabel } from '../config/finance'
import { nextAccountId } from '../lib/finance/accounts'
import { failureLog } from '../lib/finance/importFlow'
import { sourceHash } from '../lib/finance/dkb/sourceHash'
import { buildAIContextPrompt } from '../lib/finance/ai/prompt'
import { parseAIImport, validateAIImport } from '../lib/finance/ai/parse'
import {
  applyRowEdit,
  buildAIApplyPayload,
  buildAIImportPlan,
  summarizeAIPlan,
} from '../lib/finance/ai/plan'
import {
  aiConfirmSentence,
  aiPreviewRow,
  aiSummaryLines,
  describeAIApplyResult,
} from '../lib/finance/ai/messages'
import {
  activeMemoryCount,
  learningModeLabel,
  rowHasLearnableCorrection,
} from '../lib/finance/ai/memories'

// Der KI-Import, in einem Sheet.
//
// Der ganze Weg besteht aus zwei Dingen, die der Nutzer tut: einmal kopieren,
// einmal einfügen. Dazwischen passiert alles in ChatGPT, und danach passiert
// alles hier. Genau so ist das Sheet gebaut — oben, was man mitnimmt, unten,
// was man zurückbringt, und erst danach der Preview.
//
// DIE APP SCHREIBT DEN PROMPT, NICHT DER NUTZER. „KI-Kontext kopieren" legt
// einen vollständigen Auftrag in die Zwischenablage: die Kategorien dieses
// Kontos, die bekannten Händler, die persönlichen Regeln, die Dienstleister und
// das verbindliche Antwortformat. Wer das selbst zusammenstellen müsste, würde
// es beim dritten Mal abkürzen — und die Qualität des Imports hinge daran.
//
// KEINE TECHNISCHE SPRACHE. Auf diesem Bildschirm steht kein „JSON", kein
// „Schema" und kein „Parser". Es gibt einen Kontext, den man kopiert, eine
// Antwort, die man einfügt, und Umsätze, die man prüft.
//
// ENTSCHIEDEN WIRD HIER NICHTS: parseAIImport liest, validateAIImport prüft,
// buildAIImportPlan gleicht kontobezogen ab, die Datenbank schreibt. Diese
// Komponente ruft sie der Reihe nach auf und rendert, was sie zurückbekommt.
export default function FinanceAiImportSheet() {
  const { financeAiImport, closeFinanceAiImport } = useUI()
  return financeAiImport ? <Sheet onClose={closeFinanceAiImport} /> : null
}

function Sheet({ onClose }) {
  const {
    // `activeAccounts`: ein Import landet nie auf einem archivierten Konto
    // (§10). Was dort schon liegt, bleibt unangetastet und lesbar.
    activeAccounts, transactions, observations, categories, merchants, patterns, categoryRules,
    aiMemories, createAccount, openImport, applyAiImport,
  } = useFinance()
  const { showToast } = useToast()

  // 'setup' | 'preview' | 'applying' | 'done'
  const [step, setStep] = useState('setup')
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? null)
  const [pasted, setPasted] = useState('')
  const [problems, setProblems] = useState([])
  const [rows, setRows] = useState([])
  const [outcome, setOutcome] = useState(null)

  // §4: fällt das gewählte Konto weg (archiviert oder gelöscht), rückt das
  // erste aktive nach — aber NUR im Setup-Schritt. Mitten in einem Preview das
  // Zielkonto zu wechseln hieße, einen fertig geprüften Import stillschweigend
  // woandershin zu buchen; dort bleibt die Wahl stehen, bis der Nutzer
  // zurückgeht.
  useEffect(() => {
    if (step !== 'setup') return
    if (accountId === null) {
      if (activeAccounts.length === 1) setAccountId(activeAccounts[0].id)
      return
    }
    if (!activeAccounts.some((a) => a.id === accountId)) {
      setAccountId(nextAccountId(activeAccounts, null))
    }
  }, [activeAccounts, accountId, step])

  const account = activeAccounts.find((a) => a.id === accountId) ?? null
  const summary = useMemo(() => summarizeAIPlan(rows), [rows])

  const onCopyContext = useCallback(async () => {
    const prompt = buildAIContextPrompt({
      categories,
      merchants,
      patterns,
      categoryRules,
      transactions: transactions.filter((t) => t.account_id === accountId),
      // Das Gedächtnis von v1.24. Es steht hier und nirgends sonst: ChatGPT
      // behält zwischen zwei Unterhaltungen nichts, also wird alles, was der
      // Nutzer sich gemerkt hat, bei jedem Kopieren neu mitgeteilt.
      memories: aiMemories,
      accountName: account?.name ?? null,
      currency: account?.currency ?? 'EUR',
    })
    const copied = await copyText(prompt)
    showToast(copied ? 'Kontext kopiert ✓' : 'Kopieren hat nicht geklappt')
  }, [categories, merchants, patterns, categoryRules, transactions, aiMemories, accountId, account,
      showToast])

  const onCheck = useCallback(() => {
    setProblems([])
    const parsed = parseAIImport(pasted)
    if (!parsed.ok) {
      setProblems(parsed.errors.map((e) => e.message))
      return
    }
    const checked = validateAIImport(parsed.payload, { categories })
    if (!checked.ok) {
      // Höchstens fünf, damit aus einer Fehlermeldung keine Wand wird — die
      // Anzahl steht darunter, wenn es mehr sind.
      const messages = checked.errors.slice(0, 5).map((e) => e.message)
      if (checked.errors.length > messages.length) {
        messages.push(`… und ${checked.errors.length - messages.length} weitere.`)
      }
      setProblems(messages)
      return
    }
    const plan = buildAIImportPlan({
      entries: checked.entries,
      existing: transactions,
      observations,
      accountId,
    })
    setRows(plan.rows)
    setStep('preview')
  }, [pasted, categories, transactions, observations, accountId])

  const onApply = useCallback(async () => {
    if (step === 'applying') return
    setStep('applying')
    try {
      // Die Identität dieses Blocks — auf diesem Konto. Derselbe Text in ein
      // anderes Konto ist ein anderer Import, weil dieselbe Buchung auf zwei
      // Konten zwei Buchungen sind.
      const hash = await hashOfBlock(accountId, pasted)
      const { row } = await openImport({
        accountId,
        sourceHash: hash,
        sourceName: 'KI-Import',
        sourceType: 'ai',
      })
      const payload = buildAIApplyPayload({ importId: row.id, accountId, rows })
      const result = await applyAiImport(payload)
      setOutcome(describeAIApplyResult(result, summary))
      setStep('done')
    } catch (err) {
      console.error(failureLog('ki-import', err))
      setProblems([
        'Die Umsätze konnten nicht gespeichert werden. Es wurde nichts übernommen — du kannst es erneut versuchen.',
      ])
      setStep('preview')
    }
  }, [step, accountId, pasted, rows, summary, openImport, applyAiImport])

  const onEditRow = useCallback((index, patch) => {
    setRows((current) =>
      current.map((row) => (row.index === index ? applyRowEdit(row, patch) : row))
    )
  }, [])

  return (
    <BottomSheet open onClose={onClose} full title="KI-Import">
      <div className="px-5 py-5 pb-10">
        {step === 'setup' && (
          <SetupStep
            accounts={activeAccounts}
            accountId={accountId}
            onAccount={setAccountId}
            onCreateAccount={createAccount}
            onCopy={onCopyContext}
            pasted={pasted}
            onPaste={setPasted}
            onCheck={onCheck}
            problems={problems}
            memoryCount={activeMemoryCount(aiMemories)}
          />
        )}

        {(step === 'preview' || step === 'applying') && (
          <PreviewStep
            rows={rows}
            summary={summary}
            categories={categories}
            merchants={merchants}
            busy={step === 'applying'}
            problems={problems}
            onEditRow={onEditRow}
            onApply={onApply}
            onBack={() => {
              setProblems([])
              setStep('setup')
            }}
          />
        )}

        {step === 'done' && <DoneStep outcome={outcome} onFinish={onClose} />}
      </div>
    </BottomSheet>
  )
}

// ── Schritte ────────────────────────────────────────────────────────────────

function SetupStep({
  accounts, accountId, onAccount, onCreateAccount, onCopy, pasted, onPaste, onCheck, problems,
  memoryCount = 0,
}) {
  const ready = Boolean(accountId)
  const [showMemories, setShowMemories] = useState(false)
  return (
    <div>
      <p className="text-label font-semibold text-text-secondary">Konto</p>
      <div className="mt-2">
        <FinanceAccountPicker
          accounts={accounts}
          value={accountId}
          onChange={onAccount}
          onCreate={onCreateAccount}
        />
      </div>
      {/* Die eine Zusicherung, die zählt: ChatGPT bekommt nichts zu entscheiden,
          was hier schon entschieden ist. */}
      <p className="mt-2 px-1 text-caption text-text-muted">
        Die Umsätze landen auf diesem Konto — daran ändert die Antwort nichts.
      </p>

      <button
        onClick={onCopy}
        disabled={!ready}
        className="press-tint mt-6 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
      >
        <Copy size={18} /> KI-Kontext kopieren
      </button>

      {/* Was mitgeht, ohne dass man den Prompt lesen muss. Die Zeile erscheint
          erst, wenn es etwas zu zeigen gibt — ein Konto ohne Korrekturen
          bekommt keine Oberfläche für einen Zustand, in dem es nicht ist. */}
      {memoryCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowMemories(true)}
            className="press-tint mt-3 flex min-h-[44px] w-full items-center gap-3 rounded-btn bg-bg-card px-4 py-3 text-left"
          >
            <Brain size={18} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-ui text-text-primary">Gelerntes Wissen</span>
            <span className="shrink-0 text-ui tabular-nums text-text-secondary">{memoryCount}</span>
            <ChevronRight size={18} className="shrink-0 text-text-muted" />
          </button>
          <FinanceMemoriesSheet open={showMemories} onClose={() => setShowMemories(false)} />
        </>
      )}

      <p className="mt-4 text-body text-text-secondary">
        Kopiere den Kontext zu ChatGPT, lade dort deinen Kontoauszug hoch und füge die Antwort
        anschließend hier ein.
      </p>

      <label className="mt-6 block">
        <span className="mb-2 block text-label font-semibold text-text-secondary">
          Antwort einfügen
        </span>
        <textarea
          value={pasted}
          onChange={(e) => onPaste(e.target.value)}
          rows={8}
          placeholder="Hier die Antwort aus ChatGPT einfügen"
          aria-label="Antwort aus ChatGPT"
          className="w-full resize-none rounded-input bg-bg-input px-4 py-3.5 font-mono text-caption text-text-primary placeholder:font-sans placeholder:text-field placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
      </label>

      {problems.length > 0 && <Problems messages={problems} />}

      <button
        onClick={onCheck}
        disabled={!ready || pasted.trim() === ''}
        className="press-tint mt-4 w-full rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary disabled:opacity-60"
      >
        Prüfen
      </button>

      <p className="mt-4 text-caption text-text-muted">
        Der Auszug selbst wird nie gespeichert — nur die Umsätze, die du gleich zu sehen bekommst.
      </p>
    </div>
  )
}

// Exportiert, damit ein echter Browser sie vermessen kann: der Preview ist der
// eine Bildschirm dieses Flows, dessen Inhalt nicht der App gehört — ein Modell
// kann eine Beschreibung so lang schreiben, wie es will. Siehe
// tools/financeAiLayout.mjs.
export function PreviewStep({
  rows, summary, categories, merchants = [], busy, problems = [], onEditRow, onApply, onBack,
}) {
  return (
    <div>
      <section className="rounded-card border border-subtle bg-bg-card px-4 py-4">
        <p className="text-section font-semibold text-text-primary">
          {summary.erkannt === 1 ? '1 Umsatz erkannt' : `${summary.erkannt} Umsätze erkannt`}
        </p>
        <ul className="mt-2 space-y-1">
          {aiSummaryLines(summary).map((line) => (
            <li key={line} className="text-ui text-text-secondary">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <p className="px-1 pb-2 pt-5 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        Umsätze
      </p>
      <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
        {rows.map((row, i) => (
          <PreviewRow
            key={row.index}
            row={row}
            categories={categories}
            merchants={merchants}
            showBorder={i < rows.length - 1}
            onEdit={(patch) => onEditRow(row.index, patch)}
          />
        ))}
      </div>

      {problems.length > 0 && <Problems messages={problems} />}

      <p className="mt-6 text-ui text-text-secondary">{aiConfirmSentence(summary)}</p>
      <button
        onClick={onApply}
        disabled={busy || summary.neu === 0}
        aria-busy={busy}
        className="press-tint mt-2 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Wird importiert …' : 'Importieren'}
      </button>
      <button
        onClick={onBack}
        disabled={busy}
        className="press-tint mt-3 w-full rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary disabled:opacity-60"
      >
        Zurück
      </button>
    </div>
  )
}

// Eine Zeile, und darunter — aufgeklappt — alles, was man an ihr ändern darf.
// Datum, Betrag und Text stehen nicht darunter: die sind die Tatsache, und die
// korrigiert man nicht in einem Import, sondern gar nicht.
function PreviewRow({ row, categories, merchants = [], showBorder, onEdit }) {
  const [open, setOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const view = aiPreviewRow(row, categories)
  const tone =
    view.tone === 'accent'
      ? 'text-accent'
      : view.tone === 'attention'
        ? 'text-text-primary'
        : 'text-text-muted'

  return (
    <div className={showBorder ? 'border-b border-subtle' : ''}>
      <button
        type="button"
        onClick={() => view.editable && setOpen((o) => !o)}
        aria-expanded={view.editable ? open : undefined}
        disabled={!view.editable}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
          view.editable ? 'press-tint' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium text-text-primary">{view.title}</p>
          {view.subtitle && (
            <p className="truncate text-caption text-text-secondary">{view.subtitle}</p>
          )}
          <p className="mt-0.5 text-caption text-text-muted">
            {view.date} · <span className={tone}>{view.status}</span>
            {view.categoryLabel ? ` · ${view.categoryLabel}` : ''}
            {view.corrected ? ' · geändert' : view.reviewed ? ' · bestätigt' : ''}
          </p>
          {view.needsReview && view.reviewText && (
            <p className="mt-0.5 text-caption text-text-secondary">{view.reviewText}</p>
          )}
        </div>
        <p className="shrink-0 text-ui font-semibold tabular-nums text-text-primary">
          {view.amount}
        </p>
        {view.editable && (
          <ChevronDown
            size={16}
            className={`shrink-0 text-text-muted transition-transform motion-reduce:transition-none ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {open && view.editable && (
        <div className="space-y-4 border-t border-subtle px-4 py-4">
          <MerchantEditor
            merchants={merchants}
            merchantId={row.merchantId}
            merchantName={row.merchantName}
            onChange={onEdit}
          />

          <div>
            <p className="mb-2 text-label font-semibold text-text-secondary">Kategorie</p>
            <CategoryChipSelect
              categories={categories}
              value={row.categoryId}
              onChange={(categoryId) => onEdit({ categoryId })}
              emptyLabel="Keine"
            />
          </div>

          <div>
            <p className="mb-2 text-label font-semibold text-text-secondary">Art</p>
            <div className="flex flex-wrap gap-2">
              {TRANSACTION_TYPES.map((type) => {
                const active = row.transactionType === type
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onEdit({ transactionType: type })}
                    aria-pressed={active}
                    className={`press-tint min-h-[44px] rounded-chip px-3.5 py-2 text-ui transition-colors motion-reduce:transition-none ${
                      active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
                    }`}
                  >
                    {transactionTypeLabel(type)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 text-body text-text-primary">
              In Auswertung berücksichtigen
            </span>
            <Toggle
              checked={row.includeInAnalytics}
              onChange={(includeInAnalytics) => onEdit({ includeInAnalytics })}
              label="In Auswertung berücksichtigen"
            />
          </div>

          <label className="block">
            <span className="mb-2 block text-label font-semibold text-text-secondary">Notiz</span>
            <textarea
              value={row.note ?? ''}
              onChange={(e) => onEdit({ note: e.target.value })}
              rows={2}
              maxLength={2000}
              aria-label="Notiz"
              className="w-full resize-none rounded-input bg-bg-input px-4 py-3 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
            />
          </label>

          {/* Erst wenn es etwas zu lernen GIBT, wird gefragt. Das ist eine
              engere Frage als „wurde hier etwas geändert": wer nur eine Notiz
              getippt hat, hat die Buchung bearbeitet (`human_review` sagt
              zurecht „corrected"), aber nichts hinterlassen, woraus eine Regel
              für kommende Importe werden könnte. Eine Bestätigung erst recht
              nicht. Siehe rowHasLearnableCorrection und 0012, wo dieselbe Frage
              noch einmal gestellt wird. */}
          {rowHasLearnableCorrection(row) && (
            <>
              <LearningRow row={row} onOpen={() => setScopeOpen(true)} />
              <FinanceLearningScopeSheet
                open={scopeOpen}
                row={row}
                onClose={() => setScopeOpen(false)}
                onChoose={(learningMode) => onEdit({ learningMode })}
              />
            </>
          )}

          {/* „Passt so" ist keine Geste zum Zuklappen, sondern eine Aussage:
              ich habe diese Zeile angesehen und sie stimmt. Eine unsichere
              Buchung, deren Händler und Kategorie schon richtig waren, ist damit
              geprüft — und wird nach dem Import nicht noch einmal gefragt. Der
              leere Patch markiert genau das; dass daraus KEINE Korrektur wird,
              entscheidet rowHumanReview() und nicht dieser Knopf. */}
          <button
            type="button"
            onClick={() => {
              onEdit({})
              setOpen(false)
            }}
            className="press-tint flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-bg-input py-3 text-body font-semibold text-text-primary"
          >
            <Check size={18} /> Passt so
          </button>
        </div>
      )}
    </div>
  )
}

// Die Zeile, mit der eine Korrektur über diese eine Buchung hinauswirkt.
//
// Sie ist eine Zeile und kein Formular: die Antwort steht rechts, das Sheet
// dahinter fragt genauer. Und sie ist nie eine Pflicht — wer sie übergeht, hat
// „Nur diese Buchung" gewählt, was in fast allen Fällen das Richtige ist.
//
// Exportiert, damit ein echter Browser sie vermessen kann: sie liegt im
// aufgeklappten Editor, und was zugeklappt ist, misst kein statisches Rendering.
export function LearningRow({ row, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press-tint -mx-1 flex min-h-[44px] w-[calc(100%+0.5rem)] items-center gap-3 rounded-btn px-1 text-left"
    >
      <span className="min-w-0 flex-1 text-body text-text-primary">Für die Zukunft merken</span>
      <span className="max-w-[45%] shrink-0 truncate text-ui text-text-secondary">
        {learningModeLabel(row)}
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}

function DoneStep({ outcome, onFinish }) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="shrink-0 text-accent" />
        <p className="text-section font-semibold text-text-primary">Import abgeschlossen</p>
      </div>

      {outcome.replayed && (
        <p className="mt-2 text-ui text-text-secondary">
          Diese Antwort war bereits importiert — es wurde nichts doppelt gespeichert.
        </p>
      )}

      <ul className="mt-3 space-y-1">
        {outcome.lines.map((line) => (
          <li key={line} className="text-ui text-text-secondary">
            {line}
          </li>
        ))}
      </ul>

      <button
        onClick={onFinish}
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        Fertig
      </button>
    </div>
  )
}

function Problems({ messages }) {
  return (
    <ul
      className="mt-4 space-y-1 rounded-card border border-subtle bg-bg-card px-4 py-3"
      role="alert"
    >
      {messages.map((message) => (
        <li key={message} className="text-caption text-text-secondary">
          {message}
        </li>
      ))}
    </ul>
  )
}

// Den Händler einer Zeile korrigieren.
//
// ZWEI WEGE, EIN ERGEBNIS: einen Händler antippen, den es schon gibt, oder den
// Namen selbst eintippen. Der zweite Weg ist der wichtigere — genau die Zeilen,
// die zu prüfen sind, sind ja die, bei denen das Modell keinen bekannten
// Händler getroffen hat.
//
// WAS DABEI NICHT ENTSTEHT: ein Händler. „REWE" zu tippen legt keinen Eintrag in
// `finance_merchants` an und schon gar kein Muster — der Name wird als Text auf
// dieser einen Buchung gespeichert (`finance_transaction_overrides.merchant_name`,
// siehe 0011). Eine Korrektur an einer Zeile ist eine Korrektur an einer Zeile;
// eine Regel für alle künftigen entsteht weiterhin nur in der Zuordnung, mit
// Muster und Backtest.
//
// Das Textfeld steht oben, die Chips darunter: die Chips sind die Abkürzung, das
// Tippen ist der Weg, der immer funktioniert.
//
// Exportiert, damit ein echter Browser sie vermessen kann — sie ist im Preview
// zugeklappt, und was zugeklappt ist, misst kein statisches Rendering.
export function MerchantEditor({ merchants, merchantId, merchantName, onChange }) {
  return (
    <div>
      <p className="mb-2 text-label font-semibold text-text-secondary">Händler</p>
      <input
        value={merchantName ?? ''}
        // Ein getippter Name gehört keinem Eintrag mehr — die Verknüpfung fällt
        // mit dem ersten Tastendruck weg, statt auf einen Namen zu zeigen, der
        // nicht mehr ihrer ist.
        onChange={(e) => onChange({ merchantName: e.target.value, merchantId: null })}
        placeholder="z. B. REWE"
        maxLength={120}
        aria-label="Händler"
        className="w-full rounded-input bg-bg-input px-4 py-3 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
      />
      {merchants.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {merchants.map((merchant) => {
            const active = merchantId === merchant.id
            return (
              <button
                key={merchant.id}
                type="button"
                onClick={() =>
                  onChange({ merchantId: merchant.id, merchantName: merchant.canonical_name })
                }
                aria-pressed={active}
                className={`press-tint flex min-h-[44px] max-w-full items-center rounded-chip px-3.5 py-2 text-ui transition-colors motion-reduce:transition-none ${
                  active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
                }`}
              >
                <span className="truncate">{merchant.canonical_name}</span>
              </button>
            )
          })}
        </div>
      )}
      <p className="mt-2 text-caption text-text-muted">
        Gilt nur für diese Buchung — an deinen gespeicherten Händlerregeln ändert sich nichts.
      </p>
    </div>
  )
}

// ── Kleinigkeiten, die den Browser brauchen ─────────────────────────────────

/**
 * In die Zwischenablage, mit dem alten Weg als Rückfallebene.
 *
 * `navigator.clipboard` gibt es nur in einem sicheren Kontext; ohne ihn wäre
 * der einzige Knopf dieses Flows tot. Der Rückfall ist hässlich und funktioniert.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Weiter unten.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/**
 * Die Identität dieses Blocks auf diesem Konto — 64 Hex-Zeichen, aus denen
 * keine Buchung zurückzurechnen ist. Dasselbe Verfahren, das der PDF-Import für
 * eine Datei benutzt (src/lib/finance/dkb/sourceHash.js), hier über den Text.
 */
async function hashOfBlock(accountId, text) {
  const bytes = new TextEncoder().encode(`${accountId}\n${text.trim()}`)
  return sourceHash(bytes)
}
