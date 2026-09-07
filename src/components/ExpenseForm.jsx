import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import BottomSheet from './BottomSheet'
import CurrencySwitch from './CurrencySwitch'
import MiniCalendar from './MiniCalendar'
import useRetained from '../lib/useRetained'
import { useUI } from '../context/UIContext'
import { useExpenses } from '../context/ExpensesContext'
import { useToast } from '../context/ToastContext'
import { formatLongDate, todayISO } from '../lib/date'
import { numberToInput, parseNumber } from '../lib/listParsing'
import { isPlausibleRate } from '../lib/exchangeRate'
import {
  DEFAULT_CURRENCY,
  convertAmount,
  formatMoney,
  formatRate,
  rateSourceLabel,
} from '../lib/expenses'

// Neue Ausgabe / Ausgabe bearbeiten. The same full-screen slide-up sheet the
// task, event and list forms are — not a route, controlled by the UI context,
// pre-filled when editing — so it arrives, leaves and behaves identically, down
// to the ×, the title and the accent action in the header.
//
// The whole point of the module is that this takes seconds: the title is
// focused on open, the date is already today, the currency is already the one
// most things are paid in, and "Erstellen" is one reach away in the header.
// Everything else on the sheet is a correction, not a step.
//
// German decimals are read by `parseNumber` from the Listen module rather than
// re-implemented here — "25,00", "25.00" and "1.250,50" already mean the right
// thing everywhere else in the app, and a second parser is how they stop
// agreeing.
const EMPTY = () => ({
  title: '',
  amount: '',
  currency: DEFAULT_CURRENCY,
  // The brief's "Transaktionsdatum automatisch auf das aktuelle Datum setzen".
  // Changing it afterwards is the date row below, in both create and edit.
  date: todayISO(),
  // The rate this expense is already booked at. Null while creating — a new
  // expense gets the current one at the moment it is saved.
  rate: null,
})

