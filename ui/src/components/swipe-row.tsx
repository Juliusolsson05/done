// Swipe actions on a phone's task row, as in Mail and Reminders: swipe right
// to complete, left to delete. The row follows the finger over a coloured
// action; past the point where letting go acts, the phone ticks once.
import { useRef, useState, type ReactNode } from 'react'
import { CheckIcon, Trash2Icon } from 'lucide-react'
import { tick } from '@/lib/haptics'
import { cn } from '@/lib/utils'

// How far, in pixels, a row must travel for letting go to act.
const ACTS = 96

export function SwipeRow({ children, onComplete, onDelete }: { children: ReactNode; onComplete: () => void; onDelete: () => void }) {
  const [dx, setDx] = useState(0)
  const [settling, setSettling] = useState(false)
  const from = useRef<{ x: number; y: number } | null>(null)
  // Decided on the first few pixels: a swipe, or a scroll left alone.
  const mode = useRef<'swipe' | 'scroll' | null>(null)
  const past = useRef(false)

  const end = () => {
    from.current = null
    if (mode.current !== 'swipe') return
    setSettling(true)
    if (dx >= ACTS) onComplete()
    else if (dx <= -ACTS) {
      // Slides off to the left as it goes.
      setDx(-window.innerWidth)
      setTimeout(onDelete, 180)
      return
    }
    setDx(0)
  }

  return (
    <div className="relative overflow-hidden">
      {dx !== 0 && (
        <div
          aria-hidden
          className={cn('absolute inset-0 flex items-center px-6 text-white', dx > 0 ? 'justify-start bg-done' : 'justify-end bg-destructive')}
        >
          {dx > 0 ? <CheckIcon className="size-6" strokeWidth={3} /> : <Trash2Icon className="size-6" strokeWidth={2.4} />}
        </div>
      )}
      <div
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        className={cn('relative bg-background', settling && 'transition-transform duration-200 ease-out')}
        onTransitionEnd={() => setSettling(false)}
        onTouchStart={(e) => {
          const t = e.touches[0]
          // The left edge belongs to going back.
          if (t.clientX < 24) return
          from.current = { x: t.clientX, y: t.clientY }
          mode.current = null
          past.current = false
          setSettling(false)
        }}
        onTouchMove={(e) => {
          if (!from.current) return
          const t = e.touches[0]
          const x = t.clientX - from.current.x
          const y = t.clientY - from.current.y
          if (!mode.current) mode.current = Math.abs(x) > 8 && Math.abs(x) > Math.abs(y) ? 'swipe' : Math.abs(y) > 8 ? 'scroll' : null
          if (mode.current !== 'swipe') return
          setDx(x)
          const now = Math.abs(x) >= ACTS
          if (now !== past.current) tick()
          past.current = now
        }}
        onTouchEnd={end}
        onTouchCancel={end}
      >
        {children}
      </div>
    </div>
  )
}
