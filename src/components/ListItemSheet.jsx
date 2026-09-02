import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import BottomSheet from './BottomSheet'
import useRetained from '../lib/useRetained'
import { listTemplate, SHOPPING_CATEGORIES } from '../config/listTemplates'
import { numberToInput, parseNumber } from '../lib/listParsing'

// Editing one entry: the auto-height sheet the app already uses for its short
// panels, with the grabber, the drag-to-dismiss and everything else that comes
// with it. It is the "intuitiv erreichbar" half of the fast path — the add field
// takes a whole entry in one line, and this is where a quantity is corrected, a
// category set, or the entry deleted.
//
// Which fields it shows follows from the template's `fields` (src/config/listTemplates.js),
// never from an `if` on the template's id.
export default function ListItemSheet({ item, template, onClose, onReopen, onSave, onDelete }) {
  const open = !!item
  // The entry is cleared the moment the sheet closes, so the exit keeps showing
  // what the user was looking at rather than emptying out on the way down.
  const shown = useRetained(item)
  const fields = listTemplate(template).fields

  const [form, setForm] = useState({ title: '', quantity: '', unit: '', amount: '', category: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({
      title: item.title || '',
      quantity: numberToInput(item.quantity),
      unit: item.unit || '',
      amount: numberToInput(item.amount),
      category: item.category || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const canSave = form.title.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave || !shown) return
    setSaving(true)
    const patch = { title: form.title.trim() }
    if (fields.includes('quantity')) {
      patch.quantity = parseNumber(form.quantity)
      patch.unit = form.unit.trim() || null
    }
    if (fields.includes('amount')) patch.amount = parseNumber(form.amount)
    if (fields.includes('category')) patch.category = form.category || null
    try {
      await onSave?.(shown, patch)
      onClose?.()
    } catch {
      // Error surfaces via the global banner; keep the sheet open.
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} onReopen={onReopen} title="Eintrag bearbeiten">
      <div className="space-y-5 px-5 pb-8">
        <Field label={fields.includes('amount') ? 'Person' : 'Bezeichnung'}>
          <input
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            maxLength={200}
            className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
        </Field>

        {fields.includes('quantity') && (
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Menge (optional)">
                <input
                  value={form.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                  inputMode="decimal"
                  placeholder="z. B. 6"
                  className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Einheit (optional)">
                <input
                  value={form.unit}
                  onChange={(e) => set({ unit: e.target.value })}
                  maxLength={20}
                  placeholder="z. B. Stück"
                  className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
                />
              </Field>
            </div>
          </div>
        )}

        {fields.includes('amount') && (
          <Field label="Betrag (optional)">
            <div className="flex items-center gap-2 rounded-input bg-bg-input px-4 py-3.5 ring-1 ring-transparent focus-within:ring-accent">
              <input
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
                inputMode="decimal"
                placeholder="z. B. 25,00"
                className="min-w-0 flex-1 bg-transparent text-field text-text-primary placeholder:text-text-muted outline-none"
              />
              <span className="shrink-0 text-body text-text-secondary">€</span>
            </div>
          </Field>
        )}

        {fields.includes('category') && (
          <Field label="Kategorie (optional)">
            {/* Chips, and tapping the selected one clears it: a category is
                something the user sets and unsets, never something the app
                works out. Free text is deliberately not offered — nine
                categories keep the grouping readable, and an entry without one
                is a perfectly good entry. */}
            <div className="flex flex-wrap gap-2">
              {SHOPPING_CATEGORIES.map((cat) => {
                const active = form.category === cat
                return (
                  <button
                    key={cat}
                    onClick={() => set({ category: active ? '' : cat })}
                    aria-pressed={active}
                    className={`press-tint rounded-chip px-3 py-1.5 text-ui font-medium transition-colors ${
                      active ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        {/* The actions go at the foot of the sheet, in the shape the app's other
            auto-height sheet already uses: the accent primary first, and the
            destructive one below rather than beside it, so a mis-aimed press
            cannot hit "löschen" while going for "speichern".

            Deleting commits on the press and the screen's toast carries the way
            back for the next five seconds (§18/§19, G8) — no "Bist du sicher?"
            for a checklist line. */}
        <div className="space-y-3 pt-1">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`press-tint w-full rounded-btn py-3.5 text-body font-semibold transition-colors ${
              canSave ? 'bg-accent text-white' : 'bg-bg-input text-text-muted'
            }`}
          >
            Speichern
          </button>
          <button
            onClick={() => shown && onDelete?.(shown)}
            className="press-tint flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-body font-semibold text-danger"
            style={{ background: 'rgba(239, 68, 68, 0.12)' }}
          >
            <Trash2 size={18} /> Eintrag löschen
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-2 block text-label font-semibold text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  )
}
