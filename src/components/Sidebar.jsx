import { NavLink } from 'react-router-dom'
import { Lock, User, X } from 'lucide-react'
import IconButton from './IconButton'
import Overlay, { useOverlayPanel } from './Overlay'
import { useUI } from '../context/UIContext'
import { useAuth } from '../context/AuthContext'
import { sidebarNav, futureModules } from '../config/navigation'

// Left slide-in sidebar (~80% width). Primary links come from `sidebarNav`;
// the foot shows `futureModules` greyed out so Julian sees where it's headed.
// It leaves the way it came, back towards the left edge (see Overlay / G4).
export default function Sidebar() {
  const { sidebarOpen, closeSidebar } = useUI()

  return (
    <Overlay open={sidebarOpen} onClose={closeSidebar} align="left" duration={250}>
      <Panel onClose={closeSidebar} />
    </Overlay>
  )
}

// Separate component so it can read the overlay phase from the context —
// useOverlayPanel only works below <Overlay>.
function Panel({ onClose: closeSidebar }) {
  const { displayName } = useAuth()
  const panel = useOverlayPanel(
    'ov-panel-left',
    'pointer-events-auto absolute inset-y-0 left-0 flex h-full w-[80%] max-w-[340px] flex-col bg-bg-card border-r border-subtle'
  )

  return (
    <aside {...panel}>
      <div className="flex items-center justify-between px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-bg-elevated text-text-secondary">
            <User size={24} />
          </div>
          <div>
            <p className="text-[17px] font-bold text-text-primary">{displayName}</p>
            <p className="text-[12px] text-text-secondary">Mind Whiteboard</p>
          </div>
        </div>
        <IconButton
          onClick={closeSidebar}
          aria-label="Menü schließen"
          className="text-text-secondary"
        >
          <X size={22} />
        </IconButton>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {sidebarNav.map((item) => {
          const Icon = item.icon
          if (!item.enabled) {
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-btn px-3 py-3 text-text-muted"
              >
                <Icon size={20} />
                <span className="text-[15px] font-medium">{item.label}</span>
                <Lock size={14} className="ml-auto" />
              </div>
            )
          }
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.to === '/'}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `press-tint flex items-center gap-3 rounded-btn px-3 py-3 text-[15px] font-medium ${
                  isActive ? 'bg-accent/15 text-accent' : 'text-text-primary'
                }`
              }
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}

        <div className="my-3 border-t border-subtle" />
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-section-label">
          Demnächst
        </p>
        {futureModules.map((m) => {
          const Icon = m.icon
          return (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-text-muted"
            >
              <Icon size={18} />
              <span className="text-[14px] font-medium">{m.label}</span>
              <Lock size={13} className="ml-auto" />
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
