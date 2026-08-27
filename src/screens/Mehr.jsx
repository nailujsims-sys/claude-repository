import { Menu, Lock } from 'lucide-react'
import IconButton from '../components/IconButton'
import { useUI } from '../context/UIContext'
import { futureModules } from '../config/navigation'

// Preview of upcoming modules — all greyed out with a "Demnächst" badge.
export default function Mehr() {
  const { openSidebar } = useUI()
  return (
    <div className="min-h-screen px-5 pt-5 pb-28">
      <header className="flex items-center gap-2">
        <IconButton onClick={openSidebar} aria-label="Menü öffnen" className="-ml-1 text-text-primary">
          <Menu size={26} />
        </IconButton>
        <h1 className="text-[28px] font-bold text-text-primary">Mehr</h1>
      </header>

      <p className="mt-2 mb-3 text-[14px] text-text-secondary">
        Weitere Module sind in Arbeit.
      </p>

      <div className="overflow-hidden rounded-card border border-subtle bg-bg-card">
        {futureModules.map((m, i) => {
          const Icon = m.icon
          return (
            <div
              key={m.id}
              className={`flex items-center gap-3 px-4 py-4 ${
                i < futureModules.length - 1 ? 'border-b border-subtle' : ''
              }`}
            >
              <span className="grid h-9 w-9 place-items-center rounded-btn bg-bg-elevated text-text-muted">
                <Icon size={18} />
              </span>
              <span className="flex-1 text-[15px] font-medium text-text-secondary">
                {m.label}
              </span>
              <span className="flex items-center gap-1 rounded-chip bg-bg-elevated px-2 py-0.5 text-[11px] font-semibold text-text-muted">
                <Lock size={11} /> Demnächst
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
