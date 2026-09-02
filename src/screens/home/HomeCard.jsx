import ScrollList from '../../components/ScrollList'

// ── The height budget of a Heute list ───────────────────────────────────────
// One number for both cards, so the two blocks weigh the same on the screen
// and a third one later inherits the same rhythm.
//
// 240px is a touch under five task rows (60px each) and roughly four agenda
// rows, which is enough to be an overview and little enough that both cards
// plus the greeting stay within a phone screen. The `dvh` half takes over on
// short viewports — on a 568px-tall phone 31dvh is ~176px, so the card shrinks
// with the screen instead of pushing the second one out of sight.
export const LIST_MAX_HEIGHT = 'min(240px, 31dvh)'

// ── One block on the Heute screen ───────────────────────────────────────────
//
// Header (icon, title, a caption saying how much there is, and an optional
// control on the right) over a body that scrolls inside its own height budget,
// with an optional full-width footer action pinned below the scroll area.
//
// Every block on this screen goes through here. That is what keeps the screen
// one rhythm as it gains sections: a new card is a `<HomeCard>` with a list in
// it and cannot arrive with its own header geometry or its own idea of how
// tall a list may be.
//
// The header row wraps rather than shrinking. At 390px the title and a
// segmented control sit on one line; at 320px, where four German words plus a
// switch do not fit, the control drops to its own line instead of squeezing the
// title into an ellipsis.
export default function HomeCard({
  id,
  icon: Icon,
  title,
  caption,
  trailing,
  footer,
  listRef,
  children,
}) {
  return (
    <section
      data-home-card={id}
      className="overflow-hidden rounded-card border border-subtle bg-bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon size={20} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-section font-bold leading-[22px] text-text-primary">
              {title}
            </h2>
            {caption && (
              <p className="truncate text-caption leading-[16px] text-text-secondary">
                {caption}
              </p>
            )}
          </div>
        </div>
        {trailing}
      </div>

      <ScrollList maxHeight={LIST_MAX_HEIGHT} innerRef={listRef}>
        {children}
      </ScrollList>

      {footer}
    </section>
  )
}
