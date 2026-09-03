import { Link } from 'react-router-dom'
import { Lock, Info, ChevronRight, ListChecks } from 'lucide-react'
import TopBar from '../components/TopBar'
import { futureModules } from '../config/navigation'

// Preview of upcoming modules — all greyed out with a "Demnächst" badge.
export default function Mehr() {
  return (
    <div className="min-h-screen pb-28">
      <TopBar title="Mehr" />

      <div className="px-5">
        {/* Built and usable today — kept above the "Demnächst" list so the two
            are not read as one group. */}
        <Link
          to="/listen"
          className="press-tint mt-4 flex items-center gap-3 rounded-card border border-subtle bg-bg-card px-4 py-4"
        >
          <span className="grid h-9 w-9 place-items-center rounded-btn bg-bg-elevated text-text-secondary">
            <ListChecks size={18} />
          </span>
          <span className="flex-1 text-[15px] font-medium text-text-primary">Listen</span>
          <ChevronRight size={18} className="text-text-muted" />
        </Link>

        <Link
          to="/version"
          className="press-tint mt-3 flex items-center gap-3 rounded-card border border-subtle bg-bg-card px-4 py-4"
        >
          <span className="grid h-9 w-9 place-items-center rounded-btn bg-bg-elevated text-text-secondary">
            <Info size={18} />
          </span>
          <span className="flex-1 text-[15px] font-medium text-text-primary">Version</span>
          <ChevronRight size={18} className="text-text-muted" />
        </Link>

        <p className="mt-6 mb-3 text-[14px] text-text-secondary">
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
    </div>
  )
}
