import { useEffect, useState } from 'react'
import { ChevronRight, Folder, X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import InlineCalendar from './InlineCalendar'
import { useUI } from '../context/UIContext'
import useRetained from '../lib/useRetained'
import { useTasks } from '../context/TasksContext'
import { useToast } from '../context/ToastContext'
import { CATEGORIES } from '../lib/taskSelectors'

const EMPTY = {
  title: '',
  category: 'Privat',
  details: '',
  due: { due_type: 'day', due_date: null },
  due_time: '',
}

// Neue Aufgabe / Aufgabe bearbeiten. A full-screen slide-up sheet (not a route)
// controlled by the UI context. Pre-fills when editing.
export default function TaskForm() {
  const { taskForm, closeTaskForm } = useUI()
  const { getTask, createTask, updateTask } = useTasks()
  const { showToast } = useToast()

  const open = !!taskForm
  // `taskForm` is cleared the moment the sheet is closed, so read the mode
  // from the retained value: otherwise "Aufgabe bearbeiten" would flip to
  // "Neue Aufgabe" while the sheet is still sliding off the screen.
  const editing = useRetained(taskForm)?.mode === 'edit'
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  // (Re)initialize whenever the sheet opens.
  useEffect(() => {
    if (!open) return
    if (editing) {
      const t = getTask(taskForm.taskId)
      if (t) {
        setForm({
          title: t.title || '',
          category: t.category || 'Privat',
          details: t.details || '',
          due: { due_type: t.due_type || 'day', due_date: t.due_date || null },
          due_time: t.due_time ? t.due_time.slice(0, 5) : '',
        })
        return
      }
    }
    setForm(EMPTY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskForm?.taskId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const canSave = form.title.trim().length > 0 && !saving

  // Time only applies to a specific day.
  const showTime = form.due.due_type === 'day' && !!form.due.due_date

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      category: form.category,
      details: form.details.trim() || null,
      due_date: form.due.due_date,
      due_type: form.due.due_date ? form.due.due_type : 'day',
      due_time: showTime && form.due_time ? form.due_time : null,
    }
    try {
      if (editing) await updateTask(taskForm.taskId, payload)
      else await createTask(payload)
      showToast('Aufgabe gespeichert ✓')
      closeTaskForm()
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
      className={`press-fade text-[15px] font-semibold ${
        canSave ? 'text-accent' : 'text-text-muted'
      }`}
    >
      {editing ? 'Speichern' : 'Erstellen'}
    </button>
  )

  return (
    <BottomSheet
      open={open}
      onClose={closeTaskForm}
      full
      title={editing ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      headerRight={saveBtn}
    >
      <div className="space-y-6 px-5 py-5 pb-10">
        {/* Title */}
        <input
          autoFocus={!editing}
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Titel der Aufgabe"
          className="w-full rounded-input bg-bg-input px-4 py-3.5 text-[16px] text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
        />

        {/* Category */}
        <Field label="Kategorie">
          <div className="flex gap-2 rounded-input bg-bg-input p-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => set({ category: cat })}
                className={`press-tint flex-1 rounded-chip py-2 text-[14px] font-medium transition-colors ${
                  form.category === cat
                    ? 'bg-accent text-white'
                    : 'text-text-secondary'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </Field>

        {/* Details */}
        <Field label="Details">
          <textarea
            value={form.details}
            onChange={(e) => set({ details: e.target.value })}
            placeholder="Details hinzufügen (optional)"
            className="min-h-[80px] w-full resize-none rounded-input bg-bg-input px-4 py-3 text-[15px] text-text-primary placeholder:text-text-muted outline-none ring-1 ring-transparent focus:ring-accent"
          />
        </Field>

        {/* Due date */}
        <Field label="Fällig">
          <InlineCalendar value={form.due} onChange={(due) => set({ due })} />
        </Field>

        {/* Time (only for a specific day) */}
        {showTime && (
          <Field label="Uhrzeit (optional)">
            <div className="flex items-center gap-3 rounded-input bg-bg-input px-4 py-3">
              <input
                type="time"
                value={form.due_time}
                onChange={(e) => set({ due_time: e.target.value })}
                className="flex-1 bg-transparent text-[15px] text-text-primary outline-none [color-scheme:dark]"
              />
              {form.due_time && (
                <button
                  onClick={() => set({ due_time: '' })}
                  aria-label="Uhrzeit entfernen"
                  className="press-fade text-text-muted"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </Field>
        )}

        {/* Project (coming soon) */}
        <Field label="Projekt (optional)">
          <div
            className="flex cursor-not-allowed items-center gap-3 rounded-input bg-bg-input px-4 py-3.5 opacity-60"
            title="Demnächst"
          >
            <Folder size={18} className="text-text-muted" />
            <span className="flex-1 text-[15px] text-text-secondary">Kein Projekt</span>
            <ChevronRight size={18} className="text-text-muted" />
          </div>
        </Field>
      </div>
    </BottomSheet>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-2 block text-[13px] font-semibold text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  )
}
