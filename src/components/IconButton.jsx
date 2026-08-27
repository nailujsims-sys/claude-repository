import { forwardRef } from 'react'

// The app's header / toolbar icon button. The Kalender header already used this
// exact box (a 36×36 — 32×32 when `small` — rounded-chip square carrying
// `press-tint`); pulling it into one component means every screen's menu, back,
// search and filter icon gets the same hit area, the same guarded hover and the
// same press feedback without any of them repeating the markup.
const IconButton = forwardRef(function IconButton(
  { children, small = false, className = '', type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      className={`press-tint grid shrink-0 place-items-center rounded-chip ${
        small ? 'h-8 w-8' : 'h-9 w-9'
      } ${className}`}
    >
      {children}
    </button>
  )
})

export default IconButton
