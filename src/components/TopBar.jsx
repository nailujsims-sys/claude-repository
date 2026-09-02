import { Link } from 'react-router-dom'
import { Menu, Bell, User } from 'lucide-react'
import IconButton from './IconButton'
import { useUI } from '../context/UIContext'

// ── The app's global top bar ────────────────────────────────────────────────
//
// One bar for every main area, and it is the same bar every time: hamburger,
// page title, notifications and profile. Only `title` varies.
//
// Before this component each screen built its own header — Heute at `px-5
// pt-3` with no title, Kalender at `px-4 pt-4` with a 19px date, Aufgaben at
// `px-5 pt-5` with a 28px title — so the menu button landed on a different x
// *and* y on every page and the whole bar jumped while navigating.
//
// The geometry lives here and nowhere else, and it is fixed:
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
//   • row height  40px, always, with one single-line title in it.
//   • the trailing pair is right-anchored with a fixed 8px gap and the same
//     36×36 targets as the menu button.
//
// **The title is one style for every screen** — `text-heading`, bold, one line,
// truncated if it does not fit. Deliberately no per-screen size, no autofit, no
// special case for a long one: a title that shrinks or wraps is exactly how the
// bar stopped being the same bar. It is also why the *page* title belongs here
// and nothing else does — the calendar's date is content and lives under the
// bar, next to the controls that change it.
//
// Everything else a screen wants in reach — a search, a filter, a period
// switch — goes into the screen's own first content row, below this bar.
// `title` is the only prop for that reason: a future module renders
// `<TopBar title="…" />` and gets the identical bar, and cannot shift it.
//
// The bar sticks to the top of its scroll container (`sticky`), which is what
// Aufgaben's header already did and what Kalender's fixed-height shell gets for
// free — in a non-scrolling flex column `sticky` simply resolves to its normal
// position.
export default function TopBar({ title }) {
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

        {/* `min-w-0` + `truncate`: a long title shortens instead of pushing the
            trailing pair off the right edge — the bar holds still at 320px as
            well as at 430px, at one unchanged font size. */}
        <h1 className="min-w-0 flex-1 truncate text-heading font-bold leading-[22px] text-text-primary">
          {title}
        </h1>

        <div data-topbar-actions="" className="flex shrink-0 items-center gap-2">
          <IconButton aria-label="Benachrichtigungen" className="relative text-text-primary">
            <Bell size={22} />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
          </IconButton>
          {/* Now that there is a profile screen, the avatar is the way to it.
              Same 36×36 slot as before, so the pair stays on its pixel. */}
          <Link
            to="/profil"
            aria-label="Profil"
            className="press-tint grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-elevated text-text-secondary"
          >
            <User size={20} />
          </Link>
        </div>
      </div>
    </header>
  )
}
