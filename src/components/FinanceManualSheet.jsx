import { useEffect, useMemo, useState } from 'react'
import BottomSheet from './BottomSheet'
import MiniCalendar from './MiniCalendar'
import Toggle from './Toggle'
import FinanceAccountPicker from './FinanceAccountPicker'
import { useFinance } from '../context/FinanceContext'
import { useUI } from '../context/UIContext'
import { useToast } from '../context/ToastContext'
import { formatLongDate, todayISO } from '../lib/date'
import { nextAccountId } from '../lib/finance/accounts'
import { failureLog } from '../lib/finance/importFlow'
import { buildManualTransactionPayload } from '../lib/finance/manualTransaction'

// „Buchung hinzufügen" — eine einzelne Ausgabe oder Einnahme, von Hand.
//
// Dasselbe Formular-Sheet wie Neue Aufgabe, Neuer Termin und Neue Ausgabe: ×
// links, Titel, die Aktion oben rechts im Akzent. Wer eine Ausgabe in der App
// eingetragen hat, hat das hier schon einmal gemacht.
//
// PFLICHT IST NUR, WAS OHNE ANTWORT KEINEN SINN ERGIBT: Konto, Betrag, Datum,
// Beschreibung. Händler, Kategorie und Notiz sind Angebote — ein Formular, das
// eine Kategorie erzwingt, bekommt am Ende überall „Sonstige" und hat niemandem
// geholfen.
//
// AUSGABE ODER EINNAHME statt eines Minuszeichens im Betragsfeld. Das Vorzeichen
// ist die einzige Stelle, an der eine vertippte Buchung hinterher still falsch
// ist — und zwar um das Doppelte. Also wird es gefragt statt getippt.
//
// WAS GESPEICHERT WIRD, entscheidet diese Datei nicht: das tut
// buildManualTransactionPayload (pur, geprüft) und danach die Datenbank, die
// Buchung und Entscheidung in einer Transaktion schreibt.
export default function FinanceManualSheet() {
  const { financeManual, closeFinanceManual } = useUI()
  return financeManual ? <Sheet onClose={closeFinanceManual} /> : null
}

const EMPTY = () => ({
  amount: '',
  direction: 'out',
  date: todayISO(),
  description: '',
  merchantId: null,
  categoryId: null,
  note: '',
  includeInAnalytics: true,
})

