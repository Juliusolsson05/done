import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { PlusIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { PriorityDot, ProjectDot } from '@/components/marks'
import { Avatar } from '@/components/avatars'
import { useFocus } from '@/hooks/use-focus'
import { useIsMobile } from '@/hooks/use-mobile'
import { useApp } from '@/lib/app-context'
import { carryDismissed, dismissOnBackspace, type Dismissed } from '@/lib/date-phrases'
import { describeDay, spellDay, TODAY } from '@/lib/days'
import { peopleSpans, prioritySpan, projectSpan, readLine, suggestPeople, suggestProjects, takePerson, takeSuggestion, type Person } from '@/lib/quick-add'
import { defaultProjectFor, handleOf, workspaceOf } from '@/lib/team'
import { play } from '@/lib/sounds'
import { addTask, PRIORITY_NAME, projectName, setGoal } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { addDefaults } from '@/lib/view-filter'
import { useViewFilter } from '@/components/view-filter'

function QuickAdd() {
  const { data, team, me, scope, ui, update, closeAll } = useApp()
  const [text, setText] = useState('')
  // Date phrases the user said are not dates, by pressing Backspace after them.
  const [dismissed, setDismissed] = useState<Dismissed[]>([])
  const inputRef = useFocus()
  const filter = useViewFilter()
  const mirrorRef = useRef<HTMLDivElement>(null)
  // Where the caret is, for suggesting a project while "@" is typed.
  const [caret, setCaret] = useState(0)
  // Who "+name" can name: the members of the workspace the task goes into
  // (its project's), or of the workspace being looked at when it has no
  // project yet. Nobody for one's own space.
  const peopleFor = (projectId: number | null): Person[] => {
    const project = projectId === null ? undefined : data.projects.find((p) => p.id === projectId)
    const space = project ? workspaceOf(project.spaceId, team) : typeof scope === 'number' ? workspaceOf(scope, team) : undefined
    return (space?.members ?? []).map((m) => ({ id: m.id, handle: handleOf(m), name: m.name || m.email }))
  }
  // In a workspace a task needs a project: the Inbox is one's own.
  const workspaceProject = defaultProjectFor(scope, data.projects)
  // What a new task gets when the typed line does not say: the view you are in.
  const fallback = {
    due: null,
    projectId: null,
    // On a filtered Board or Timeline: what keeps the new task on the page
    // it was added on (the one project, the one priority, a date in the window).
    ...(ui.view.kind === 'board' || ui.view.kind === 'timeline' ? addDefaults(filter, TODAY) : {}),
    ...(ui.view.kind === 'today' || ui.asGoal ? { due: TODAY } : {}),
    ...(ui.view.kind === 'project' ? { projectId: ui.view.id } : {}),
  }
  const read = readLine(
    text,
    data.projects,
    TODAY,
    { ...fallback, projectId: fallback.projectId ?? workspaceProject },
    dismissed,
    peopleFor,
  )

  const people = peopleFor(read.projectId)
  const suggestion = suggestProjects(text, caret, data.projects)
  const personSuggestion = suggestion ? null : suggestPeople(text, caret, people)
  // The date, the project and the people, marked in the field where they were typed.
  const project = projectSpan(text, data.projects)
  const marks = [read.date && { start: read.date.start, end: read.date.end }, project, prioritySpan(text, read.date), ...peopleSpans(text, people)]
    .filter((m): m is { start: number; end: number } => !!m)
    .sort((a, b) => a.start - b.start)

  // A long line scrolls inside the field; the highlight behind it has to
  // scroll with it. Done after every render as well as on scroll, because
  // typing moves the text before any scroll event arrives.
  const followScroll = () => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
  }
  useLayoutEffect(followScroll)

  const type = (next: string) => {
    setDismissed(carryDismissed(dismissed, text, next))
    setText(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Tab takes the suggested person: "+ge" becomes "+geart ".
    if (event.key === 'Tab' && !event.shiftKey && personSuggestion) {
      event.preventDefault()
      const taken = takePerson(text, personSuggestion, personSuggestion.people[0])
      play('confirm')
      type(taken.text)
      setCaret(taken.caret)
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(taken.caret, taken.caret))
      return
    }
    // Tab takes the suggested project: "@ha" becomes "@hackathons.team ".
    if (event.key === 'Tab' && !event.shiftKey && suggestion) {
      event.preventDefault()
      const taken = takeSuggestion(text, suggestion, suggestion.projects[0])
      play('confirm')
      type(taken.text)
      setCaret(taken.caret)
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(taken.caret, taken.caret))
      return
    }
    // Only the plain key: Option and Command Backspace delete a word or the
    // line, and a key pressed while composing belongs to the input method.
    if (event.key !== 'Backspace' || event.metaKey || event.altKey || event.ctrlKey || event.nativeEvent.isComposing) return
    const field = event.currentTarget
    const gone = dismissOnBackspace(text, field.selectionStart, field.selectionEnd, read.date)
    if (!gone) return
    event.preventDefault()
    setDismissed([...dismissed, gone])
  }

  const memberOf = (id: string) => {
    const m = people.find((p) => p.id === id)
    const full = team?.spaces.flatMap((s) => s.members).find((x) => x.id === id)
    return { id, name: m?.name ?? full?.name ?? 'Someone', email: full?.email ?? '', picture: full?.picture ?? '' }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!read.title) return
    const id = data.nextId
    play('add')
    update((d) => {
      const added = addTask(d, read)
      return ui.asGoal ? setGoal(added, id, TODAY, me) : added
    }, id)
    // Named as today's goal: there is only one, so the box closes after it.
    if (ui.asGoal) return closeAll()
    setText('') // stays open for the next task
    setDismissed([])
  }

  return (
    <Card className="my-1 animate-enter gap-2 p-3 shadow-md max-md:rounded-2xl max-md:p-4 max-md:shadow-2xl max-md:ring-0">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="relative">
          {/* A field cannot colour part of its own text, so the date phrase is
              marked on a copy of the line lying exactly behind the field: same
              type, same padding, never wrapped, scrolled with it. Only the
              mark shows; the copy's text is transparent. */}
          {marks.length > 0 && (
            <div
              ref={mirrorRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-base font-medium whitespace-pre text-transparent"
            >
              {/* The field keeps room for the caret after the last letter; without
                  the same room here a line scrolled to its end would sit a
                  couple of pixels off. */}
              <span className="pr-1">
                {marks.map((mark, i) => (
                  <span key={mark.start}>
                    {text.slice(i === 0 ? 0 : marks[i - 1].end, mark.start)}
                    {/* The ring is the mark's breathing room. It is a shadow, so
                        unlike padding it cannot move the text off the field's. */}
                    <span data-date-phrase={mark === project ? undefined : ''} className="rounded-sm bg-primary/15 ring-2 ring-primary/15">
                      {text.slice(mark.start, mark.end)}
                    </span>
                  </span>
                ))}
                {text.slice(marks[marks.length - 1].end)}
              </span>
            </div>
          )}
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              type(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
            }}
            onKeyDown={onKeyDown}
            onScroll={followScroll}
            onSelect={(e) => {
              followScroll()
              setCaret(e.currentTarget.selectionStart ?? 0)
            }}
            autoComplete="off"
            placeholder="What needs doing?"
            aria-label="New task"
            className="relative border-0 px-0 text-base font-medium placeholder:font-normal placeholder:text-faint focus-visible:ring-0 md:text-base"
          />
        </div>
        {/* The projects an "@" could be, the first taken with Tab. */}
        {suggestion && (
          <div className="flex flex-wrap items-center gap-1 text-xs pointer-coarse:gap-2" aria-live="polite">
            {suggestion.projects.slice(0, 5).map((p, i) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const taken = takeSuggestion(text, suggestion, p)
                  play('confirm')
                  type(taken.text)
                  setCaret(taken.caret)
                  requestAnimationFrame(() => {
                    inputRef.current?.focus()
                    inputRef.current?.setSelectionRange(taken.caret, taken.caret)
                  })
                }}
                className={cn('flex items-center gap-1.5 rounded-md border px-2 py-0.5 pointer-coarse:min-h-9 pointer-coarse:px-3 pointer-coarse:text-sm', i === 0 ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted')}
              >
                <ProjectDot id={p.id} />
                {p.name}
                {i === 0 && <Kbd className="ml-1 h-4 px-1 text-[10px] max-md:hidden">Tab</Kbd>}
              </button>
            ))}
          </div>
        )}
        {/* The people a "+" could be, the first taken with Tab. */}
        {personSuggestion && (
          <div className="flex flex-wrap items-center gap-1 text-xs pointer-coarse:gap-2" aria-live="polite">
            {personSuggestion.people.slice(0, 5).map((p, i) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const taken = takePerson(text, personSuggestion, p)
                  play('confirm')
                  type(taken.text)
                  setCaret(taken.caret)
                  requestAnimationFrame(() => {
                    inputRef.current?.focus()
                    inputRef.current?.setSelectionRange(taken.caret, taken.caret)
                  })
                }}
                className={cn('flex items-center gap-1.5 rounded-md border px-2 py-0.5 pointer-coarse:min-h-9 pointer-coarse:px-3 pointer-coarse:text-sm', i === 0 ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted')}
              >
                <Avatar who={memberOf(p.id)} size="xs" />
                {p.name}
                {i === 0 && <Kbd className="ml-1 h-4 px-1 text-[10px] max-md:hidden">Tab</Kbd>}
              </button>
            ))}
          </div>
        )}
        {/* What was read out of the line, shown as it is typed. */}
        <div className="flex min-h-6 flex-wrap items-center gap-1 text-xs text-faint">
          {!text.trim() ? (
            ui.asGoal ? (
              'The one thing that has to happen today'
            ) : (
              <>
                Try: <span className="text-muted-foreground">call the bank tomorrow p1 @home</span>
              </>
            )
          ) : (
            <>
              {ui.asGoal && (
                <Badge variant="outline" className="text-primary">
                  Today’s goal
                </Badge>
              )}
              {/* A typed date is said back with its weekday: "next friday" alone is easy to misread. */}
              {read.due && <Badge variant="outline">{read.date ? spellDay(read.due, TODAY) : describeDay(read.due, TODAY)}</Badge>}
              {read.priority < 4 && (
                <Badge variant="outline">
                  <PriorityDot priority={read.priority} />
                  {PRIORITY_NAME[read.priority]}
                </Badge>
              )}
              <Badge variant="outline">
                <ProjectDot id={read.projectId} />
                {read.projectId ? projectName(data.projects, read.projectId) : 'Inbox'}
              </Badge>
              {read.assignees.map((id) => (
                <Badge key={id} variant="outline">
                  <Avatar who={memberOf(id)} size="xs" />
                  {memberOf(id).name}
                </Badge>
              ))}
              {!read.title && <span>Add a title</span>}
            </>
          )}
        </div>
        <Separator className="max-md:hidden" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground max-md:hidden">Enter adds the task and keeps this open</span>
          <span className="flex-1" />
          {/* A phone: iOS's plain text buttons, Cancel and a bold Add. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground max-md:h-9 max-md:px-2 max-md:text-body max-md:text-primary max-md:hover:bg-transparent max-md:pointer-coarse:h-11"
            onClick={closeAll}
          >
            <span className="md:hidden">Cancel</span>
            <span className="max-md:hidden">Close</span>
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!read.title}
            className="max-md:h-9 max-md:rounded-full max-md:px-4 max-md:text-body max-md:font-semibold max-md:pointer-coarse:h-11"
          >
            <span className="md:hidden">Add</span>
            <span className="max-md:hidden">Add task</span>
          </Button>
        </div>
      </form>
    </Card>
  )
}

// On a phone the box opens at the top of the screen, over a dimmed page. In
// place of the row, as in a window, it would usually open under the keyboard.
export function MobileQuickAdd() {
  const { ui, closeAll } = useApp()
  const isMobile = useIsMobile()
  if (!isMobile || !ui.adding) return null
  return (
    <div className="fixed inset-0 z-50 animate-in bg-black/40 px-2 pt-[calc(var(--safe-top)+0.5rem)] fade-in" onClick={closeAll}>
      <div onClick={(event) => event.stopPropagation()}>
        <QuickAdd />
      </div>
    </div>
  )
}

// The "Add task" row, which turns into the quick add box.
export function AddRow() {
  const { ui, add } = useApp()
  const isMobile = useIsMobile()
  // On a phone the box is drawn by MobileQuickAdd, and the row stays a row.
  if (ui.adding && !isMobile) return <QuickAdd />
  return (
    <Button variant="ghost" onClick={add} className="h-9 w-full justify-start gap-2.5 px-2 font-normal text-faint hover:text-muted-foreground max-md:h-11 max-md:gap-4 max-md:px-0 max-md:text-base pointer-coarse:h-11">
      <PlusIcon className="size-4.5" />
      Add task
      {/* A phone has no Q to press. */}
      <Kbd className="ml-auto max-md:hidden">Q</Kbd>
    </Button>
  )
}
