import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { bottomNav } from '../config/navigation'
import { useUI } from '../context/UIContext'

// Persistent bottom navigation. Driven entirely by the `bottomNav` config —
// the center `plus` slot opens the action sheet, every other slot is a route.
export default function BottomNav() {
  const { openActionSheet } = useUI()

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="pointer-events-auto w-full max-w-app">
        {/* Opaque `bg-base`, the same material the sticky header in
            `TasksList.jsx` already uses for the same job: persistent chrome with
            content scrolling underneath. Previously an inline
            `rgba(8, 12, 20, 0.92)` plus `blur(20px)` — the app's only
            translucency, while §25 defers a glass/material system (G11). The
            blur was measurably inert: at 92% opacity it changed 20 of 88,920
            pixels, by 1/255. Only `paddingBottom` stays inline; `env()` has no
            Tailwind token. */}
        <div
          className="flex items-stretch border-t border-subtle bg-bg-base"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {bottomNav.map((item) =>
            item.type === 'plus' ? (
              <div
                key={item.id}
                className="relative flex flex-1 items-start justify-center"
              >
                {/* Scale only, no `press-tint`: the glow is an inline style,
                    which beats any class rule, so the press wash could never
                    paint here. The 0.95 scale this button always had is its
                    press feedback — now driven by the central controller, so it
                    cancels when the finger leaves, like everything else. */}
                <button
                  onClick={openActionSheet}
                  aria-label="Neu erstellen"
                  className="press-scale absolute -top-5 grid h-14 w-14 place-items-center rounded-full bg-accent text-white"
                  style={{ boxShadow: '0 4px 20px rgba(74, 128, 255, 0.4)' }}
                >
                  <Plus size={28} />
                </button>
              </div>
            ) : (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.to === '/'}
                className="press-fade flex flex-1 flex-col items-center justify-center gap-1 pt-2.5 pb-1.5"
              >
                {({ isActive }) => {
                  const Icon = item.icon
                  const color = isActive ? 'text-accent' : 'text-text-muted'
                  return (
                    <>
                      <Icon size={20} className={color} />
                      <span className={`text-caption font-medium ${color}`}>
                        {item.label}
                      </span>
                    </>
                  )
                }}
              </NavLink>
            )
          )}
        </div>
      </div>
    </nav>
  )
}
