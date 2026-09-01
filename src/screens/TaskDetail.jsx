import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  MoreHorizontal,
  CalendarDays,
  Clock,
  ClipboardList,
  Folder,
  ChevronRight,
  Pencil,
  Trash2,
  Pen,
  RotateCcw,
} from 'lucide-react'
import { useTasks } from '../context/TasksContext'
import { useUI } from '../context/UIContext'
import { useToast } from '../context/ToastContext'
import IconButton from '../components/IconButton'
import StarButton from '../components/StarButton'
import { formatDueLabel, formatLongDate, formatTime } from '../lib/date'

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getTask, loading, toggleFavorite, softDeleteTask, restoreTask } = useTasks()
  const { openTaskForm } = useUI()
  const { showToast } = useToast()

  const [menuOpen, setMenuOpen] = useState(false)

  const task = getTask(id)

  if (!task) {
    return (
      <div className="px-5 pt-5 pb-28">
        <IconButton onClick={() => navigate('/aufgaben')} className="-ml-1 text-text-primary" aria-label="Zurück">
          <ArrowLeft size={24} />
        </IconButton>
        <p className="mt-20 text-center text-[15px] text-text-secondary">
          {loading ? 'Lädt…' : 'Aufgabe nicht gefunden.'}
        </p>
      </div>
    )
  }

  const subtitle = [task.category, task.subcategory].filter(Boolean).join(' · ')

  // A task in the Papierkorb is a different screen state, not a different
  // screen (G17). It shows the same information, styled the way the list
  // already styles a deleted row, and offers the one action that makes sense
  // there: getting it back. Editing stays behind that — a task is restored
  // first and changed afterwards — so the rows below stop opening the form
  // and the "Löschen" that used to sit here, offering to delete something
  // already deleted, is gone.
  const deleted = !!task.is_deleted

  // Deleting a task is reversible — it moves to the Papierkorb — so it commits
  // on press instead of asking "Bist du sicher?" first, and the toast carries
  // the way back for the next five seconds (§18/§19, G8). ConfirmDialog stays
  // for what genuinely cannot be taken back, such as deleting a Termin.
  //
  // The undo outlives this screen: it closes over the task and over the two
  // context callbacks, all of which belong to providers mounted above the
  // router, so it still works after the navigation below has unmounted us.
  // Failures surface through the global banner, as everywhere else.
  const handleDelete = () => {
    setMenuOpen(false)
    softDeleteTask(task).catch(() => {})
    showToast('Aufgabe gelöscht', {
      actionLabel: 'Rückgängig',
      onAction: () => {
        restoreTask(task).catch(() => {})
        showToast('Aufgabe wiederhergestellt')
      },
    })
    navigate('/aufgaben')
  }

  // The inverse, and the same one the undo toast runs (G8's `restoreTask`), so
  // the task keeps every property including `sort_order`. Unlike the delete
  // this does not navigate: the task is active again and this screen is the
  // ordinary detail view of an active task, so it simply re-renders with
  // "Bearbeiten" and "Löschen" back. The toast confirms it in the wording G8
  // already established for exactly this operation.
  const handleRestore = () => {
    setMenuOpen(false)
    restoreTask(task).catch(() => {})
    showToast('Aufgabe wiederhergestellt')
  }

  return (
    <div className="px-5 pt-5 pb-56">
      {/* Header */}
      <header className="flex items-center justify-between">
        <IconButton onClick={() => navigate('/aufgaben')} aria-label="Zurück" className="-ml-1 text-text-primary">
          <ArrowLeft size={24} />
        </IconButton>
        <div className="flex items-center gap-2">
          <StarButton active={task.is_favorite} onToggle={() => toggleFavorite(task)} />
          <div className="relative">
            <IconButton
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Mehr"
              className="text-text-primary"
            >
              <MoreHorizontal size={24} />
            </IconButton>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-card border border-subtle bg-bg-elevated py-1 shadow-xl shadow-black/50">
                  {deleted ? (
                    <button
                      onClick={handleRestore}
                      className="press-tint flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-text-primary"
                    >
                      <RotateCcw size={16} /> Wiederherstellen
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setMenuOpen(false)
                          openTaskForm({ mode: 'edit', taskId: task.id })
                        }}
                        className="press-tint flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-text-primary"
                      >
                        <Pen size={16} /> Bearbeiten
                      </button>
                      <button
                        onClick={handleDelete}
                        className="press-tint flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-danger"
                      >
                        <Trash2 size={16} /> Löschen
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Title */}
      <div className="mt-4">
        <h1
          className={`text-[24px] font-bold leading-tight ${
            deleted ? 'text-text-muted line-through' : 'text-text-primary'
          }`}
        >
          {task.title}
        </h1>
        {subtitle && <p className="mt-1 text-[12px] text-text-secondary">{subtitle}</p>}
        {/* Why this screen looks and behaves differently (§21). Same muted
            12px line the subtitle uses — no new component, no banner. */}
        {deleted && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-text-muted">
            <Trash2 size={13} />
            {task.deleted_at
              ? `Gelöscht am ${formatLongDate(new Date(task.deleted_at))}`
              : 'Im Papierkorb'}
          </p>
        )}
      </div>

      {/* Due / time / created */}
      <div className="mt-5 overflow-hidden rounded-card border border-subtle bg-bg-card">
        <InfoRow
          icon={CalendarDays}
          label="Fällig"
          value={formatDueLabel(task)}
          onClick={deleted ? undefined : () => openTaskForm({ mode: 'edit', taskId: task.id })}
        />
        <InfoRow
          icon={Clock}
          label="Uhrzeit"
          value={task.due_time ? formatTime(task.due_time) : 'Keine Uhrzeit'}
          muted={!task.due_time}
          onClick={deleted ? undefined : () => openTaskForm({ mode: 'edit', taskId: task.id })}
          border={false}
        />
      </div>

      <div className="mt-3 overflow-hidden rounded-card border border-subtle bg-bg-card">
        <InfoRow
          icon={ClipboardList}
          label="Erstellt am"
          value={formatLongDate(new Date(task.created_at))}
          chevron={false}
          border={false}
        />
      </div>

      {/* Details */}
      <section className="mt-6">
        <h2 className="mb-2 text-[18px] font-bold text-text-primary">Details</h2>
        {task.details ? (
          <p className="whitespace-pre-wrap rounded-card border border-subtle bg-bg-card p-4 text-[15px] leading-relaxed text-text-secondary">
            {task.details}
          </p>
        ) : (
          <p className="text-[15px] text-text-muted">Keine Details</p>
        )}
      </section>

      {/* Project (coming soon) */}
      <section className="mt-6">
        <h2 className="mb-2 text-[18px] font-bold text-text-primary">Projekt</h2>
        <div className="flex items-center gap-3 rounded-card border border-subtle bg-bg-card px-4 py-3.5 opacity-60">
          <Folder size={18} className="text-text-muted" />
          <span className="flex-1 text-[15px] text-text-secondary">Kein Projekt</span>
          <ChevronRight size={18} className="text-text-muted" />
        </div>
      </section>

      {/* Bottom actions. Fixed like BottomNav and stacked directly on top of
          it, so it carries the same `--browser-bottom-inset` and the two keep
          their spacing whether or not a browser bar overlaps the page. */}
      <div
        className="fixed inset-x-0 z-30 flex justify-center"
        style={{
          bottom:
            'calc(72px + env(safe-area-inset-bottom) + var(--browser-bottom-inset))',
        }}
      >
        <div className="w-full max-w-app space-y-3 px-5 pb-3 pt-6 bg-gradient-to-t from-bg-base via-bg-base to-transparent">
          {deleted ? (
            /* One action, in the bar's existing constructive style — the same
               accent outline "Bearbeiten" uses. A restore is not destructive,
               so it must not wear the danger tint; and it is the only thing
               worth doing to a task in the Papierkorb, so nothing sits next
               to it competing for the press. */
            <button
              onClick={handleRestore}
              className="press-tint flex w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-accent py-3.5 text-[15px] font-semibold text-accent"
            >
              <RotateCcw size={18} /> Wiederherstellen
            </button>
          ) : (
            <>
              <button
                onClick={() => openTaskForm({ mode: 'edit', taskId: task.id })}
                className="press-tint flex w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-accent py-3.5 text-[15px] font-semibold text-accent"
              >
                <Pencil size={18} /> Bearbeiten
              </button>
              <button
                onClick={handleDelete}
                className="press-tint flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-[15px] font-semibold text-danger"
                style={{ background: 'rgba(239, 68, 68, 0.12)' }}
              >
                <Trash2 size={18} /> Löschen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value, onClick, muted, chevron = true, border = true }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-4 text-left ${
        border ? 'border-b border-subtle' : ''
      }`}
    >
      <Icon size={18} className="text-text-secondary" />
      <span className="text-[15px] text-text-primary">{label}</span>
      <span className={`ml-auto text-[15px] ${muted ? 'text-text-muted' : 'text-text-secondary'}`}>
        {value}
      </span>
      {chevron && onClick && <ChevronRight size={18} className="text-text-muted" />}
    </Wrapper>
  )
}
