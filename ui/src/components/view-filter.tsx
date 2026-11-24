// The filter on the Board and the Timeline: a button in the header that
// opens the choices (a popover, or a sheet from the bottom on a phone), and a
// bar under the title that keeps what is filtered in sight as chips, with a
// count. One filter for both pages (see lib/view-filter).
import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { CheckIcon, ListFilterIcon, SearchIcon, UserXIcon, XIcon } from 'lucide-react'
import { Avatar } from '@/components/avatars'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ProjectDot } from '@/components/marks'
import { useIsMobile } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { play } from '@/lib/sounds'
import { cleanFilter, filterChips, isFiltering, NO_FILTER, PRIORITY_SHORT, WHEN_NAMES, type ViewFilter, type When } from '@/lib/view-filter'
import { getFilterOpen, getStoredFilter, setFilterOpen, setViewFilter, subscribeViewFilter } from '@/lib/view-filter-store'
import { cn } from '@/lib/utils'
import { workspaces, type Member } from '@/lib/team'

// The people a filter can name: the members of the workspaces being looked
// at, once each, you first. None in one's own space.
function usePeople(): Member[] {
  const { team, scope, me } = useApp()
  const spaces = workspaces(team).filter((s) => scope === 'all' || s.id === scope)
  const seen = new Map<string, Member>()
  for (const m of spaces.flatMap((s) => s.members)) if (!seen.has(m.id)) seen.set(m.id, m)
  return [...seen.values()].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0))
}

// The filter as it applies now: read from storage and checked against the
// projects there are today.
export function useViewFilter(): ViewFilter {
  const { data } = useApp()
  const stored = useSyncExternalStore(subscribeViewFilter, getStoredFilter)
  return useMemo(() => cleanFilter(stored, data.projects), [stored, data.projects])
}

const LABEL = 'text-xs font-medium text-muted-foreground'
// A chosen priority or time window in the app's blue, so what is on can be
// told apart at a glance from what is not.
const CHOSEN = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={LABEL}>{title}</div>
      {children}
    </div>
  )
}

