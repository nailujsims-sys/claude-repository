import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import BottomSheet from './BottomSheet'
import Toggle from './Toggle'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { buildClassificationQueue } from '../lib/finance/classificationQueue'
import { buildLearnRequest } from '../lib/finance/learning'
import { analyticsInclusion } from '../lib/finance/analytics'
import { failureLog } from '../lib/finance/importFlow'
import {
  DECISION,
  MAX_NOTE_LENGTH,
  backtestNumbers,
  blockingConflict,
  bookingHeadline,
  buildOverride,
  categoryLabelOf,
  claimingMerchants,
  compactPreview,
  decisionExplanation,
  decisionKindOf,
  describeLearnFailure,
  describeSaveOutcome,
  descriptionSegments,
  learnErrorLines,
  normalizeNote,
  patternLabelOf,
  patternTypeFor,
  patternWarnings,
  rangeIsLearnable,
  rangeText,
  rangeTokens,
  selectionRange,
  shortDescription,
} from '../lib/finance/classificationFlow'

// Zuordnung: one booking, one screen, one tap per decision.
//
// v1.21 built the flow; production then said it was too tall — every decision
// was a card with a heading, and the save button lived below the fold. The
// answer is not tighter padding, it is PROGRESSIVE DISCLOSURE: the screen shows
// what was decided, one compact row per decision, and the pickers themselves
// open as their own small sheets. What stays visible at all times is the
// booking, the gesture, and the two buttons.
//
// NOTHING HERE DECIDES ANYTHING, unchanged from v1.21: matchMerchant decides
// who a booking belongs to, resolveCategory what kind of spending it was,
// backtestPattern what a new pattern would do, resolveAnalyticsInclusion
// whether a booking counts, and the database writes.
export default function FinanceClassifySheet() {
  const { financeClassify, closeFinanceClassify } = useUI()
  return financeClassify ? <Sheet onClose={closeFinanceClassify} /> : null
}

