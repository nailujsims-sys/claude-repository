const PROPERTY = '--browser-bottom-inset'

export function calculateBrowserBottomInset(fixedBottom, viewport) {
  const visibleBottom = viewport.offsetTop + viewport.height
  return Math.max(0, Math.round(fixedBottom - visibleBottom))
}

// Measure the bottom edge a real fixed element resolves to instead of assuming
// that the entire lvh/dvh difference belongs below the page. The latter is not
// true in Android Chrome, whose browser toolbar is above the visual viewport.
export function installBrowserBottomInset() {
  const viewport = window.visualViewport
  if (!viewport) return () => {}

  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  Object.assign(probe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  })
  document.body.appendChild(probe)

  let frame = 0
  const measure = () => {
    frame = 0
    const fixedBottom = probe.getBoundingClientRect().bottom
    const inset = calculateBrowserBottomInset(fixedBottom, viewport)
    document.documentElement.style.setProperty(PROPERTY, `${inset}px`)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure)
  }

  measure()
  viewport.addEventListener('resize', schedule)
  viewport.addEventListener('scroll', schedule)
  window.addEventListener('orientationchange', schedule)

  return () => {
    viewport.removeEventListener('resize', schedule)
    viewport.removeEventListener('scroll', schedule)
    window.removeEventListener('orientationchange', schedule)
    if (frame) cancelAnimationFrame(frame)
    probe.remove()
    document.documentElement.style.removeProperty(PROPERTY)
  }
}
