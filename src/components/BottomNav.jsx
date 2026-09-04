import { useLayoutEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { bottomNav } from '../config/navigation'
import { useUI } from '../context/UIContext'
import { installBrowserBottomInset } from '../lib/browserBottomInset'

// Persistent bottom navigation. Driven entirely by the `bottomNav` config —
// the center `plus` slot opens the action sheet, every other slot is a route.
//
// It sits on the measured `--browser-bottom-inset` rather than assuming that
// every lvh/dvh difference is below the page. That distinction keeps a real
// bottom browser bar clear without treating Android's top toolbar as one.
export default function BottomNav() {
  const { openActionSheet } = useUI()

  useLayoutEffect(() => installBrowserBottomInset(), [])

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-[var(--browser-bottom-inset)] z-40 flex justify-center">
      <div className="pointer-events-auto w-full max-w-app">
        <div
          className="flex items-stretch border-t border-subtle"
          style={{
            background: 'rgba(8, 12, 20, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
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
                      <span className={`text-[11px] font-medium ${color}`}>
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
