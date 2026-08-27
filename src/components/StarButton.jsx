import { useState } from 'react'
import { Star } from 'lucide-react'

// Favorite toggle with a small scale-pop on tap. Used in the list and detail.
export default function StarButton({ active, onToggle, size = 22, className = '' }) {
  const [pop, setPop] = useState(false)

  const handle = (e) => {
    e.stopPropagation()
    e.preventDefault()
    setPop(true)
    setTimeout(() => setPop(false), 220)
    onToggle?.()
  }

  return (
    <button
      onClick={handle}
      aria-label={active ? 'Favorit entfernen' : 'Als Favorit markieren'}
      aria-pressed={active}
      className={`press-fade p-1 ${pop ? 'animate-star-pop' : ''} ${className}`}
    >
      <Star
        size={size}
        className={active ? 'text-accent' : 'text-text-muted'}
        fill={active ? '#4A80FF' : 'none'}
      />
    </button>
  )
}