function Sheet({ onClose }) {
  const {
    transactions, patterns, merchants, categories, categoryRules, overrides,
    saveClassification,
  } = useFinance()

  const [skipped, setSkipped] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState(null)
  const [done, setDone] = useState(null)
  // A save that got halfway holds its booking in place. Without this the one
  // reload at the end of the sequence could resolve the booking and move the
  // screen on — while the message still says „ein erneuter Versuch wiederholt
  // nur, was fehlt". The user would have nothing left to retry on.
  const [pinned, setPinned] = useState(null)
  const [progress, setProgress] = useState(null)

  const { entries, open, queue } = useMemo(
    () => buildClassificationQueue({
      transactions, patterns, merchants, rules: categoryRules, overrides, skippedIds: skipped,
    }),
    [transactions, patterns, merchants, categoryRules, overrides, skipped]
  )

  const entry = pinned
    ? entries.find((e) => e.transaction.id === pinned) ?? queue[0] ?? null
    : queue[0] ?? null

  const release = useCallback(() => {
    setPinned(null)
    setProgress(null)
    setFailure(null)
  }, [])

  const onSkip = useCallback(() => {
    if (!entry) return
    setSkipped((prev) => new Set(prev).add(entry.transaction.id))
    release()
  }, [entry, release])

  /**
   * Everything this screen decided, saved.
   *
   * Sequenced rather than wrapped in a new database function, and deliberately:
   * the rule path IS finance_learn_merchant_rule and must stay that way, an
   * override is a single row, and a merchant default is a single column — each
   * step is idempotent on its own, so a repeat after a failure re-does no harm.
   * What a sequence cannot give is all-or-nothing, so the screen does the other
   * honest thing: it reports exactly which steps happened. It never says
   * „gespeichert" over a half-written decision.
   */
  const onSave = useCallback(
    async ({ learnRequest, transactionId, override, merchantScope, labels, kind, reason }) => {
      setSaving(true)
      setFailure(null)

      // What an earlier attempt already wrote. Each repository call is
      // idempotent, but repeating one is still a write nobody asked for — and
      // a second learn call would count as a second decision in the result.
      const already = progress ?? { rule: null, override: false, merchant: false }
      const plan = {
        transactionId,
        learnRequest: already.rule ? null : learnRequest,
        override: already.override ? null : override,
        merchantScope: already.merchant ? null : merchantScope,
      }
      // The merchant an earlier attempt created: its id lives in that attempt's
      // result, not in this render's state.
      if (!plan.learnRequest && plan.merchantScope && !plan.merchantScope.merchantId && already.rule?.merchant_id) {
        plan.merchantScope = { ...plan.merchantScope, merchantId: already.rule.merchant_id }
      }

      const combine = (fresh) => ({
        rule: already.rule ?? fresh?.rule ?? null,
        override: already.override || Boolean(fresh?.override),
        merchant: already.merchant || Boolean(fresh?.merchant),
      })
      const report = (steps, error = null) =>
        describeSaveOutcome({ steps, include: merchantScope?.include, labels, kind, reason, error })

      try {
        const steps = combine(await saveClassification(plan))
        setPinned(null)
        setProgress(null)
        setDone(report(steps))
      } catch (err) {
        console.error(failureLog('zuordnen', err))
        const steps = combine(err.steps)
        // Hold this booking — and what was already written — until the user
        // retries or deliberately moves on.
        setProgress(steps)
        setPinned(transactionId)
        setFailure(report(steps, err).failure ?? describeLearnFailure(err))
      } finally {
        setSaving(false)
      }
    },
    [saveClassification, progress]
  )

  return (
    <BottomSheet open onClose={onClose} full title="Zuordnung">
      {/* One scroll container — BottomSheet's own — and a footer that sticks to
          its bottom edge. The actions are therefore reachable without scrolling
          whatever the booking text does, which was the whole complaint. */}
      <div className="flex min-h-full flex-col px-5 pt-3">
        {/* THE ORDER MATTERS, and it was wrong.
            `open.length === 0` used to be asked first, which made the queue's
            end state beat everything else:

              • a half-saved LAST booking vanished behind „Keine offenen
                Zuordnungen" — the rule had resolved it, so the queue was empty
                while `pinned` still held it, and the retry the message promised
                had nowhere to happen;
              • and the confirmation for the last booking was never shown at
                all, for the same reason.

            So a held retry comes first — it is the only state with unfinished
            work in it — then what was just saved, and only then the end of the
            queue. */}
        {pinned && entry ? (
          <BookingStep
            key={entry.transaction.id}
            entry={entry}
            transactions={transactions}
            patterns={patterns}
            merchants={merchants}
            categories={categories}
            overrides={overrides}
            remaining={Math.max(queue.length, 1)}
            saving={saving}
            failure={failure}
            onSave={onSave}
            onSkip={onSkip}
          />
        ) : done ? (
          <SavedStep
            done={done}
            remaining={queue.length}
            onNext={() => setDone(null)}
            onClose={onClose}
          />
        ) : open.length === 0 ? (
          <FinishedStep onClose={onClose} />
        ) : entry ? (
          <BookingStep
            key={entry.transaction.id}
            entry={entry}
            transactions={transactions}
            patterns={patterns}
            merchants={merchants}
            categories={categories}
            overrides={overrides}
            remaining={queue.length}
            saving={saving}
            failure={failure}
            onSave={onSave}
            onSkip={onSkip}
          />
        ) : (
          <PostponedStep count={open.length} onAgain={() => setSkipped(new Set())} onClose={onClose} />
        )}
      </div>
    </BottomSheet>
  )
}

// ── One booking ──────────────────────────────────────────────────────────────

