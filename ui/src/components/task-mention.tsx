// Tasks mentioned in a note (see lib/mentions): drawn as the task itself
// when the note is read, as chips above the text while it is written, and
// offered in a list under the caret after an @.
import { useEffect, useState, type ReactNode } from 'react'
import { CheckIcon, ChevronRightIcon, CircleIcon, ListChecksIcon, StarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectDot } from '@/components/marks'
import { NotesText } from '@/components/notes-text'
import { TaskCheck } from '@/components/task-row'
import { useApp } from '@/lib/app-context'
import { loadFinished } from '@/lib/backend'
import { shortDay, TODAY } from '@/lib/days'
import { mentionDetails, type Detail } from '@/lib/mentions'
import { toggleExpanded, useExpanded } from '@/lib/expanded'
import { subtasksOf, type Task } from '@/lib/tasks'
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
  const { data, complete, reopen, reveal } = useApp()
  const task = useMentioned(id)
  // Whether its subtasks show: the same state as in the lists, so a task
  // opened here is open there too.
  const open = useExpanded(id)
  if (!task)
    return (
      <span className="text-muted-foreground" title={task === null ? 'This task was deleted' : undefined}>
        {fallback}
      </span>
    )
  const done = !!task.done
  const details = mentionDetails(task, data.tasks, data.projects, TODAY)
  const subtasks = subtasksOf(data.tasks, task.id)
  const toggle = (t: Task) => (t.done ? reopen(t.id) : complete(t.id))
  // Spans only, laid out as a card: it sits inside a paragraph, a list item
  // or a table cell, where a block element would be invalid HTML.
  return (
    <span
      data-mention={task.id}
      className="my-0.5 inline-flex max-w-full min-w-0 items-start gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1.5 align-middle leading-snug"
    >
      <TaskCheck task={task} checked={done} onChange={() => toggle(task)} className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => reveal(hit(task))}
            className={cn('min-w-0 truncate text-left font-medium hover:underline', done && 'text-muted-foreground line-through')}
          >
            {task.title}
          </button>
          {task.goalDay === TODAY && !done && <StarIcon className="size-3.5 shrink-0 fill-current text-amber-500" aria-label="Today’s goal" />}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {details.map((detail) =>
            detail.kind === 'subtasks' ? (
              // The count is also the way to show or hide the subtasks.
              <button
                key="subtasks"
                type="button"
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} subtasks of ${task.title}`}
                onClick={() => toggleExpanded(task.id)}
                className="flex items-center gap-1 rounded tabular-nums hover:text-foreground"
              >
                <ChevronRightIcon className={cn('size-3 transition-transform', open && 'rotate-90')} />
                <ListChecksIcon className="size-3" />
                {detail.done}/{detail.total}
              </button>
            ) : (
              <MentionDetail key={detail.kind} detail={detail} />
            ),
          )}
        </span>
        {/* The whole description, as written, with its web links clickable. */}
        {task.notes.trim() && <NotesText notes={task.notes.trim()} onEdit={() => reveal(hit(task))} className="mt-0.5 whitespace-pre-wrap" />}
        {open && subtasks.length > 0 && (
          <span className="mt-1 flex flex-col gap-1" aria-label={`Subtasks of ${task.title}`}>
            {subtasks.map((sub) => (
              <span key={sub.id} data-task={sub.id} className="flex min-w-0 items-start gap-2">
                <TaskCheck task={sub} checked={!!sub.done} onChange={() => toggle(sub)} className="mt-0.5 size-3.5" />
                <span className="flex min-w-0 flex-col">
                  <span className={cn('min-w-0 text-sm', sub.done && 'text-muted-foreground line-through')}>{sub.title}</span>
                  {sub.notes.trim() && <NotesText notes={sub.notes.trim()} onEdit={() => reveal(hit(task))} className="whitespace-pre-wrap" />}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  )
}

function MentionDetail({ detail }: { detail: Exclude<Detail, { kind: 'subtasks' }> }) {
  switch (detail.kind) {
    case 'project':
      return (
        <span className="flex items-center gap-1">
          <ProjectDot id={detail.id} className="size-1.5" />
          {detail.name}
        </span>
      )
    case 'when':
      return <span className={cn('tabular-nums', detail.late && 'text-overdue')}>{detail.text}</span>
    case 'doing':
      return <span className="text-primary">In progress</span>
  }
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
