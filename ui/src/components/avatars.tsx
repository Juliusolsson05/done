// People's faces: the Google picture, or their initials on a colour of
// their own when there is none or it does not load.
import { useState } from 'react'
import { initials, tintOf, type Member } from '@/lib/team'
import { cn } from '@/lib/utils'

type Who = Pick<Member, 'id' | 'name' | 'email' | 'picture'>

const SIZE = { xs: 'size-4 text-[8px]', sm: 'size-5 text-[9.5px]', md: 'size-7 text-xs', lg: 'size-9 text-sm' }

export function Avatar({ who, size = 'sm', className }: { who: Who; size?: keyof typeof SIZE; className?: string }) {
  const [failed, setFailed] = useState(false)
  const label = who.name || who.email
  if (who.picture && !failed)
    return (
      <img
        src={who.picture}
        alt={label}
        title={label}
        // Google's pictures load without telling Google which page asked.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full bg-secondary object-cover', SIZE[size], className)}
      />
    )
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ background: tintOf(who.id) }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', SIZE[size], className)}
    >
      {initials(who.name, who.email)}
    </span>
  )
}

// Up to three faces, overlapping, then "+2". Each sits on a ring the colour
// of what is behind it (`ring`), so the overlap reads as separate people.
export function Avatars({
  people,
  size = 'sm',
  max = 3,
  ring = 'ring-background',
  className,
}: {
  people: Who[]
  size?: keyof typeof SIZE
  max?: number
  ring?: string
  className?: string
}) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  return (
    <span className={cn('inline-flex items-center', className)} aria-label={people.map((p) => p.name || p.email).join(', ')}>
      {shown.map((p, i) => (
        <Avatar key={p.id} who={p} size={size} className={cn('ring-2', ring, i > 0 && '-ml-1.5')} />
      ))}
      {people.length > max && <span className="ml-1 text-xs text-muted-foreground tabular-nums">+{people.length - max}</span>}
    </span>
  )
}