function FilterChoices() {
  const { shown, me } = useApp()
  const people = usePeople()
  const filter = useViewFilter()
  const isMobile = useIsMobile()
  const set = (next: Partial<ViewFilter>) => setViewFilter({ ...filter, ...next })
  const toggleProject = (id: number | null) =>
    set({ projects: filter.projects.includes(id) ? filter.projects.filter((p) => p !== id) : [...filter.projects, id] })
  const projectRow = (id: number | null, name: string) => {
    const chosen = filter.projects.includes(id)
    return (
      <button
        key={id ?? 'inbox'}
        type="button"
        role="menuitemcheckbox"
        aria-checked={chosen}
        onClick={() => toggleProject(id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent max-md:py-2.5',
          chosen && 'font-medium',
        )}
      >
        <ProjectDot id={id} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {chosen && <CheckIcon className="size-4 text-primary" />}
      </button>
    )
  }

  const personRow = (key: string, name: string, face: ReactNode) => {
    const chosen = filter.people.includes(key)
    return (
      <button
        key={key}
        type="button"
        role="menuitemcheckbox"
        aria-checked={chosen}
        onClick={() => set({ people: chosen ? filter.people.filter((p) => p !== key) : [...filter.people, key] })}
        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent max-md:py-2.5', chosen && 'font-medium')}
      >
        {face}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {chosen && <CheckIcon className="size-4 text-primary" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter.words}
          onChange={(event) => set({ words: event.target.value })}
          placeholder="Words in the title or notes"
          aria-label="Words in the title or notes"
          // On a phone the keyboard would cover half the choices if it rose by itself.
          autoFocus={!isMobile}
          className="h-8 pl-8"
        />
      </div>
      <Section title="Projects">
        <div className="-mx-2 flex max-h-56 flex-col overflow-y-auto">
          {projectRow(null, 'Inbox')}
          {shown.projects.map((p) => projectRow(p.id, p.name))}
        </div>
      </Section>
      {people.length > 0 && (
        <Section title="Assignee">
          <div className="-mx-2 flex max-h-48 flex-col overflow-y-auto">
            {people.map((m) => personRow(m.id === me ? 'me' : m.id, m.id === me ? 'Me' : m.name || m.email, <Avatar who={m} size="xs" />))}
            {personRow('nobody', 'Nobody', <UserXIcon className="size-4 text-muted-foreground" />)}
          </div>
        </Section>
      )}
      <Section title="Priority">
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          spacing={1}
          value={filter.priorities.map(String)}
          onValueChange={(values) => set({ priorities: values.map(Number) })}
          aria-label="Priority"
          className="flex-wrap"
        >
          {[0, 1, 2, 3, 4].map((p) => (
            <ToggleGroupItem key={p} value={String(p)} className={CHOSEN}>
              {PRIORITY_SHORT[p]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>
      <Section title="When">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          value={filter.when}
          // Pressing the chosen one again goes back to any time, rather than to nothing.
          onValueChange={(value) => set({ when: (value || 'any') as When })}
          aria-label="When"
          className="flex-wrap"
        >
          {(Object.keys(WHEN_NAMES) as When[]).map((when) => (
            <ToggleGroupItem key={when} value={when} className={CHOSEN}>
              {WHEN_NAMES[when]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>
      {isFiltering(filter) && (
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setViewFilter(NO_FILTER)}>
          Clear all
        </Button>
      )}
    </div>
  )
}

// The button in the header. Shows how many things are filtered, so a page
// that looks short says why even with the bar scrolled away.
export function FilterButton() {
  const filter = useViewFilter()
  const open = useSyncExternalStore(subscribeViewFilter, getFilterOpen)
  const isMobile = useIsMobile()
  const count = filterChips(filter, []).length
  const button = (
    <Button
      variant={count ? 'secondary' : 'ghost'}
      size="sm"
      className={count ? 'text-foreground' : 'text-muted-foreground'}
      aria-label={count ? `Filter, ${count} on` : 'Filter'}
      title="Filter (F)"
      onClick={isMobile ? () => setFilterOpen(true) : undefined}
    >
      <ListFilterIcon />
      Filter
      {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] leading-4 text-primary-foreground tabular-nums">{count}</span>}
    </Button>
  )
  if (isMobile)
    return (
      <>
        {button}
        <Sheet open={open} onOpenChange={setFilterOpen}>
          <SheetContent
            side="bottom"
            // The sheet would focus the words field as it opens, and the phone's
            // keyboard would then cover half the choices. A tap on it is enough.
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="max-h-[85svh] overflow-y-auto rounded-t-2xl pr-[env(safe-area-inset-right)] pb-[calc(env(safe-area-inset-bottom)+1rem)] pl-[env(safe-area-inset-left)]"
          >
            <SheetHeader>
              <SheetTitle>Filter</SheetTitle>
            </SheetHeader>
            <div className="px-4">
              <FilterChoices />
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  return (
    <Popover open={open} onOpenChange={setFilterOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <FilterChoices />
      </PopoverContent>
    </Popover>
  )
}

// Under the title while a filter is on: what is filtered, each removable,
// how many tasks are shown of how many, and Clear.
export function FilterBar({ shown, total }: { shown: number; total: number }) {
  const { data, team } = useApp()
  const filter = useViewFilter()
  if (!isFiltering(filter)) return null
  const people = (team?.spaces ?? []).flatMap((s) => s.members).map((m) => ({ id: m.id, name: m.name || m.email }))
  return (
    <div className="-mt-3 mb-5 flex flex-wrap items-center gap-1.5" aria-label="Filter">
      {filterChips(filter, data.projects, people).map((chip) => (
        <span key={chip.key} className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs">
          {chip.key.startsWith('p') && <ProjectDot id={chip.key === 'pinbox' ? null : Number(chip.key.slice(1))} />}
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label}`}
            onClick={() => {
              play('confirm')
              setViewFilter(chip.without)
            }}
            className="relative rounded-full p-0.5 text-muted-foreground after:absolute after:-inset-1.5 hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <span className="ml-1 text-xs text-muted-foreground tabular-nums">
        {shown} of {total} tasks
      </span>
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setViewFilter(NO_FILTER)}>
        Clear
      </Button>
    </div>
  )
}

// In place of the page when the filter leaves nothing: says so, and offers
// the way back, instead of empty columns that look like no work.
export function NothingMatches() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
      <p className="text-sm text-muted-foreground">No tasks match the filter.</p>
      <Button variant="outline" size="sm" onClick={() => setViewFilter(NO_FILTER)}>
        Clear the filter
      </Button>
    </div>
  )
}
