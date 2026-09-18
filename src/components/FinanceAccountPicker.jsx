import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { DEFAULT_FINANCE_CURRENCY, isCurrencyCode } from '../config/finance'

// Zu welchem Konto gehört das hier?
//
// Die Antwort ist fast immer „zu dem einen, das es gibt" — und dann ist die
// Frage keine. Deshalb wächst dieses Stück mit dem, was tatsächlich da ist:
//
//   kein Konto   → das kleine Formular direkt, ohne Umweg über eine leere Liste
//   ein Konto    → eine ruhige Zeile, die sagt, wohin es geht. Keine Auswahl,
//                  weil es nichts zu wählen gibt
//   mehrere      → Chips, eine Reihe, alles mit dem Daumen erreichbar
//
// „Neues Konto" ist überall erreichbar, ohne den Flow zu verlassen: der Nutzer
// steht mitten in einer Buchung, und ihn dafür auf einen anderen Screen zu
// schicken hieße, die Buchung wegzuwerfen.
//
// Die Komponente entscheidet nichts über das Konto selbst — sie meldet, was
// gewählt wurde, und legt auf Wunsch eins an. Wer sie benutzt, hält die Auswahl.
export default function FinanceAccountPicker({
  accounts = [],
  value = null,
  onChange,
  onCreate,
  disabled = false,
}) {
  const [creating, setCreating] = useState(false)

  const openCreate = () => setCreating(true)
  const handleCreated = (row) => {
    setCreating(false)
    onChange?.(row.id)
  }

  if (accounts.length === 0 || creating) {
    return (
      <NewAccountForm
        onCreate={onCreate}
        onCreated={handleCreated}
        onCancel={accounts.length === 0 ? null : () => setCreating(false)}
        disabled={disabled}
      />
    )
  }

  if (accounts.length === 1) {
    const only = accounts[0]
    return (
      <div>
        <div className="flex min-h-[44px] items-center gap-3 rounded-input bg-bg-input px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-field text-text-primary">{only.name}</span>
          <span className="shrink-0 text-caption text-text-muted">{only.currency}</span>
        </div>
        <NewAccountButton onClick={openCreate} disabled={disabled} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => {
          const active = account.id === value
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onChange?.(account.id)}
              disabled={disabled}
              aria-pressed={active}
              className={`press-tint flex min-h-[44px] max-w-full items-center gap-2 rounded-chip px-3.5 py-2 text-ui transition-colors motion-reduce:transition-none ${
                active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
              }`}
            >
              {active && <Check size={16} className="shrink-0" />}
              <span className="truncate">{account.name}</span>
            </button>
          )
        })}
      </div>
      <NewAccountButton onClick={openCreate} disabled={disabled} />
    </div>
  )
}

function NewAccountButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="press-tint mt-2 flex min-h-[44px] items-center gap-1.5 rounded-btn px-1 text-ui text-text-secondary"
    >
      <Plus size={16} /> Neues Konto
    </button>
  )
}

// Das Minimum, das ein Konto ausmacht: ein Name. Anbieter und Währung sind
// vorbelegt bzw. optional, damit hier niemand hängen bleibt, der eigentlich
// gerade eine Buchung eintragen wollte.
function NewAccountForm({ onCreate, onCreated, onCancel, disabled }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_FINANCE_CURRENCY)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const code = currency.trim().toUpperCase()
  const canSave = name.trim() !== '' && isCurrencyCode(code) && !busy && !disabled

  const submit = async () => {
    if (!canSave) return
    setBusy(true)
    setFailed(false)
    try {
      const row = await onCreate({ name: name.trim(), provider: provider.trim() || null, currency: code })
      onCreated(row)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border border-subtle bg-bg-card px-4 py-4">
      <p className="text-label font-semibold text-text-secondary">Neues Konto</p>

      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, z. B. Girokonto"
        maxLength={120}
        aria-label="Name des Kontos"
        className="mt-3 w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
      />

      <div className="mt-3 flex gap-2">
        <input
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="Bank (optional)"
          maxLength={80}
          aria-label="Bank oder Anbieter"
          className="min-w-0 flex-1 rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
        <input
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
          aria-label="Währung"
          className="w-[84px] shrink-0 rounded-input bg-bg-input px-3 py-3.5 text-center text-field tabular-nums text-text-primary outline-none ring-1 ring-transparent focus:ring-accent"
        />
      </div>

      {failed && (
        <p className="mt-3 text-caption text-danger" role="alert">
          Das Konto konnte nicht angelegt werden. Versuch es noch einmal.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="press-tint flex-1 rounded-btn bg-bg-input py-3.5 text-body font-semibold text-text-primary"
          >
            Abbrechen
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          aria-busy={busy}
          className="press-tint flex-1 rounded-btn bg-accent py-3.5 text-body font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Wird angelegt …' : 'Anlegen'}
        </button>
      </div>
    </div>
  )
}
