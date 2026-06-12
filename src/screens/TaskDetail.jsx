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
} from 'lucide-react'
import { useTasks } from '../context/TasksContext'
import { useUI } from '../context/UIContext'
import { useToast } from '../context/ToastContext'
import StarButton from '../components/StarButton'
import { formatDueLabel, formatLongDate, formatTime } from '../lib/date'

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getTask, loading, toggleFavorite, softDeleteTask } = useTasks()
  const { openTaskForm } = useUI()
  const { showToast } = useToast()

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const task = getTask(id)

  if (!task) {
    return (
      <div className="px-5 pt-5 pb-28">
        <button onClick={() => navigate('/aufgaben')} className="p-1 text-text-primary" aria-label="Zurück">
          <ArrowLeft size={24} />
        </button>
        <p className="mt-20 text-center text-[15px] text-text-secondary">
          {loading ? 'Lädt…' : 'Aufgabe nicht gefunden.'}
        </p>
      </div>
    )
  }

  const subtitle = [task.category, task.subcategory].filter(Boolean).join(' · ')

  const handleDelete = () => {
    softDeleteTask(task)
    setConfirmOpen(false)
    showToast('Aufgabe gelöscht')
    navigate('/aufgaben')
  }

  return (
    <div className="px-5 pt-5 pb-56">
      {/* Header */}
      <header className="flex items-center justify-between">
        <button onClick={() => navigate('/aufgaben')} aria-label="Zurück" className="-ml-1 p-1 text-text-primary">
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-2">
          <StarButton active={task.is_favorite} onToggle={() => toggleFavorite(task)} />
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Mehr"
              className="p-1 text-text-primary"
            >
              <MoreHorizontal size={24} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-card border border-subtle bg-bg-elevated py-1 shadow-xl shadow-black/50">
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      openTaskForm({ mode: 'edit', taskId: task.id })
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-text-primary hover:bg-white/5"
                  >
                    <Pen size={16} /> Bearbeiten
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setConfirmOpen(true)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-danger hover:bg-white/5"
                  >
                    <Trash2 size={16} /> Löschen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Title */}
      <div className="mt-4">
        <h1 className="text-[24px] font-bold leading-tight text-text-primary">{task.title}</h1>
        {subtitle && <p className="mt-1 text-[12px] text-text-secondary">{subtitle}</p>}
      </div>

      {/* Due / time / created */}
      <div className="mt-5 overflow-hidden rounded-card border border-subtle bg-bg-card">
        <InfoRow
          icon={CalendarDays}
          label="Fällig"
          value={formatDueLabel(task)}
          onClick={() => openTaskForm({ mode: 'edit', taskId: task.id })}
        />
        <InfoRow
          icon={Clock}
          label="Uhrzeit"
          value={task.due_time ? formatTime(task.due_time) : 'Keine Uhrzeit'}
          muted={!task.due_time}
          onClick={() => openTaskForm({ mode: 'edit', taskId: task.id })}
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

      {/* Bottom actions */}
      <div
        className="fixed inset-x-0 z-30 flex justify-center"
        style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
      >
        <div className="w-full max-w-app space-y-3 px-5 pb-3 pt-6 bg-gradient-to-t from-bg-base via-bg-base to-transparent">
          <button
            onClick={() => openTaskForm({ mode: 'edit', taskId: task.id })}
            className="flex w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-accent py-3.5 text-[15px] font-semibold text-accent"
          >
            <Pencil size={18} /> Bearbeiten
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-btn py-3.5 text-[15px] font-semibold text-danger"
            style={{ background: 'rgba(239, 68, 68, 0.12)' }}
          >
            <Trash2 size={18} /> Löschen
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleDelete}
        />
      )}
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

function ConfirmDialog({ onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center px-8">
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onCancel} />
      <div className="relative w-full max-w-[320px] animate-fade-in rounded-card border border-subtle bg-bg-elevated p-5">
        <h3 className="text-[17px] font-bold text-text-primary">Aufgabe löschen?</h3>
        <p className="mt-2 text-[14px] leading-snug text-text-secondary">
          Diese Aufgabe wird in den Papierkorb verschoben.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-btn border border-subtle py-2.5 text-[15px] font-semibold text-text-secondary"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-btn bg-danger py-2.5 text-[15px] font-semibold text-white"
          >
            Löschen
          </button>
        </div>
      </div>
    </div>
  )
}
