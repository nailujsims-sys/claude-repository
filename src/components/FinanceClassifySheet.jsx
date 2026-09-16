import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { buildClassificationQueue } from '../lib/finance/classificationQueue'
import { buildLearnRequest } from '../lib/finance/learning'
import { failureLog } from '../lib/finance/importFlow'
import {
  backtestNumbers,
  blockingConflict,
  bookingHeadline,
  categoryLabelOf,
  confirmationLines,
  describeLearnFailure,
  describeLearnResult,
  descriptionSegments,
  learnErrorLines,
  patternLabelOf,
  patternTypeFor,
  patternWarnings,
  rangeIsLearnable,
  rangeText,
  rangeTokens,
  selectionRange,
} from '../lib/finance/classificationFlow'

// Zuordnung: one booking, one gesture, one rule.
//
// The gesture is the whole feature — mark the words that identify the merchant,
// name them, pick a category. Everything the screen then says about what that
// will do comes from the engine that 0008 already contains: matchMerchant
// decides who a booking belongs to, resolveCategory what kind of spending it
// was, backtestPattern what the new pattern would do to the bookings that exist,
// and finance_learn_merchant_rule writes all of it in one transaction.
//
// NOTHING HERE MATCHES ANYTHING. There is no second, simpler matcher in this
// file, no ranking between two merchants, no list of words to ignore. When the
// engine says a booking is claimed by two merchants, the screen says so and the
// user decides.
export default function FinanceClassifySheet() {
  const { financeClassify, closeFinanceClassify } = useUI()
  return financeClassify ? <Sheet onClose={closeFinanceClassify} /> : null
}

function Sheet({ onClose }) {
  const {
    transactions, patterns, merchants, categories, categoryRules, overrides, learnRule,
  } = useFinance()

  // Pushed back with „Später": a session-only list. It changes no data, which is
  // exactly why it may not be persisted — a booking postponed on the phone is
  // still open everywhere else.
  const [skipped, setSkipped] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState(null)
  const [done, setDone] = useState(null)

  const { open, queue } = useMemo(
    () => buildClassificationQueue({
      transactions, patterns, merchants, rules: categoryRules, overrides, skippedIds: skipped,
    }),
    [transactions, patterns, merchants, categoryRules, overrides, skipped]
  )

  const entry = queue[0] ?? null

  const onSkip = useCallback(() => {
    if (!entry) return
    setSkipped((prev) => new Set(prev).add(entry.transaction.id))
    setFailure(null)
  }, [entry])

  const onSave = useCallback(
    async (request, labels) => {
      setSaving(true)
      setFailure(null)
      try {
        const result = await learnRule(request)
        // Read from the database's answer, not from the preview: the two agree,
        // and where they would not, the database is the one that is right.
        setDone(describeLearnResult(result, labels))
      } catch (err) {
        console.error(failureLog('zuordnen', err))
        setFailure(describeLearnFailure(err))
      } finally {
        setSaving(false)
      }
    },
    [learnRule]
  )

  // The success note belongs to the booking that produced it. Once the reload
  // has moved the queue on, it is stale — so it clears itself the moment a
  // different booking is in front of the user.
  const doneFor = useRef(null)
  useEffect(() => {
    if (done && doneFor.current !== entry?.transaction?.id) setDone(null)
    if (!done) doneFor.current = entry?.transaction?.id ?? null
  }, [entry, done])

  return (
    <BottomSheet open onClose={onClose} full title="Zuordnung">
      <div className="px-5 py-5 pb-10">
        {open.length === 0 ? (
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
            done={done}
            onSave={onSave}
            onSkip={onSkip}
          />
        ) : (
          <PostponedStep
            count={open.length}
            onAgain={() => setSkipped(new Set())}
            onClose={onClose}
          />
        )}
      </div>
    </BottomSheet>
  )
}

// ── One booking ──────────────────────────────────────────────────────────────

