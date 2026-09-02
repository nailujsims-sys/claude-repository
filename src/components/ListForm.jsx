import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import BottomSheet from './BottomSheet'
import useRetained from '../lib/useRetained'
import { useUI } from '../context/UIContext'
import { useLists } from '../context/ListsContext'
import { useToast } from '../context/ToastContext'
import { LIST_TEMPLATES, listTemplate } from '../config/listTemplates'
import { LIST_ICONS } from '../config/listIcons'

const EMPTY = { name: '', template: 'standard', icon: 'clipboard-list' }

// Neue Liste / Liste bearbeiten. The same full-screen slide-up sheet the task
// form is — not a route, controlled by the UI context, pre-filled when editing —
// so it arrives, leaves and behaves identically, down to the ×, the title and
// the accent action in the header.
//
// Editing deliberately offers name and icon and nothing else: the template
// decides which columns an entry carries, so changing it on a list that already
// has entries would silently make some of their data unreachable. It is picked
// once, at creation, and a list that turned out to be the wrong kind is a new
// list.
export default function ListForm() {
  const { listForm, closeListForm } = useUI()
  const { getList, createList, updateList } = useLists()
  const { showToast } = useToast()

  const open = !!listForm
  // `listForm` is cleared the moment the sheet is closed, so the mode is read
  // from the retained value — otherwise "Liste bearbeiten" would flip to "Neue
  // Liste" while the sheet is still sliding off the screen.
  const editing = useRetained(listForm)?.mode === 'edit'
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      const list = getList(listForm.listId)
      if (list) {
        setForm({
          name: list.name || '',
          template: list.template || 'standard',
          icon: list.icon || 'clipboard-list',
        })
        return
      }
    }
    setForm(EMPTY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listForm?.listId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const canSave = form.name.trim().length > 0 && !saving

  // Picking a template also picks its icon — but only while the user has not
  // chosen one, so switching from Standard to Einkauf offers the trolley and
  // switching back offers the clipboard, while a deliberately picked star
  // survives both.
  const chooseTemplate = (id) => {
    const previousDefault = listTemplate(form.template).icon
    setForm((f) => ({
      ...f,
      template: id,
      icon: f.icon === previousDefault ? listTemplate(id).icon : f.icon,
    }))
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const payload = { name: form.name.trim(), icon: form.icon }
    try {
      if (editing) {
        await updateList(listForm.listId, payload)
      } else {
        await createList({ ...payload, template: form.template })
      }
      showToast('Liste gespeichert ✓')
      closeListForm()
    } catch {
      // Error surfaces via the global banner; keep the sheet open.
    } finally {
      setSaving(false)
    }
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
      onClose={closeListForm}
      full
      title={editing ? 'Liste bearbeiten' : 'Neue Liste'}
      headerRight={saveBtn}
    >
      <div className="space-y-6 px-5 py-5 pb-10">
        <Field label="Listenname">
          <input
            autoFocus={!editing}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Name der Liste"
            maxLength={120}
            className="w-full rounded-input bg-bg-input px-4 py-3.5 text-field text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
        </Field>

        {/* The template is a creation-time decision (see the comment above), so
            an edit shows what was chosen instead of offering to change it. */}
        {editing ? (
          <Field label="Vorlage">
            <div className="flex items-center gap-3 rounded-input bg-bg-input px-4 py-3.5">
              <span className="flex-1 text-body text-text-secondary">
                {listTemplate(form.template).label}
              </span>
              <span className="text-caption text-text-muted">nicht änderbar</span>
            </div>
          </Field>
        ) : (
          <Field label="Vorlage wählen">
            <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
              {LIST_TEMPLATES.map((tpl, i) => {
                const active = form.template === tpl.id
                return (
                  <button
                    key={tpl.id}
                    onClick={() => chooseTemplate(tpl.id)}
                    aria-pressed={active}
                    className={`press-tint flex w-full items-center gap-3 px-4 py-3.5 text-left ${
                      i < LIST_TEMPLATES.length - 1 ? 'border-b border-subtle' : ''
                    }`}
                  >
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-btn ${
                        active ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-secondary'
                      }`}
                    >
                      <TemplateIcon template={tpl} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-text-primary">
                        {tpl.label}
                      </span>
                      <span className="block truncate text-caption text-text-secondary">
                        {tpl.hint}
                      </span>
                    </span>
                    {/* Selection is carried by the check, not by a colour on the
                        row: one accent, and it marks the choice. */}
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                        active ? 'bg-accent text-white' : 'border-2 border-text-muted'
                      }`}
                    >
                      {active && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        <Field label="Icon wählen">
          {/* Six per row at 390px: a 40px target with the app's usual gap, so
              the whole curated set is four rows the eye takes in at once — no
              scrolling grid and no icon browser. */}
          <div className="grid grid-cols-6 gap-2">
            {LIST_ICONS.map((entry) => {
              const Icon = entry.icon
              const active = form.icon === entry.id
              return (
                <button
                  key={entry.id}
                  onClick={() => set({ icon: entry.id })}
                  aria-label={entry.label}
                  aria-pressed={active}
                  className={`press-tint grid aspect-square place-items-center rounded-btn border transition-colors ${
                    active
                      ? 'border-accent bg-accent-dim/40 text-accent'
                      : 'border-subtle bg-bg-input text-text-secondary'
                  }`}
                >
                  <Icon size={20} />
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </BottomSheet>
  )
}

function TemplateIcon({ template }) {
  const entry = LIST_ICONS.find((i) => i.id === template.icon)
  const Icon = entry?.icon
  return Icon ? <Icon size={18} /> : null
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
