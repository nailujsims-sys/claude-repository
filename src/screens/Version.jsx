import { Menu, CalendarDays, Hash } from 'lucide-react'
import IconButton from '../components/IconButton'
import { useUI } from '../context/UIContext'
import { APP_VERSION, BUILD_COMMIT, shortCommit, formatBuildTime } from '../lib/version'

// Which build am I looking at? Answers that in one screen: the product version
// (package.json, bumped deliberately per milestone) and the technical identity
// of the bundle actually being served (commit + build time, injected by the
// build — see src/lib/version.js).
export default function Version() {
  const { openSidebar } = useUI()

  return (
    <div className="min-h-screen px-5 pt-5 pb-28">
      <header className="flex items-center gap-2">
        <IconButton onClick={openSidebar} aria-label="Menü öffnen" className="-ml-1 text-text-primary">
          <Menu size={26} />
        </IconButton>
        <h1 className="text-[28px] font-bold text-text-primary">Version</h1>
      </header>

      <p className="mt-2 mb-3 text-[14px] text-text-secondary">
        Dieser Stand läuft gerade.
      </p>

      {/* The product version, as the one thing worth reading from across the
          room. The technical identity sits below it, deliberately quieter. */}
      <div className="rounded-card border border-subtle bg-bg-card px-5 py-6">
        <p className="text-[34px] font-bold leading-none text-text-primary">
          v{APP_VERSION}
        </p>
        <p className="mt-2 text-[13px] text-text-secondary">Mind Whiteboard</p>
      </div>

      <div className="mt-4 divide-y divide-subtle overflow-hidden rounded-card border border-subtle bg-bg-card">
        <Row icon={CalendarDays} label="Build">
          {formatBuildTime()}
        </Row>
        <Row icon={Hash} label="Commit">
          {/* Monospace so it can be compared character by character against the
              commit on the branch; the full hash stays selectable on desktop. */}
          <span className="font-mono" title={BUILD_COMMIT}>
            {shortCommit()}
          </span>
        </Row>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-text-muted">
        Die Version steht für den Produktstand, der Commit für den exakt
        gebauten Code.
      </p>
    </div>
  )
}

// Same row anatomy as the detail screens: icon, label, value on the right.
function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <Icon size={18} className="shrink-0 text-text-secondary" />
      <span className="text-[15px] text-text-primary">{label}</span>
      <span className="ml-auto truncate pl-3 text-[15px] text-text-secondary">
        {children}
      </span>
    </div>
  )
}