// Exported so a real browser can measure it. This is the screen that has to
// survive a bank's imagination — a description of two hundred words, an amount
// with two thousands separators, a merchant list that does not end — and none
// of that can be checked in a DOM without layout. See
// tools/financeClassifyLayout.mjs.
export function BookingStep({
  entry, transactions, patterns, merchants, categories, overrides,
  remaining, saving, failure, done, onSave, onSkip,
}) {
  const transaction = entry.transaction
  const { lines, segments, aligned } = useMemo(() => descriptionSegments(transaction), [transaction])
  const override = useMemo(
    () => overrides.find((o) => o.transaction_id === transaction.id) ?? null,
    [overrides, transaction]
  )

  const [anchor, setAnchor] = useState(null)
  const [range, setRange] = useState(null)
  const [merchantId, setMerchantId] = useState(null)
  const [merchantName, setMerchantName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [categorySlug, setCategorySlug] = useState(null)

  // Tapping a word starts a range; tapping a second one completes it. The
  // second tap may be to the left of the first — a range has no direction.
  // Tapping the only selected word again clears it, which is the way back out
  // of a selection without a separate button.
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
  const patternType = patternTypeFor(tokens)

  // The merchant name follows the marked words until the user types their own.
  // „ALDI.SUED/Esslingen.am" and „ALDI SUED" can both become patterns of one
  // „ALDI Süd" that way, because the name is a suggestion and never a key.
  useEffect(() => {
    if (!nameTouched && !merchantId) setMerchantName(visible)
  }, [visible, nameTouched, merchantId])

  const built = useMemo(() => {
    if (tokens.length === 0 || !categorySlug) return null
    return buildLearnRequest({
      transaction,
      selection: tokens,
      patternType,
      categorySlug,
      categories,
      merchantId,
      merchantName,
      transactions,
      patterns,
      overrides,
    })
  }, [transaction, tokens, patternType, categorySlug, categories, merchantId, merchantName,
      transactions, patterns, overrides])

  const numbers = built?.backtest
    ? backtestNumbers({ backtest: built.backtest, transaction, override })
    : null
  const blocking = built?.backtest ? blockingConflict({ backtest: built.backtest, merchants }) : null
  const warnings = built?.backtest && numbers
    ? patternWarnings({
        backtest: built.backtest, numbers, total: transactions.length, merchantId,
      })
    : []

  const chosenMerchantName =
    merchants.find((m) => m.id === merchantId)?.canonical_name ?? merchantName.trim()
  const chosenCategoryName = categoryLabelOf(categories, categorySlug)

  const head = bookingHeadline(transaction)
  const canSave = !!built?.valid && !blocking && !saving && !done

  if (done) {
    return <SavedStep done={done} remaining={remaining - 1} />
  }

  return (
    <div>
      <p className="text-caption text-text-muted">
        {remaining === 1 ? 'Letzte offene Buchung' : `Noch ${remaining} offene Buchungen`}
      </p>

      <section className="mt-2 rounded-card border border-subtle bg-bg-card px-4 py-4">
        <p className="text-page font-bold tabular-nums leading-tight text-text-primary">
          {head.amount}
        </p>
        <p className="mt-1 text-caption text-text-secondary">{head.date}</p>
        {entry.status === 'conflict' && (
          <p className="mt-3 text-ui text-text-secondary">
            Diese Buchung wird von zwei Händlern beansprucht. Ein genaueres Muster löst das auf.
          </p>
        )}
        {entry.status === 'review_required' && (
          <p className="mt-3 text-ui text-text-secondary">
            Dieser Händler wird jedes Mal geprüft — die Kategorie wird nie automatisch gesetzt.
          </p>
        )}
      </section>

      <p className="px-1 pb-2 pt-6 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
        Wörter markieren
      </p>
      <section className="rounded-card border border-subtle bg-bg-card px-4 py-4">
        <WordPicker lines={lines} range={range} onWord={onWord} />
        {!aligned && (
          <p className="mt-3 text-caption text-text-muted">
            Der gespeicherte Text dieser Buchung weicht vom angezeigten ab — eine Markierung kann
            hier abgelehnt werden.
          </p>
        )}
        {range && !rangeIsLearnable(segments, range) && (
          <p className="mt-3 text-caption text-text-muted" role="alert">
            Dieses Wort stammt aus einem Teil, den die importierte Datei nicht vollständig kodiert
            hat. Bitte einen anderen Teil markieren.
          </p>
        )}
      </section>

      {tokens.length > 0 && (
        <>
          <p className="px-1 pb-2 pt-6 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
            Händler
          </p>
          <MerchantPicker
            merchants={merchants}
            merchantId={merchantId}
            name={merchantName}
            onName={(value) => {
              setNameTouched(true)
              setMerchantName(value)
            }}
            onPick={(id) => {
              setMerchantId(id)
              setNameTouched(false)
              if (id === null) setMerchantName(visible)
            }}
          />

          <p className="px-1 pb-2 pt-6 text-meta font-semibold uppercase tracking-[0.08em] text-section-label">
            Kategorie
          </p>
          <CategoryPicker categories={categories} value={categorySlug} onPick={setCategorySlug} />
        </>
      )}

      {built && !built.valid && (
        <ul className="mt-6 space-y-2 rounded-card border border-subtle bg-bg-card px-4 py-3">
          {learnErrorLines(built.errors).map((line) => (
            <li key={line} className="text-ui text-text-secondary" role="alert">
              {line}
            </li>
          ))}
        </ul>
      )}

      {blocking && (
        <p className="mt-6 rounded-card border border-subtle bg-bg-card px-4 py-3 text-ui text-text-secondary" role="alert">
          {blocking}
        </p>
      )}

      {built?.valid && numbers && !blocking && (
        <section className="mt-6 rounded-card border border-subtle bg-bg-card px-4 py-4">
          <ul className="space-y-1">
            {confirmationLines({
              numbers,
              patternLabel: patternLabelOf(tokens),
              merchantName: chosenMerchantName,
              categoryName: chosenCategoryName,
            }).map((line) => (
              <li key={line} className="text-ui text-text-secondary">
                {line}
              </li>
            ))}
          </ul>
          {warnings.map((warning) => (
            <p key={warning.text} className="mt-3 text-caption text-text-muted">
              {warning.text}
            </p>
          ))}
        </section>
      )}

      {failure && (
        <p className="mt-6 text-ui text-text-primary" role="alert">
          {failure}
        </p>
      )}

      <button
        onClick={() => built?.request && onSave(built.request, {
          merchantName: chosenMerchantName, categoryName: chosenCategoryName,
        })}
        disabled={!canSave}
        aria-busy={saving}
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-40"
      >
        {saving ? 'Wird gespeichert …' : 'Zuordnung speichern'}
      </button>

      {/* „Später" changes nothing — not the booking, not a rule, not a row. It
          is the way past a booking like Scalable Capital that does not belong in
          a spending category at all, without forcing one on it. */}
      <button
        onClick={onSkip}
        disabled={saving}
        className="press-tint mt-3 w-full rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary disabled:opacity-40"
      >
        Später
      </button>
    </div>
  )
}

// ── The gesture ──────────────────────────────────────────────────────────────

// The booking text as words a finger can point at. Feedback on press, commit on
// release, and the whole word is the target — a chip is 44 px tall whatever the
// word is short enough to be.
function WordPicker({ lines, range, onWord }) {
  const selected = (index) => !!range && index >= range.from && index <= range.to
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="flex flex-wrap gap-x-1.5 gap-y-1.5">
          {line.map((segment) => (
            <button
              key={segment.index}
              onClick={() => onWord(segment)}
              disabled={!segment.learnable}
              aria-pressed={selected(segment.index)}
              // A word that cannot become a pattern is shown, not hidden: the
              // booking text has to stay readable. It is just not offered.
              title={segment.learnable ? undefined : 'Nicht vollständig lesbar — nicht lernbar'}
              // max-w-full + break-words: a bank prints words longer than a
              // phone is wide (measured at 390 px — one 78-character token ran
              // 180 px past the frame). The chip wraps inside itself rather
              // than pushing the screen sideways.
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

// ── Merchant ─────────────────────────────────────────────────────────────────

function MerchantPicker({ merchants, merchantId, name, onName, onPick }) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return merchants.slice(0, 6)
    return merchants.filter((m) => m.canonical_name.toLowerCase().includes(needle)).slice(0, 6)
  }, [merchants, query])

  const chosen = merchants.find((m) => m.id === merchantId) ?? null

  if (chosen) {
    return (
      <div className="rounded-card border border-subtle bg-bg-card px-4 py-4">
        <p className="text-body font-semibold text-text-primary">{chosen.canonical_name}</p>
        <p className="mt-1 text-caption text-text-secondary">
          Die Markierung wird ein weiteres Muster dieses Händlers.
        </p>
        <button
          onClick={() => onPick(null)}
          className="press-tint mt-3 min-h-[44px] w-full rounded-btn bg-bg-input py-3 text-ui font-semibold text-text-primary"
        >
          Anderen Händler wählen
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-subtle bg-bg-card px-4 py-4">
      <label className="block">
        <span className="mb-2 block text-label font-medium text-text-secondary">Name</span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Wie heißt dieser Händler?"
          className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
      </label>

      {merchants.length > 0 && (
        <>
          <label className="mt-4 block">
            <span className="mb-2 block text-label font-medium text-text-secondary">
              Oder einen bestehenden Händler wählen
            </span>
            <span className="flex items-center gap-2 rounded-input bg-bg-input px-4">
              <Search size={16} className="shrink-0 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Suchen"
                className="w-full bg-transparent py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none"
              />
            </span>
          </label>
          <div className="mt-2 space-y-1">
            {found.map((merchant) => (
              <button
                key={merchant.id}
                onClick={() => onPick(merchant.id)}
                className="press-tint flex min-h-[44px] w-full items-center rounded-chip px-3 py-2 text-left text-ui text-text-primary"
              >
                {merchant.canonical_name}
              </button>
            ))}
            {found.length === 0 && (
              <p className="px-3 py-2 text-caption text-text-muted">Kein Händler gefunden.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Category ─────────────────────────────────────────────────────────────────

// The rows the database holds, never a copy of the list in the UI: a category
// the user renames must read the way they renamed it.
function CategoryPicker({ categories, value, onPick }) {
  return (
    <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
      {categories.map((category, i) => (
        <button
          key={category.id ?? category.slug}
          onClick={() => onPick(category.slug)}
          aria-pressed={value === category.slug}
          className={`press-tint flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left ${
            i < categories.length - 1 ? 'border-b border-subtle' : ''
          }`}
        >
          <span className={`text-body ${value === category.slug ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
            {category.label}
          </span>
          {value === category.slug && <Check size={18} className="shrink-0 text-accent" />}
        </button>
      ))}
      {categories.length === 0 && (
        <p className="px-4 py-3 text-caption text-text-muted">
          Es wurden keine Kategorien geladen.
        </p>
      )}
    </div>
  )
}

// ── After ────────────────────────────────────────────────────────────────────

// Saved, and the queue has already moved on: the reload happened before this
// was rendered, so the number below is the real one, not a guess.
function SavedStep({ done, remaining }) {
  return (
    <div className="pt-2" aria-live="polite">
      <p className="text-section font-semibold text-text-primary">Gespeichert</p>
      <ul className="mt-3 space-y-1">
        {done.lines.map((line) => (
          <li key={line} className="text-ui text-text-secondary">
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-caption text-text-muted">
        {remaining > 0 ? 'Weiter mit der nächsten offenen Buchung …' : 'Keine offenen Buchungen mehr.'}
      </p>
    </div>
  )
}

function FinishedStep({ onClose }) {
  return (
    <div className="pt-2">
      <p className="text-section font-semibold text-text-primary">Alles zugeordnet</p>
      <p className="mt-2 text-ui text-text-secondary">
        Jede Buchung hat einen Händler und eine Kategorie.
      </p>
      <button
        onClick={onClose}
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
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
        className="press-tint mt-6 w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white"
      >
        Fertig
      </button>
      <button
        onClick={onAgain}
        className="press-tint mt-3 w-full rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary"
      >
        Noch einmal durchgehen
      </button>
    </div>
  )
}
