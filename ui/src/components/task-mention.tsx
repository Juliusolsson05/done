// Tasks mentioned in a note (see lib/mentions): drawn as the task itself
// when the note is read, as chips above the text while it is written, and
// offered in a list under the caret after an @.
import { useEffect, useState, type ReactNode } from 'react'
import { CheckIcon, CircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ProjectDot } from '@/components/marks'
import { useApp } from '@/lib/app-context'
import { loadFinished } from '@/lib/backend'
import { shortDay, TODAY } from '@/lib/days'
import type { Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

// The window only holds open tasks and those finished today. A mention of a
// task finished earlier is looked up in the Completed list, fetched once and
// kept for a short while, since a note can mention many.
let finished: { at: number; list: Promise<Task[]> } | null = null
const FRESH_MS = 15_000
function finishedTasks(): Promise<Task[]> {
  if (!finished || Date.now() - finished.at > FRESH_MS) finished = { at: Date.now(), list: loadFinished().catch(() => []) }
  return finished.list
}

// The task a mention points at: from the window if it is there, else from
// the Completed list. Undefined while that is being asked; null if neither
// has it (it was deleted).
function useMentioned(id: number): Task | null | undefined {
  const { data } = useApp()
  const here = data.tasks.find((t) => t.id === id)
  const [elsewhere, setElsewhere] = useState<Task | null | undefined>(undefined)
  useEffect(() => {
    if (here) return
    let live = true
    void finishedTasks().then((list) => {
      if (live) setElsewhere(list.find((t) => t.id === id) ?? null)
    })
    return () => {
      live = false
    }
  }, [id, here])
  return here ?? elsewhere
}

const hit = (task: Task) => ({ kind: 'task' as const, id: task.id, title: task.title, detail: '', done: !!task.done })

// A mentioned task in a note being read: its round check, its title as it is
// now, its due date and project. The check finishes or reopens it; the title
// takes you to it in its list.
export function TaskMention({ id, fallback }: { id: number; fallback: ReactNode }) {
  const { complete, reopen, reveal } = useApp()
  const task = useMentioned(id)
  if (!task)
    return (
      <span className="text-muted-foreground" title={task === null ? 'This task was deleted' : undefined}>
        {fallback}
      </span>
    )
  const done = !!task.done
  return (
    <span
      data-mention={task.id}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-1.5 align-[-0.2em] leading-6"
    >
      <Checkbox
        checked={done}
        onCheckedChange={() => (done ? reopen(task.id) : complete(task.id))}
        aria-label={`${done ? 'Reopen' : 'Complete'}: ${task.title}`}
        className="size-3.5 rounded-full"
      />
      <button
        type="button"
        onClick={() => reveal(hit(task))}
        className={cn('min-w-0 truncate text-left hover:underline', done && 'text-muted-foreground line-through')}
      >
        {task.title}
      </button>
      {/* Late is red, as everywhere else in the app. */}
      {task.due && !done && (
        <span className={cn('shrink-0 text-xs tabular-nums', task.due < TODAY ? 'text-overdue' : 'text-muted-foreground')}>{shortDay(task.due)}</span>
      )}
      {task.projectId != null && <ProjectDot id={task.projectId} className="size-1.5 shrink-0" />}
    </span>
  )
}

function MentionChip({ id }: { id: number }) {
  const { reveal } = useApp()
  const task = useMentioned(id)
  if (!task) return null
  return (
    <Button variant="outline" size="xs" onClick={() => reveal(hit(task))} className="max-w-64 font-normal text-muted-foreground">
      {task.done ? <CheckIcon /> : <CircleIcon />}
      <span className={cn('truncate', task.done && 'line-through')}>{task.title}</span>
    </Button>
  )
}

// While writing, the tasks the note mentions, to go to with one click (the
// note's text shows them as links, which are not clickable in a textarea).
export function MentionChips({ ids }: { ids: number[] }) {
  if (ids.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Tasks in this note">
      {ids.map((id) => (
        <MentionChip key={id} id={id} />
      ))}
    </div>
  )
}

// Where a position in a textarea is drawn, relative to the textarea: a hidden
// copy with the same box and type is filled up to that position, and a mark
// placed there is measured. The textarea grows with its text, so it never
// scrolls inside itself and no scroll offset is needed.
const MIRRORED = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'tab-size',
]
export function caretPoint(field: HTMLTextAreaElement, position: number): { top: number; left: number; lineHeight: number } {
  const style = getComputedStyle(field)
  const mirror = document.createElement('div')
  for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name))
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.textContent = field.value.slice(0, position)
  const mark = document.createElement('span')
  mark.textContent = field.value.slice(position) || '.'
  mirror.appendChild(mark)
  document.body.appendChild(mirror)
  const point = { top: mark.offsetTop, left: mark.offsetLeft, lineHeight: parseFloat(style.lineHeight) || 28 }
  mirror.remove()
  return point
}

// The tasks offered after an @, just under the line being written.
export function MentionPicker({
  tasks,
  chosen,
  at,
  onPick,
  onHover,
}: {
  tasks: Task[]
  chosen: number
  at: { top: number; left: number }
  onPick(task: Task): void
  onHover(index: number): void
}) {
  return (
    <div
      role="listbox"
      aria-label="Tasks"
      style={{ top: at.top, left: at.left }}
      className="absolute z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md"
      // A click on the list must not take focus from the note being written.
      onMouseDown={(event) => event.preventDefault()}
    >
      {tasks.map((task, i) => (
        <div
          key={task.id}
          role="option"
          aria-selected={i === chosen}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(task)}
          className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5', i === chosen && 'bg-accent text-accent-foreground')}
        >
          <CircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          {task.due && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortDay(task.due)}</span>}
          {task.projectId != null && <ProjectDot id={task.projectId} className="size-1.5 shrink-0" />}
        </div>
      ))}
    </div>
  )
}
