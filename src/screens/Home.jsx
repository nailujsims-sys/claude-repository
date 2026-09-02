import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, User, Sparkles, ArrowRight, Quote, Globe } from 'lucide-react'
import IconButton from '../components/IconButton'
import TopBar from '../components/TopBar'
import { useAuth } from '../context/AuthContext'
import { useTasks } from '../context/TasksContext'
import { homePreview, openTodayCount } from '../lib/taskSelectors'
import { formatTime, isToday } from '../lib/date'

function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Guten Morgen'
  if (h >= 12 && h < 18) return 'Guten Tag'
  if (h >= 18 && h < 22) return 'Guten Abend'
  return 'Gute Nacht'
}

// Static schedule preview (placeholder per spec — no functionality).
const SCHEDULE = [
  { time: '09:00', title: 'Vorlesung Finanzierung', sub: 'Raum A213 · Prof. Müller' },
  { time: '14:00', title: 'Gruppenarbeit Projekt', sub: 'Bibliothek' },
  { time: '18:00', title: 'Sport', sub: 'Gym' },
]

export default function Home() {
  const { displayName } = useAuth()
  const { tasks, loading } = useTasks()
  const navigate = useNavigate()
  const [scope, setScope] = useState('today')

  const preview = homePreview(tasks, scope).slice(0, 4)
  const openCount = openTodayCount(tasks)

  return (
    <>
      {/* The global bar — same component, same geometry as every other main
          area (src/components/TopBar.jsx). The greeting below is page content
          and stays exactly as it was. */}
      <TopBar
        title="Heute"
        actions={
          <>
            <IconButton aria-label="Benachrichtigungen" className="relative text-text-primary">
              <Bell size={22} />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
            </IconButton>
            {/* Not a control (no profile screen yet), but it occupies the same
                36×36 slot as an action so the rail stays on its pixel. */}
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-elevated text-text-secondary">
              <User size={20} />
            </div>
          </>
        }
      />

      <div className="px-5 pb-28">
        {/* Greeting */}
        <section className="mb-5 mt-2">
          <h2 className="text-[28px] font-bold leading-tight text-text-primary">
            {greeting()}, {displayName}
          </h2>
          <div className="mt-2 flex gap-2">
            <Quote size={20} className="mt-0.5 shrink-0 fill-accent-dim text-accent-dim" />
            <p className="text-[15px] leading-snug text-text-secondary">
              Disziplin ist der Schlüssel zwischen Zielen und Erreichen.
            </p>
          </div>
        </section>

        {/* Morning Briefing (static) */}
        <section
          className="relative mb-3 overflow-hidden rounded-card border border-subtle p-4"
          style={{
            background:
              'linear-gradient(135deg, #1E3A6E 0%, #15264a 60%, #0F1629 100%)',
          }}
        >
          <Globe
            size={140}
            className="pointer-events-none absolute -right-6 -top-4 text-white/10"
            strokeWidth={1}
          />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-white" />
                <h2 className="text-[16px] font-bold text-text-primary">Morning Briefing</h2>
              </div>
              <span className="text-[12px] text-text-secondary">07:30 Uhr</span>
            </div>
            <p className="mt-2 max-w-[80%] text-[14px] leading-snug text-text-secondary">
              EZB-Sitzung 14:15 Uhr · DAX leicht im Plus · Nvidia-Zahlen nachbörslich.
            </p>
            <button className="press-fade mt-3 flex items-center gap-1 text-[14px] font-semibold text-accent">
              Briefing öffnen <ArrowRight size={16} />
            </button>
          </div>
        </section>

        {/* Heute im Überblick (static) */}
        <section className="mb-3 rounded-card border border-subtle bg-bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-text-primary">Heute im Überblick</h2>
            <button className="press-fade text-[13px] font-semibold text-accent">Mehr anzeigen</button>
          </div>
          <div className="space-y-3">
            {SCHEDULE.map((e) => (
              <div key={e.time} className="flex gap-3">
                <span className="w-12 shrink-0 text-[14px] font-medium text-text-secondary">
                  {e.time}
                </span>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-text-primary">{e.title}</p>
                  <p className="truncate text-[13px] text-text-secondary">{e.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Aufgaben preview (live) */}
        <section
          className="press-tint rounded-card border border-subtle bg-bg-card p-4"
          onClick={() => navigate('/aufgaben')}
          role="button"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[16px] font-bold text-text-primary">Aufgaben</h2>
              <p className="text-[12px] text-text-secondary">{openCount} offen</p>
            </div>
            <div
              className="flex rounded-chip bg-bg-input p-1"
              onClick={(e) => e.stopPropagation()}
            >
              {[
                { id: 'today', label: 'Heute' },
                { id: 'week', label: 'Diese Woche' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setScope(t.id)}
                  className={`press-tint rounded-chip px-3 py-1 text-[13px] font-medium transition-colors ${
                    scope === t.id ? 'bg-accent text-white' : 'text-text-secondary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 py-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-5 skeleton-shimmer rounded bg-bg-elevated" />
              ))}
            </div>
          ) : preview.length === 0 ? (
            <p className="py-2 text-[14px] text-text-secondary">
              Keine offenen Aufgaben {scope === 'today' ? 'heute' : 'diese Woche'}.
            </p>
          ) : (
            <div className="space-y-1">
              {preview.map((task) => (
                <div key={task.id} className="flex items-center gap-3 py-1.5">
                  <span className="h-[18px] w-[18px] shrink-0 rounded-md border-2 border-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                    {task.title}
                  </span>
                  {task.due_time && (
                    <span
                      className={`text-[12px] ${
                        isToday(task.due_date) ? 'text-accent' : 'text-text-secondary'
                      }`}
                    >
                      {formatTime(task.due_time)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
