import { Menu } from 'lucide-react'
import IconButton from './IconButton'
import { useUI } from '../context/UIContext'

// ── The app's global top bar ────────────────────────────────────────────────
//
// One bar for every main area. Before this component each screen built its own
// header: Heute sat at `px-5 pt-3` with a `py-2` row and no title, Kalender at
// `px-4 pt-4` with a 42px row and a 19px title, Aufgaben at `px-5 pt-5` with a
// 28px title — so the hamburger landed on a different x *and* y on every page
// and the whole bar jumped while navigating. Nothing about that was per-screen
// on purpose; it was three headers that grew apart.
//
// So the geometry lives here and nowhere else, and it is fixed:
//
//   • horizontal inset  16px (`px-4`) on both sides. The leading icon button is
//     36px wide around a 26px glyph, so the glyph starts 5px inside its box —
//     i.e. at 21px, optically flush with the 20px (`px-5`) content column the
//     screens use below the bar. That is what the old `-ml-1` on every menu
//     button was hand-correcting; with the inset chosen for it, no screen needs
//     a nudge of its own any more.
//   • top inset  12px plus `env(safe-area-inset-top)`, so the bar keeps the
//     same distance from the *visible* top edge on a notched device as it does
//     in a plain browser window (`viewport-fit=cover` is set in index.html).
//   • row height  40px, always. The title block reserves its subtitle line even
//     when there is no subtitle (a non-breaking space), so a screen with one
//     and a screen without are exactly the same height — Kalender already
//     solved it that way for its own three views and the bar now does it for
//     every screen.
//   • the trailing actions are right-anchored with a fixed 8px gap, so the
//     Aufgaben search sits on the same pixel as the Kalender search and as the
//     Heute bell. Actions are `IconButton`s, i.e. the same 36×36 target.
//
// Everything a screen may vary is text and the two action icons. Height,
// insets, the menu button and the title's position are not props on purpose:
// a future module gets the identical bar by rendering `<TopBar title="…" />`,
// and cannot accidentally shift it.
//
// The bar sticks to the top of its scroll container (`sticky`), which is what
// Aufgaben's header already did and what Kalender's fixed-height shell gets for
// free — in a non-scrolling flex column `sticky` simply resolves to its normal
// position.
export default function TopBar({ title, subtitle = null, actions = null }) {
  const { openSidebar } = useUI()

  return (
    <header
      data-topbar=""
      className="sticky top-0 z-30 shrink-0 bg-bg-base px-4 pb-2"
      style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
    >
      <div className="flex h-10 items-center gap-2">
        <IconButton onClick={openSidebar} aria-label="Menü öffnen" className="text-text-primary">
          <Menu size={26} />
        </IconButton>

        {/* `min-w-0` + `truncate`: a long title (the calendar's week range, a
            future module with a long name) shortens instead of pushing the
            actions off the right edge — the reason the bar holds still at
            320px as well as at 430px. */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-heading font-bold leading-[22px] text-text-primary">
            {title}
          </h1>
          <p className="truncate text-caption leading-[16px] text-text-secondary">
            {subtitle || '\u00A0'}
          </p>
        </div>

        {actions && (
          <div data-topbar-actions="" className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}
