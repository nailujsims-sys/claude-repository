import { Star } from 'lucide-react'

// Favorite toggle. Used in the list and detail.
//
// The feedback is the star itself: `.press-fade` dips it on pointer-down (G2)
// and the colour, fill and aria-pressed carry the state. It deliberately has no
// animation of its own — the scale pop it used to play was decoration, and §8
// asks for none (G9).
export default function StarButton({ active, onToggle, size = 22, className = '' }) {
  const handle = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onToggle?.()
  }

  return (
    <button
      onClick={handle}
      aria-label={active ? 'Favorit entfernen' : 'Als Favorit markieren'}
      aria-pressed={active}
      className={`press-fade p-1 ${className}`}
    >
      <Star
        size={size}
        className={active ? 'text-accent' : 'text-text-muted'}
        fill={active ? '#4A80FF' : 'none'}
      />
    </button>
  )
}