// THREE KINDS OF DECISION, and the screen asks for the right one — unchanged
// from v1.21 (see classificationFlow.js). What changed is how much room each
// one takes: a pattern gesture only where a pattern is what is missing.
export function BookingStep({
  entry, transactions, patterns, merchants, categories, overrides,
  remaining, saving, failure, onSave, onSkip,
}) {
  const transaction = entry.transaction
  const head = bookingHeadline(transaction)
  const kind = decisionKindOf(entry)
  const explanation = decisionExplanation(entry, merchants)
  const override = useMemo(
    () => overrides.find((o) => o.transaction_id === transaction.id) ?? null,
    [overrides, transaction]
  )

  const { lines, segments, aligned } = useMemo(() => descriptionSegments(transaction), [transaction])

  // ── what the user decides here ──
  const [anchor, setAnchor] = useState(null)
  const [range, setRange] = useState(null)
  const [merchantId, setMerchantId] = useState(
    () => entry.merchantMatch?.merchant?.id ??
      (entry.merchantMatch?.merchantIds?.length === 1 ? entry.merchantMatch.merchantIds[0] : null)
  )
  const [merchantName, setMerchantName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [alwaysReview, setAlwaysReview] = useState(false)
  const [categorySlug, setCategorySlug] = useState(
    () => categories.find((c) => c.id === entry.category?.suggestedCategoryId)?.slug ?? null
  )
  const [note, setNote] = useState(override?.note ?? '')
  const [picker, setPicker] = useState(null) // 'merchant' | 'category' | null

  // Whether this booking counts — started from the answer that is true today,
  // so the switch shows the state rather than a guess about it.
  const current = analyticsInclusion({
    transaction, override, merchantMatch: entry.merchantMatch, merchants,
  })
  const [include, setInclude] = useState(current.included)
  const [scope, setScope] = useState('transaction') // 'transaction' | 'merchant'

  const onWord = useCallback(
    (segment) => {
      if (!segment.learnable) return
      if (range && range.from === range.to && range.from === segment.index) {
        setRange(null)
        setAnchor(null)
        return
      }
      if (anchor === null || range === null || range.from !== range.to) {
        setAnchor(segment.index)
        setRange({ from: segment.index, to: segment.index })
        return
      }
      setRange(selectionRange(anchor, segment.index))
    },
    [anchor, range]
  )

  const tokens = useMemo(() => rangeTokens(segments, range), [segments, range])
  const visible = useMemo(() => rangeText(segments, range), [segments, range])

  useEffect(() => {
    if (!nameTouched && !merchantId) setMerchantName(visible)
  }, [visible, nameTouched, merchantId])

  const reviewMode = !merchantId && alwaysReview ? 'always_review' : null
  const learning = kind === DECISION.LEARN

  const built = useMemo(() => {
    if (!learning || tokens.length === 0 || !categorySlug) return null
    return buildLearnRequest({
      transaction,
      selection: tokens,
      patternType: patternTypeFor(tokens),
      categorySlug,
      categories,
      merchantId,
      merchantName,
      reviewMode,
      transactions,
      patterns,
      overrides,
    })
  }, [learning, transaction, tokens, categorySlug, categories, merchantId, merchantName,
      reviewMode, transactions, patterns, overrides])

  const numbers = built?.backtest
    ? backtestNumbers({ backtest: built.backtest, transaction, override })
    : null
  const blocking = built?.backtest ? blockingConflict({ backtest: built.backtest, merchants }) : null
  const warnings = built?.backtest && numbers
    ? patternWarnings({ backtest: built.backtest, numbers, total: transactions.length, merchantId })
    : []

  const chosenMerchant = merchants.find((m) => m.id === merchantId) ?? null
  const chosenMerchantName = chosenMerchant?.canonical_name ?? merchantName.trim()
  const chosenCategory = categories.find((c) => c.slug === categorySlug) ?? null
  const categoryName = categoryLabelOf(categories, categorySlug)

  // A merchant-wide analytics decision needs a merchant that already exists —
  // for a brand-new one the id arrives with the learn call, which is why the
  // scope row only appears once one is picked or recognised.
  const merchantKnown = Boolean(chosenMerchant) || Boolean(built?.request && merchantName.trim())
  // Offered in BOTH directions, and only when the switch actually moved. A
  // merchant-wide „nicht berücksichtigen" that could not be taken back would be
  // a one-way door, and this screen is the only place the door is.
  const includeChanged = include !== current.included
  const scopeOffered = includeChanged && merchantKnown

  const noteValue = normalizeNote(note)
  const noteChanged = noteValue !== (override?.note ?? null)
  // A merchant-wide decision is a decision about the DEFAULT, so an older
  // individual one about this booking has to get out of its way — otherwise the
  // booking the user was looking at would be the one booking the new rule does
  // not reach. Setting it back to null rather than to the same value keeps the
  // meaning honest: this booking has no opinion of its own any more, it follows
  // the merchant. Every other field of the override survives (see
  // financeRepository.saveOverride).
  const clearsIndividual =
    scope === 'merchant' && typeof override?.include_in_analytics === 'boolean'

  const canSave = learning
    ? Boolean(built?.valid) && !blocking && !saving
    : Boolean(chosenCategory) && Boolean(merchantId) && !saving

  const submit = () => {
    const labels = { merchantName: chosenMerchantName, categoryName }
    // For a conflict or a review the override IS the decision, so it always
    // carries merchant and category. For a learned rule the rule carries them,
    // and an override is written only when the user decided something the rule
    // cannot hold: a note, or that this booking does not count.
    const individual =
      scope === 'merchant'
        ? (clearsIndividual ? { include_in_analytics: null } : {})
        : (includeChanged ? { include_in_analytics: include } : {})

    const overridePatch = learning
      ? (noteChanged || Object.keys(individual).length > 0
          ? { ...(noteChanged ? { note: noteValue } : {}), ...individual }
          : null)
      : {
          ...buildOverride({ merchantId, categoryId: chosenCategory.id }),
          note: noteValue,
          // A conflict or a review always writes the row anyway, so the
          // individual decision is written with it — or cleared, when the user
          // just said the merchant decides.
          ...(scope === 'merchant' ? { include_in_analytics: null } : { include_in_analytics: include }),
        }

    onSave({
      learnRequest: learning ? built.request : null,
      transactionId: transaction.id,
      override: overridePatch,
      // null unless the user chose the merchant-wide scope. `merchantId` may be
      // null here for a merchant that is about to be created — the learn call
      // returns its id.
      merchantScope: scope === 'merchant' && merchantKnown ? { merchantId, include } : null,
      labels,
      kind,
      reason: entry.category?.reason ?? null,
    })
  }

  return (
    <>
      {/* ── the booking, in three lines ── */}
      <p className="text-caption text-text-muted">
        {remaining === 1 ? 'Letzte offene Buchung' : `Noch ${remaining} offene Buchungen`}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="text-section font-bold tabular-nums text-text-primary">
          {head.amount}
        </p>
        <p className="shrink-0 text-caption text-text-secondary">{head.date}</p>
      </div>
      <p className="mt-0.5 truncate text-caption text-text-muted" title={transaction.raw_description}>
        {shortDescription(transaction)}
      </p>

      {explanation.headline && (
        <div className="mt-3 rounded-btn bg-bg-card px-3 py-2">
          <p className="text-ui font-medium text-text-primary">{explanation.headline}</p>
          {explanation.lines.map((line) => (
            <p key={line} className="mt-0.5 text-caption text-text-secondary">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* ── the gesture, only where a pattern is what is missing ── */}
      {learning && (
        <>
          <p className="pb-1.5 pt-4 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
            Wörter markieren
          </p>
          {/* Capped and scrollable on its own: a five-line booking text may not
              push the buttons off the screen. */}
          <div className="max-h-[132px] overflow-y-auto overscroll-contain rounded-btn bg-bg-card px-3 py-2">
            <WordPicker lines={lines} range={range} onWord={onWord} />
          </div>
          {!aligned && (
            <p className="mt-1.5 text-caption text-text-muted">
              Der gespeicherte Text weicht vom angezeigten ab — eine Markierung kann abgelehnt werden.
            </p>
          )}
          {range && !rangeIsLearnable(segments, range) && (
            <p className="mt-1.5 text-caption text-text-muted" role="alert">
              Dieses Wort ist nicht vollständig lesbar und kann kein Muster werden.
            </p>
          )}
        </>
      )}

      {/* ── the decisions, one compact row each ── */}
      <div className="mt-4 overflow-hidden rounded-card bg-bg-card">
        {kind === DECISION.RESOLVE_CONFLICT ? (
          <PickerRow
            label="Händler"
            value={chosenMerchantName || 'Wählen'}
            onClick={() => setPicker('merchant')}
          />
        ) : learning ? (
          <PickerRow
            label="Händler"
            value={chosenMerchantName || 'Wählen'}
            disabled={tokens.length === 0}
            hint={tokens.length === 0 ? 'Erst Wörter markieren' : undefined}
            onClick={() => setPicker('merchant')}
          />
        ) : (
          <StaticRow label="Händler" value={chosenMerchantName || '—'} />
        )}
        <PickerRow label="Kategorie" value={chosenCategory?.label ?? 'Wählen'} onClick={() => setPicker('category')} />
        <div className="flex min-h-[44px] items-center justify-between gap-3 border-t border-subtle px-4 py-2">
          <span className="min-w-0 flex-1 text-body text-text-primary">
            In Auswertung berücksichtigen
          </span>
          <Toggle
            checked={include}
            onChange={(next) => {
              setInclude(next)
              // Back to the value it already had? Then there is nothing to
              // scope, and a stale „alle Buchungen von …" must not survive it.
              if (next === current.included) setScope('transaction')
            }}
            label="In Auswertung berücksichtigen"
          />
        </div>
        {scopeOffered && (
          <div className="border-t border-subtle px-4 py-2">
            <p className="text-caption text-text-muted">Gilt für</p>
            <ScopeOption
              checked={scope === 'transaction'}
              onPick={() => setScope('transaction')}
              label="Nur diese Buchung"
            />
            <ScopeOption
              checked={scope === 'merchant'}
              onPick={() => setScope('merchant')}
              label={`Alle Buchungen von ${chosenMerchantName}`}
            />
            {scope === 'merchant' && clearsIndividual && (
              <p className="pb-1 text-caption text-text-muted">
                Die bisherige Einstellung dieser Buchung wird dabei aufgehoben — sie folgt dann dem
                Händler.
              </p>
            )}
          </div>
        )}
        <div className="border-t border-subtle px-4 py-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            rows={1}
            placeholder="Notiz hinzufügen …"
            aria-label="Notiz"
            className="max-h-[72px] min-h-[40px] w-full resize-none bg-transparent py-1 text-body text-text-primary placeholder:text-text-muted outline-none"
          />
          {note.length > MAX_NOTE_LENGTH - 60 && (
            <p className="text-caption text-text-muted">
              {MAX_NOTE_LENGTH - note.length} Zeichen übrig
            </p>
          )}
        </div>
      </div>

      {/* ── what saving will do, in one line ── */}
      {built && !built.valid && (
        <ul className="mt-3 space-y-1">
          {learnErrorLines(built.errors).map((line) => (
            <li key={line} className="text-caption text-text-secondary" role="alert">
              {line}
            </li>
          ))}
        </ul>
      )}
      {blocking && (
        <p className="mt-3 text-caption text-text-secondary" role="alert">
          {blocking}
        </p>
      )}
      {built?.valid && numbers && !blocking && (
        <p className="mt-3 text-ui text-text-secondary">
          {compactPreview({
            numbers, patternLabel: patternLabelOf(tokens),
            merchantName: chosenMerchantName, categoryName,
          })}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning.text} className="mt-1.5 text-caption text-text-muted">
          {warning.text}
        </p>
      ))}
      {failure && (
        <p className="mt-3 text-ui text-text-primary" role="alert">
          {failure}
        </p>
      )}

      {/* ── the two actions, always reachable ── */}
      <div className="sticky bottom-0 -mx-5 mt-auto flex gap-2 border-t border-subtle bg-bg-elevated px-5 pb-5 pt-3">
        <button
          onClick={onSkip}
          disabled={saving}
          className="press-tint min-h-[44px] flex-1 rounded-btn bg-bg-input py-3 text-body font-semibold text-text-primary disabled:opacity-40"
        >
          Später
        </button>
        <button
          onClick={submit}
          disabled={!canSave}
          aria-busy={saving}
          className="press-tint min-h-[44px] flex-[2] rounded-btn bg-accent py-3 text-body font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
      </div>

      {picker === 'merchant' && (
        <MerchantPicker
          merchants={merchants}
          merchantId={merchantId}
          suggestion={visible}
          name={merchantName}
          alwaysReview={alwaysReview}
          allowNew={learning}
          only={kind === DECISION.RESOLVE_CONFLICT ? (entry.merchantMatch?.merchantIds ?? []) : null}
          onAlwaysReview={setAlwaysReview}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            setMerchantId(id)
            setNameTouched(false)
            setAlwaysReview(false)
            if (id === null) setMerchantName(visible)
            setPicker(null)
          }}
          onName={(value) => {
            setNameTouched(true)
            setMerchantId(null)
            setMerchantName(value)
          }}
        />
      )}
      {picker === 'category' && (
        <CategoryPicker
          categories={categories}
          value={categorySlug}
          onClose={() => setPicker(null)}
          onPick={(slug) => {
            setCategorySlug(slug)
            setPicker(null)
          }}
        />
      )}
    </>
  )
}

// ── Compact rows ─────────────────────────────────────────────────────────────

function PickerRow({ label, value, onClick, disabled = false, hint }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="press-tint flex min-h-[44px] w-full items-center gap-3 border-b border-subtle px-4 py-2 text-left disabled:opacity-50 last:border-b-0"
    >
      <span className="shrink-0 text-body text-text-primary">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-body text-text-secondary">
        {hint ?? value}
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-muted" />
    </button>
  )
}