function Sheet({ onClose }) {
  // `activeAccounts` und nicht `accounts`: eine neue Buchung landet nie auf
  // einem archivierten Konto (§10). Die Historie bleibt davon unberührt — sie
  // wird hier nicht gelesen.
  const { activeAccounts, categories, merchants, createAccount, createManualTransaction } = useFinance()
  const { showToast } = useToast()

  const [form, setForm] = useState(EMPTY)
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState([])
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  // Genau ein Konto heißt: vorausgewählt, keine Frage. Kommt eines dazu, während
  // das Sheet offen ist (der Picker kann eins anlegen), bleibt die Wahl stehen.
  //
  // Fällt das gewählte Konto dagegen WEG — archiviert oder gelöscht, womöglich
  // auf einem anderen Gerät —, rückt das erste aktive nach (§4). Ohne das
  // stünde die Buchung auf einem Konto, das der Picker nicht mehr anzeigt.
  useEffect(() => {
    if (accountId === null) {
      if (activeAccounts.length === 1) setAccountId(activeAccounts[0].id)
      return
    }
    if (!activeAccounts.some((a) => a.id === accountId)) {
      setAccountId(nextAccountId(activeAccounts, null))
    }
  }, [activeAccounts, accountId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const account = activeAccounts.find((a) => a.id === accountId) ?? null
  const built = useMemo(
    () =>
      buildManualTransactionPayload({
        accountId,
        amountInput: form.amount,
        direction: form.direction,
        date: form.date,
        description: form.description,
        merchantId: form.merchantId,
        categoryId: form.categoryId,
        note: form.note,
        includeInAnalytics: form.includeInAnalytics,
        currency: account?.currency ?? 'EUR',
      }),
    [accountId, form, account]
  )

  const canSave = built.ok && !saving

  const handleSave = async () => {
    if (saving) return
    if (!built.ok) {
      setErrors(built.errors)
      return
    }
    setSaving(true)
    setErrors([])
    try {
      await createManualTransaction(built.payload)
      showToast('Buchung gespeichert ✓')
      onClose()
    } catch (err) {
      console.error(failureLog('buchung', err))
      setErrors(['Die Buchung konnte nicht gespeichert werden. Versuch es noch einmal.'])
    } finally {
      setSaving(false)
    }
  }

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={!canSave}
      className={`press-fade text-body font-semibold ${canSave ? 'text-accent' : 'text-text-muted'}`}
    >
      {saving ? 'Sichern …' : 'Sichern'}
    </button>
  )

  return (
    <BottomSheet open onClose={onClose} full title="Buchung hinzufügen" headerRight={saveBtn}>
      <div className="space-y-6 px-5 py-5 pb-10">
        <Field label="Konto">
          <FinanceAccountPicker
            accounts={activeAccounts}
            value={accountId}
            onChange={setAccountId}
            onCreate={createAccount}
            disabled={saving}
          />
        </Field>

        <Field label="Betrag">
          <DirectionSwitch value={form.direction} onChange={(direction) => set({ direction })} />
          <input
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            inputMode="decimal"
            placeholder="0,00"
            aria-label="Betrag"
            className="mt-2 w-full rounded-input bg-bg-input px-4 py-3.5 text-field tabular-nums text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
          <p className="mt-2 px-1 text-caption text-text-muted">
            {form.direction === 'in' ? 'Wird als Einnahme gebucht' : 'Wird als Ausgabe gebucht'}
            {account ? ` · ${account.currency}` : ''}
          </p>
        </Field>

        <Field label="Datum">
          <button
            type="button"
            onClick={() => setDatePickerOpen((o) => !o)}
            aria-expanded={datePickerOpen}
            className={`press-tint w-full rounded-input px-4 py-3.5 text-left text-field transition-colors motion-reduce:transition-none ${
              datePickerOpen ? 'bg-accent/15 text-accent' : 'bg-bg-input text-text-primary'
            }`}
          >
            {formatLongDate(form.date)}
          </button>
          {datePickerOpen && (
            <MiniCalendar
              value={form.date}
              onChange={(date) => {
                set({ date })
                setDatePickerOpen(false)
              }}
            />
          )}
        </Field>

        <Field label="Beschreibung">
          <input
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="z. B. REWE Troisdorf"
            maxLength={2000}
            aria-label="Beschreibung"
            className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
        </Field>

        {/* Nur, wenn es überhaupt Händler gibt. Ein leerer Auswahlblock wäre
            eine Frage ohne mögliche Antwort — angelegt werden Händler in der
            Zuordnung, zusammen mit dem Muster, an dem sie erkannt werden. */}
        {merchants.length > 0 && (
          <Field label="Händler" optional>
            <ChipSelect
              options={merchants.map((m) => ({ id: m.id, label: m.canonical_name }))}
              value={form.merchantId}
              onChange={(merchantId) => set({ merchantId })}
              emptyLabel="Kein Händler"
            />
          </Field>
        )}

        <Field label="Kategorie" optional>
          <ChipSelect
            options={categories.map((c) => ({ id: c.id, label: c.label }))}
            value={form.categoryId}
            onChange={(categoryId) => set({ categoryId })}
            emptyLabel="Keine"
          />
        </Field>

        <Field label="Notiz" optional>
          <textarea
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            rows={2}
            maxLength={2000}
            placeholder="Nur, wenn du später wissen willst, warum"
            aria-label="Notiz"
            className="w-full resize-none rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
        </Field>

        <div className="flex items-center gap-3 py-1">
          <span className="min-w-0 flex-1 text-body text-text-primary">
            In Auswertung berücksichtigen
          </span>
          <Toggle
            checked={form.includeInAnalytics}
            onChange={(includeInAnalytics) => set({ includeInAnalytics })}
            label="In Auswertung berücksichtigen"
          />
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1" role="alert">
            {errors.map((message) => (
              <li key={message} className="text-caption text-danger">
                {message}
              </li>
            ))}
          </ul>
        )}

        {/* Der zweite Weg zur selben Aktion, für alle, die unten ankommen statt
            oben rechts zu greifen — dieselbe Funktion, nicht eine zweite. */}
        <button
          onClick={handleSave}
          disabled={!canSave}
          aria-busy={saving}
          className="press-tint w-full rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Wird gespeichert …' : 'Buchung sichern'}
        </button>
      </div>
    </BottomSheet>
  )
}

// Ausgabe / Einnahme. Zwei Felder, gleich groß, immer beide sichtbar — was hier
// gilt, muss man sehen können, ohne es aufzuklappen.
function DirectionSwitch({ value, onChange }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Ausgabe oder Einnahme">
      {[
        { id: 'out', label: 'Ausgabe' },
        { id: 'in', label: 'Einnahme' },
      ].map((option) => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            className={`press-tint min-h-[44px] flex-1 rounded-chip text-ui font-medium transition-colors motion-reduce:transition-none ${
              active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// Eine Auswahl aus wenigen Werten, plus „keiner". Chips statt eines Menüs, weil
// die Optionen sichtbar sein sollen und weil ein Tap reicht.
export function ChipSelect({ options = [], value = null, onChange, emptyLabel = 'Keine' }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip active={value === null} onClick={() => onChange(null)}>
        {emptyLabel}
      </Chip>
      {options.map((option) => (
        <Chip
          key={option.id}
          active={value === option.id}
          onClick={() => onChange(value === option.id ? null : option.id)}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press-tint flex min-h-[44px] max-w-full items-center rounded-chip px-3.5 py-2 text-ui transition-colors motion-reduce:transition-none ${
        active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
      }`}
    >
      <span className="truncate">{children}</span>
    </button>
  )
}

function Field({ label, optional = false, children }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-label font-semibold text-text-secondary">{label}</label>
        {optional && <span className="text-caption text-text-muted">optional</span>}
      </div>
      {children}
    </div>
  )
}
