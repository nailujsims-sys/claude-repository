// Pulsing shimmer placeholders used while a screen's first rows are loading.

export function SkeletonLine({ className = '' }) {
  return (
    <div
      className={`skeleton-shimmer rounded-md bg-bg-elevated ${className}`}
    />
  )
}

export function SkeletonTaskList() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((group) => (
        <div key={group} className="rounded-card bg-bg-card p-4 space-y-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="skeleton-shimmer h-[22px] w-[22px] rounded-full bg-bg-elevated shrink-0" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-3.5 w-2/3" />
                <SkeletonLine className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// The Listen overview: two section cards of rows, in the same 60px-per-row
// rhythm ListRow renders — a boxed icon and one line of text, so the skeleton
// has the shape of what replaces it instead of a generic block.
export function SkeletonListOverview() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((group) => (
        <div key={group} className="rounded-card bg-bg-card p-4 space-y-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-btn bg-bg-elevated" />
              <SkeletonLine className="h-3.5 w-1/2" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
