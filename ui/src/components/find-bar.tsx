// Find on the page, Cmd+F: what is typed is marked wherever it shows in the
// titles and descriptions of the tasks and notes on the current page, Enter goes to the next match and Shift+Enter to the one
// before, Escape closes. Marked with the browser's own highlights, so the
// page itself is never changed. Search over everything is Cmd+K.
import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { occurrences, step } from '@/lib/find'
import { play } from '@/lib/sounds'

// The page: everything right of the sidebar.
const pageRoot = () => document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')

const highlights = (): HighlightRegistry | undefined => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined)

// Every place the query shows on the page, in reading order.
function rangesFor(query: string, bar: HTMLElement | null): Range[] {
  const root = pageRoot()
  if (!root || !query.trim()) return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || (bar && bar.contains(parent))) return NodeFilter.FILTER_REJECT
      // Only what a task or note says: its title and description, not the
      // page's headings, dates or buttons.
      if (!parent.closest('[data-findable]')) return NodeFilter.FILTER_REJECT
      // Only text that can be seen.
      if (parent.checkVisibility ? !parent.checkVisibility() : parent.offsetParent === null) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const [start, end] of occurrences(node.textContent ?? '', query)) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      ranges.push(range)
    }
  }
  return ranges
}

export function FindBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [at, setAt] = useState(0)
  // Bumped when the page changes under the bar, so the marks follow it.
  const [changes, setChanges] = useState(0)
  const bar = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setOpen((was) => {
          if (!was) play('open')
          return true
        })
        // Pressed again while open: select what is there, ready to type over.
        requestAnimationFrame(() => field.current?.select())
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // The page changes (another view, a note opened, a refresh): find again.
  useEffect(() => {
    const root = pageRoot()
    if (!open || !root) return
    let timer: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setChanges((n) => n + 1), 150)
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [open])

  useEffect(() => {
    const found = open ? rangesFor(query, bar.current) : []
    setRanges(found)
    setAt((i) => (i < found.length ? i : 0))
  }, [open, query, changes])

  // Mark them all, the current one more strongly, and bring it into view.
  useEffect(() => {
    const registry = highlights()
    if (registry) {
      registry.set('find', new Highlight(...ranges))
      registry.set('find-current', ranges[at] ? new Highlight(ranges[at]) : new Highlight())
    }
    ranges[at]?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return () => {
      registry?.delete('find')
      registry?.delete('find-current')
    }
  }, [ranges, at])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  if (!open) return null
  return (
    <div
      ref={bar}
      role="search"
      // Below the status bar and clear of the notch wherever it is (all 0 on a Mac).
      className="fixed top-[calc(var(--safe-top)+0.75rem)] right-[calc(var(--safe-right)+1.25rem)] z-50 flex items-center gap-1 rounded-xl border bg-popover py-1 pr-1 pl-3 text-popover-foreground shadow-lg max-md:top-[calc(var(--safe-top)+0.5rem)] max-md:right-[max(0.75rem,var(--safe-right))] max-md:left-[max(0.75rem,var(--safe-left))]"
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={field}
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setAt(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            setAt((i) => step(i, ranges.length, event.shiftKey ? -1 : 1))
          }
        }}
        placeholder="Find on this page"
        aria-label="Find on this page"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-52 border-0 px-1 shadow-none focus-visible:ring-0 max-md:flex-1"
      />
      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {query.trim() ? (ranges.length ? `${at + 1} of ${ranges.length}` : 'None') : ''}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        disabled={ranges.length < 2}
        onClick={() => setAt((i) => step(i, ranges.length, -1))}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        disabled={ranges.length < 2}
        onClick={() => setAt((i) => step(i, ranges.length, 1))}
      >
        <ChevronDownIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close find" onClick={close}>
        <XIcon />
      </Button>
    </div>
  )
}
