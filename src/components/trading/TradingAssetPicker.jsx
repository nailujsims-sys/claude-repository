import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { normalizeAssetName, sortAssets } from '../../lib/trading'

// Which asset is this setup on?
//
// The pattern of FinanceAccountPicker, the app's existing "choose one, or make
// a new one right here": the choices as chips in one wrapping row, and
// "Neues Asset" directly under them. Creating one never leaves the form —
// the user is in the middle of capturing a setup — and the new asset is
// stored at once, so it is there for every later setup, and selected.
//
// Tapping the selected chip again clears it: the asset is optional.
export default function TradingAssetPicker({ assets = [], value = null, onChange, onCreate, disabled = false }) {
  const [creating, setCreating] = useState(false)
  const sorted = sortAssets(assets)

  return (
    <div>
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sorted.map((asset) => {
            const active = asset.id === value
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => onChange?.(active ? null : asset.id)}
                disabled={disabled}
                aria-pressed={active}
                className={`press-tint flex min-h-[44px] max-w-full items-center gap-2 rounded-chip px-3.5 py-2 text-ui transition-colors motion-reduce:transition-none ${
                  active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
                }`}
              >
                {active && <Check size={16} className="shrink-0" />}
                <span className="truncate">{asset.name}</span>
              </button>
            )
          })}
        </div>
      )}

      {creating || sorted.length === 0 ? (
        <NewAssetForm
          onCreate={onCreate}
          onCreated={(row) => {
            setCreating(false)
            onChange?.(row.id)
          }}
          onCancel={sorted.length === 0 ? null : () => setCreating(false)}
          disabled={disabled}
          autoFocus={sorted.length > 0}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={disabled}
          className="press-tint mt-2 flex min-h-[44px] items-center gap-1.5 rounded-btn px-1 text-ui text-text-secondary"
        >
          <Plus size={16} /> Neues Asset
        </button>
      )}
    </div>
  )
}

// One field and one button. Enter submits — the form around it is not a
// <form>, so Enter here can never save the whole setup by accident.
function NewAssetForm({ onCreate, onCreated, onCancel, disabled, autoFocus }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const clean = normalizeAssetName(name)
  const canSave = clean.length > 0 && clean.length <= 40 && !busy && !disabled

  const submit = async () => {
    if (!canSave) return
    setBusy(true)
    setFailed(false)
    try {
      onCreated(await onCreate(clean))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={onCancel ? 'mt-3' : ''}>
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape' && onCancel) {
              e.stopPropagation()
              onCancel()
            }
          }}
          placeholder="Neues Asset, z. B. NQ oder EURUSD"
          maxLength={40}
          aria-label="Neues Asset"
          className="min-w-0 flex-1 rounded-input bg-bg-input px-4 py-3 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          aria-busy={busy}
          className="press-tint shrink-0 rounded-btn bg-accent px-4 text-ui font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Anlegen …' : 'Anlegen'}
        </button>
      </div>
      {failed && (
        <p className="mt-2 px-1 text-caption text-danger" role="alert">
          Das Asset konnte nicht angelegt werden. Versuch es noch einmal.
        </p>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="press-tint mt-1 min-h-[44px] rounded-btn px-1 text-ui text-text-secondary"
        >
          Abbrechen
        </button>
      )}
    </div>
  )
}