export default function ExpenseForm() {
  const { expenseForm, closeExpenseForm } = useUI()
  const {
    getExpense,
    createExpense,
    updateExpense,
    deleteExpense,
    ensureRate,
    rate,
    rateSource,
  } = useExpenses()
  const { showToast } = useToast()

  const open = !!expenseForm
  // `expenseForm` is cleared the moment the sheet is closed, so the mode is read
  // from the retained value — otherwise "Ausgabe bearbeiten" would flip to
  // "Neue Ausgabe" while the sheet is still sliding off the screen.
  const retained = useRetained(expenseForm)
  const editing = retained?.mode === 'edit'

  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setDatePickerOpen(false)
    // Opening the sheet is one of the two moments the brief asks for a current
    // rate (the other is saving). Failing is not an error here — the fallback
    // chain carries on and the line at the foot says which rate is being used.
    ensureRate()
    if (expenseForm?.mode === 'edit') {
      const expense = getExpense(expenseForm.expenseId)
      if (expense) {
        setForm({
          title: expense.title || '',
          amount: numberToInput(expense.original_amount),
          currency: expense.original_currency || DEFAULT_CURRENCY,
          date: expense.transaction_date || todayISO(),
          rate: Number(expense.exchange_rate_aud_eur),
        })
        return
      }
    }
    setForm(EMPTY())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expenseForm?.expenseId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const amount = parseNumber(form.amount)
  // The database refuses a zero or negative amount, so the button does too —
  // and it does it by staying inactive rather than by letting the user press it
  // into an error (§18).
  const canSave = form.title.trim().length > 0 && amount !== null && amount > 0 && !saving

  // WHICH RATE THIS SHEET SPEAKS
  // Creating: the current one, because that is what the new row will be stamped
  // with. Editing: the rate the expense is already booked at — an edit does not
  // re-price it, so the sheet has to show the same number the row in the
  // overview does. Anything else would tell the user their 45 AUD are worth
  // 27,00 € on one screen and 22,50 € on the next.
  const activeRate = editing && isPlausibleRate(form.rate) ? form.rate : rate
  const activeRateLabel = editing ? 'Kurs dieser Ausgabe' : rateSourceLabel(rateSource)

  // The other currency, live, while the amount is typed. The rate is a number
  // most people do not carry in their head, and this is the cheapest possible
  // way to answer "what did that actually cost me" — one quiet line, no extra
  // step and nothing to press.
  const other = form.currency === 'AUD' ? 'EUR' : 'AUD'
  const preview =
    amount === null || amount <= 0
      ? null
      : convertAmount(amount, form.currency, other, activeRate)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      original_amount: amount,
      original_currency: form.currency,
      transaction_date: form.date,
    }
    try {
      if (editing) {
        // No rate in the patch: an edit corrects an expense, it does not
        // re-price it (see ExpensesContext → updateExpense).
        await updateExpense(expenseForm.expenseId, payload)
      } else {
        // `createExpense` refreshes the rate first and stamps the row with it.
        await createExpense(payload)
      }
      showToast('Ausgabe gespeichert ✓')
      closeExpenseForm()
    } catch {
      // Error surfaces via the global banner; keep the sheet open.
    } finally {
      setSaving(false)
    }
  }

  // Deleting commits on the press and the toast carries the way back for the
  // next few seconds — the pattern G8 established for a task and Listen reuses
  // for an entry. An expense is one line; a "Bist du sicher?" would cost more
  // than the mistake.
  const handleDelete = async () => {
    const expense = getExpense(expenseForm?.expenseId)
    if (!expense) return
    closeExpenseForm()
    deleteExpense(expense).catch(() => {})
    showToast('Ausgabe gelöscht', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        createExpense({
          title: expense.title,
          original_amount: expense.original_amount,
          original_currency: expense.original_currency,
          transaction_date: expense.transaction_date,
          // The restored expense keeps the rate it was booked at — it is the
          // same expense coming back, not a new one at today's rate.
          exchange_rate_aud_eur: expense.exchange_rate_aud_eur,
        }).catch(() => {})
      },
    })
  }

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={!canSave}
      className={`press-fade text-body font-semibold ${
        canSave ? 'text-accent' : 'text-text-muted'
      }`}
    >
      {editing ? 'Speichern' : 'Erstellen'}
    </button>
  )

  return (
    <BottomSheet
      open={open}
      onClose={closeExpenseForm}
      full
      title={editing ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'}
      headerRight={saveBtn}
    >
      <div className="space-y-6 px-5 py-5 pb-10">
        <Field label="Beschreibung">
          <input
            autoFocus={!editing}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="z. B. Kaffee, Miete, Zug nach Sydney"
            maxLength={200}
            aria-label="Beschreibung"
            className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
        </Field>

        {/* Amount and currency are one decision, so they are one block: the
            switch sits on the label row, where it is reachable without leaving
            the number, and the conversion answers underneath. */}
        <Field
          label="Betrag"
          trailing={
            <CurrencySwitch
              value={form.currency}
              onChange={(currency) => set({ currency })}
              label="Eingabewährung"
            />
          }
        >
          <input
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            inputMode="decimal"
            placeholder="0,00"
            aria-label="Betrag"
            className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field tabular-nums text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
          {preview !== null && (
            <p className="mt-2 px-1 text-caption text-text-secondary">
              entspricht{' '}
              <span className="font-semibold tabular-nums text-text-primary">
                {formatMoney(preview, other)}
              </span>
            </p>
          )}
        </Field>

        {/* The date row the event form uses, with the same MiniCalendar under
            it — one date, plain 'YYYY-MM-DD', no week/month granularity. */}
        <Field label="Datum">
          <button
            type="button"
            onClick={() => setDatePickerOpen((o) => !o)}
            aria-expanded={datePickerOpen}
            className={`press-tint w-full rounded-input px-4 py-3.5 text-left text-field transition-colors ${
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

        {/* The rate this expense will be stamped with — the quiet line the
            brief asks for, in the place where it is actually being applied. */}
        <p className="px-1 text-caption text-text-muted" data-rate-line="">
          {formatRate(activeRate)} · {activeRateLabel}
        </p>

        {editing && (
          <button
            onClick={handleDelete}
            className="press-tint flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-body font-semibold text-danger"
            style={{ background: 'rgba(239, 68, 68, 0.12)' }}
          >
            <Trash2 size={18} /> Ausgabe löschen
          </button>
        )}
      </div>
    </BottomSheet>
  )
}

// The form field of the task, event and list sheets, with one addition: a
// `trailing` slot on the label row, so a control that belongs to the field
// (here: the currency) sits with its label instead of below its input.
function Field({ label, trailing = null, children }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-label font-semibold text-text-secondary">{label}</label>
        {trailing}
      </div>
      {children}
    </div>
  )
}