function StaticRow({ label, value }) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-b border-subtle px-4 py-2 last:border-b-0">
      <span className="shrink-0 text-body text-text-primary">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-body text-text-secondary">{value}</span>
    </div>
  )
}

function ScopeOption({ checked, onPick, label }) {
  return (
    <button
      onClick={onPick}
      aria-pressed={checked}
      className="press-tint flex min-h-[44px] w-full items-center gap-2.5 py-1 text-left"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-accent' : 'border-text-muted'
        }`}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-ui text-text-primary">{label}</span>
    </button>
  )
}

// ── The gesture ──────────────────────────────────────────────────────────────

function WordPicker({ lines, range, onWord }) {
  const selected = (index) => !!range && index >= range.from && index <= range.to
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <div key={i} className="flex flex-wrap gap-1">
          {line.map((segment) => (
            <button
              key={segment.index}
              onClick={() => onWord(segment)}
              disabled={!segment.learnable}
              aria-pressed={selected(segment.index)}
              title={segment.learnable ? undefined : 'Nicht vollständig lesbar — nicht lernbar'}
              // max-w-full + break-words: a bank prints words longer than a
              // phone is wide. The chip wraps inside itself rather than pushing
              // the screen sideways.
              className={`press-tint min-h-[44px] max-w-full break-words rounded-chip px-2 py-2 text-left text-ui transition-colors motion-reduce:transition-none ${
                selected(segment.index)
                  ? 'bg-accent font-semibold text-white'
                  : segment.learnable
                    ? 'bg-bg-input text-text-primary'
                    : 'cursor-not-allowed bg-transparent text-text-muted line-through'
              }`}
            >
              {segment.text}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── The pickers, as their own small sheets ───────────────────────────────────
//
// The same BottomSheet the rest of the app uses, one layer up. A picker is a
// detour, not a step: it opens over the decision it belongs to, and closing it
// returns to exactly the screen that was there.

function MerchantPicker({
  merchants, merchantId, name, suggestion, alwaysReview, allowNew, only,
  onAlwaysReview, onName, onPick, onClose,
}) {
  const [query, setQuery] = useState('')
  const pool = only ? merchants.filter((m) => only.includes(m.id)) : merchants
  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return pool.slice(0, 20)
    return pool.filter((m) => m.canonical_name.toLowerCase().includes(needle)).slice(0, 20)
  }, [pool, query])

  return (
    <BottomSheet open onClose={onClose} title="Händler" z="z-[60]">
      <div className="px-5 pb-6">
        {allowNew && (
          <label className="block pt-1">
            <span className="mb-1.5 block text-label font-medium text-text-secondary">Neuer Händler</span>
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder={suggestion || 'Name'}
              className="w-full rounded-input bg-bg-input px-4 py-3 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
            />
          </label>
        )}

        {allowNew && (
          <label className="press-tint mt-3 flex min-h-[44px] items-center justify-between gap-3 rounded-btn bg-bg-input px-4 py-2">
            <span className="min-w-0 flex-1 text-ui text-text-primary">
              Diesen Händler künftig immer prüfen
              <span className="mt-0.5 block text-caption text-text-muted">
                Für Zahlungsdienste wie PayPal.
              </span>
            </span>
            <Toggle checked={alwaysReview} onChange={onAlwaysReview} label="Immer prüfen" />
          </label>
        )}

        {pool.length > 0 && (
          <>
            <span className="mb-1.5 mt-4 flex items-center gap-2 rounded-input bg-bg-input px-4">
              <Search size={16} className="shrink-0 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Bestehenden Händler suchen"
                aria-label="Händler suchen"
                className="w-full bg-transparent py-3 text-field text-text-primary placeholder:text-text-muted outline-none"
              />
            </span>
            <div className="max-h-[40vh] overflow-y-auto overscroll-contain">
              {found.map((merchant) => (
                <button
                  key={merchant.id}
                  onClick={() => onPick(merchant.id)}
                  aria-pressed={merchantId === merchant.id}
                  className="press-tint flex min-h-[44px] w-full items-center justify-between gap-3 rounded-chip px-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                    {merchant.canonical_name}
                  </span>
                  {merchantId === merchant.id && <Check size={18} className="shrink-0 text-accent" />}
                </button>
              ))}
              {found.length === 0 && (
                <p className="px-3 py-2 text-caption text-text-muted">Kein Händler gefunden.</p>
              )}
            </div>
          </>
        )}

        {allowNew && (
          <button
            onClick={() => onPick(null)}
            className="press-tint mt-3 min-h-[44px] w-full rounded-btn bg-accent py-3 text-body font-semibold text-white"
          >
            Neuen Händler verwenden
          </button>
        )}
      </div>
    </BottomSheet>
  )
}

function CategoryPicker({ categories, value, onPick, onClose }) {
  return (
    <BottomSheet open onClose={onClose} title="Kategorie" z="z-[60]">
      <div className="px-5 pb-6">
        {categories.map((category) => (
          <button
            key={category.id ?? category.slug}
            onClick={() => onPick(category.slug)}
            aria-pressed={value === category.slug}
            className="press-tint flex min-h-[44px] w-full items-center justify-between gap-3 rounded-chip px-3 py-2 text-left"
          >
            <span
              className={`min-w-0 flex-1 truncate text-body ${
                value === category.slug ? 'font-semibold text-text-primary' : 'text-text-secondary'
              }`}
            >
              {category.label}
            </span>
            {value === category.slug && <Check size={18} className="shrink-0 text-accent" />}
          </button>
        ))}
        {categories.length === 0 && (
          <p className="px-3 py-2 text-caption text-text-muted">Es wurden keine Kategorien geladen.</p>
        )}
      </div>
    </BottomSheet>
  )
}

// ── After ────────────────────────────────────────────────────────────────────

function SavedStep({ done, remaining, onNext, onClose }) {
  return (
    <div className="pt-2" aria-live="polite">
      <p className="text-section font-semibold text-text-primary">
        {done.partial ? 'Teilweise gespeichert' : 'Gespeichert'}
      </p>
      <ul className="mt-2 space-y-1">
        {done.lines.map((line) => (
          <li key={line} className="text-ui text-text-secondary">
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-caption text-text-muted">
        {remaining > 0
          ? remaining === 1
            ? 'Eine Buchung wartet noch.'
            : `${remaining} Buchungen warten noch.`
          : 'Es wartet keine Buchung mehr.'}
      </p>
      {/* The way on. Without it this screen was a dead end whenever bookings
          remained: the confirmation stayed until the sheet was closed. Deliberately
          a button rather than a timer — the user reads what happened and decides
          when to move on. */}
      <button
        onClick={remaining > 0 ? onNext : onClose}
        className="press-tint mt-5 min-h-[44px] w-full rounded-btn bg-accent py-3 text-body font-semibold text-white"
      >
        {remaining > 0 ? 'Weiter' : 'Fertig'}
      </button>
    </div>
  )
}

function FinishedStep({ onClose }) {
  return (
    <div className="pt-2">
      {/* Not „alles zugeordnet": a booking somebody locked or overrode is out of
          the queue without necessarily carrying a merchant AND a category. */}
      <p className="text-section font-semibold text-text-primary">Keine offenen Zuordnungen</p>
      <p className="mt-2 text-ui text-text-secondary">
        Aktuell wartet keine Buchung auf deine Entscheidung.
      </p>
      <button
        onClick={onClose}
        className="press-tint mt-6 min-h-[44px] w-full rounded-btn bg-accent py-3 text-body font-semibold text-white"
      >
        Fertig
      </button>
    </div>
  )
}

function PostponedStep({ count, onAgain, onClose }) {
  return (
    <div className="pt-2">
      <p className="text-section font-semibold text-text-primary">Für jetzt fertig</p>
      <p className="mt-2 text-ui text-text-secondary">
        {count === 1
          ? 'Eine Buchung hast du auf später verschoben. Sie bleibt offen.'
          : `${count} Buchungen hast du auf später verschoben. Sie bleiben offen.`}
      </p>
      <button
        onClick={onClose}
        className="press-tint mt-6 min-h-[44px] w-full rounded-btn bg-accent py-3 text-body font-semibold text-white"
      >
        Fertig
      </button>
      <button
        onClick={onAgain}
        className="press-tint mt-3 min-h-[44px] w-full rounded-btn bg-bg-input py-3 text-body font-semibold text-text-primary"
      >
        Noch einmal durchgehen
      </button>
    </div>
  )
}
