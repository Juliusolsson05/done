// Focus: one countdown on one task. Before a session it asks what and for how
// long; during one it shows the time left, as large as the type scale goes.
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { ChevronRightIcon, XIcon } from 'lucide-react'
import { Length } from '@/components/focus-length'
import { FocusPicker } from '@/components/focus-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ViewHeader } from '@/components/list-view'
import { UpNext } from '@/components/up-next'
import { useApp } from '@/lib/app-context'
import { TODAY } from '@/lib/days'
import { chosenMinutes, clockText, focusTasks, MAX_MINUTES, optionsSummary, timeLeft, type Session } from '@/lib/focus'
import {
  addReminder,
  continueFocus,
  endFocus,
  getReminders,
  getUpNext,
  moreFocus,
  removeReminder,
  startFocus,
  startNext,
  subscribeFocus,
  toggleFocus,
} from '@/lib/focus-store'
import { goalTask } from '@/lib/tasks'
import { minutesText } from '@/lib/time-sheet'
import { cn } from '@/lib/utils'

// The time left, as text that keeps itself current. The ticking stays in
// here, so four times a second only these digits are redrawn, not the app.
export function Countdown({ session }: { session: Session }) {
  const read = () => clockText(timeLeft(session, Date.now()))
  // Only a reason to draw again: React skips the redraw while the text is
  // the same, and what is shown is always read fresh from the clock.
  const [, setShown] = useState(read)
  useEffect(() => {
    // Paused or ended, the text does not change.
    if (session.endsAt === null || session.ended) return
    const timer = setInterval(() => setShown(clockText(timeLeft(session, Date.now()))), 250)
    return () => clearInterval(timer)
  }, [session])
  return read()
}

// The chosen task is kept as a string, where "no task" has a name.
const NOTHING = 'none'
const FIELD_LABEL = 'text-xs text-muted-foreground'

// What to be told during a session, and how often. The list is remembered
// between sessions; with none, only the row to add one is shown.
function Reminders() {
  const reminders = useSyncExternalStore(subscribeFocus, getReminders)
  const [label, setLabel] = useState('')
  const [minutes, setMinutes] = useState('')
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!addReminder(label, Number(minutes))) return
    setLabel('')
    setMinutes('')
  }

  return (
    <div className="flex flex-col gap-2">
      <Label id="focus-reminders" className={FIELD_LABEL}>
        Reminders
      </Label>
      {reminders.length > 0 && (
        <ul aria-labelledby="focus-reminders" className="flex flex-col">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{reminder.label}</span>
              <span className="text-muted-foreground tabular-nums">every {reminder.intervalMinutes} min</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={'Remove reminder: ' + reminder.label}
                onClick={() => removeReminder(reminder.id)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex items-center gap-1">
        <Input
          placeholder="Stand up and stretch"
          aria-label="Reminder"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-7 flex-1"
        />
        <span className="px-1 text-muted-foreground">every</span>
        <Input
          type="number"
          min={1}
          max={MAX_MINUTES}
          placeholder="min"
          aria-label="Every how many minutes"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="h-7 w-20"
        />
        <Button type="submit" variant="outline" size="sm">
          Add
        </Button>
      </form>
    </div>
  )
}

// Starts the first block in Up next, naming it and its length. Nothing
// when the list is empty.
function StartNext({ variant }: { variant: 'default' | 'outline' }) {
  const { shown: { tasks } } = useApp()
  const next = useSyncExternalStore(subscribeFocus, getUpNext)[0]
  if (!next) return null
  return (
    <Button variant={variant} className="max-w-full" onClick={() => startNext(tasks)}>
      <span className="truncate">Start next: {next.title}</span>
      <span className="opacity-70 tabular-nums">· {minutesText(next.minutes * 60000)}</span>
    </Button>
  )
}

// Asking for more time when it is up. Counts toward the time taken, not the
// time planned, which is the point of the time sheet.
const MORE = [5, 10, 15]

// Reminders and Up next, folded away: most sessions need neither. What is
// set shows on the folded line, so nothing set is ever out of sight.
function Options() {
  const reminders = useSyncExternalStore(subscribeFocus, getReminders)
  const blocks = useSyncExternalStore(subscribeFocus, getUpNext)
  const [open, setOpen] = useState(false)
  const summary = optionsSummary(reminders, blocks)

  return (
    <section className="flex flex-col gap-4 border-t pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="focus-options"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-muted"
      >
        <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 font-medium">Options</span>
        <span className={cn('min-w-0 truncate', summary ? 'text-muted-foreground' : 'text-faint')}>{summary || 'Reminders and Up next'}</span>
      </button>
      {/* Hidden, not removed, so a reminder half typed is still there when
          the options are opened again. */}
      <div id="focus-options" hidden={!open} className="flex flex-col gap-6 pb-2">
        <Reminders />
        <div className="flex flex-col items-start gap-2">
          <Label className={FIELD_LABEL}>After this block</Label>
          <UpNext />
        </div>
      </div>
    </section>
  )
}

function Setup() {
  const { shown, me, ui, chooseFocus } = useApp()
  const tasks = focusTasks(shown.tasks, TODAY)
  const goal = goalTask(shown.tasks, TODAY, me)
  const goalId = goal && !goal.done ? goal.id : null
  const wanted = ui.focusPick ?? (goalId !== null ? String(goalId) : NOTHING)
  // The task chosen earlier may have been finished or deleted since.
  const chosen = tasks.find((t) => String(t.id) === wanted) ?? null
  const [typed, setTyped] = useState('')
  const length = chosenMinutes(typed, ui.focusMinutes)

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="focus-task" className={FIELD_LABEL}>
          What are you working on?
        </Label>
        <FocusPicker id="focus-task" chosen={chosen} onChoose={(task) => chooseFocus({ focusPick: task ? String(task.id) : NOTHING })} />
      </div>
      <Length
        labelId="focus-length"
        typed={typed}
        setTyped={setTyped}
        length={length}
        onChoose={(focusMinutes) => chooseFocus({ focusMinutes })}
      />
      <div className="flex flex-wrap gap-2">
        <Button className="touch:h-11 touch:px-5" onClick={() => startFocus(chosen, length)}>
          Start focus
        </Button>
        {/* With blocks queued, the first of them can be started from here too:
            after a Stop, or to begin a day already planned. */}
        <StartNext variant="outline" />
      </div>
      <Options />
    </div>
  )
}

function Running({ session }: { session: Session }) {
  const { data, complete } = useApp()
  const paused = session.endsAt === null
  const finishTask = () => {
    const id = session.taskId
    endFocus(false)
    // It may have been deleted, or finished elsewhere, while the clock ran.
    if (id !== null && data.tasks.some((t) => t.id === id)) complete(id)
  }
  const queued = useSyncExternalStore(subscribeFocus, getUpNext).length > 0
  // When something is queued, starting it is the main thing to do at the end,
  // so finishing the task steps back beside it.
  const finish = session.taskId !== null && (
    <Button variant={session.ended && queued ? 'outline' : 'default'} onClick={finishTask}>
      Finish task
    </Button>
  )

  // A reminder takes the place of the countdown until it is dismissed.
  if (session.reminding)
    return (
      <div className="flex min-h-96 flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="text-sm text-muted-foreground">Reminder</div>
        <div className="max-w-xl text-4xl leading-tight font-medium tracking-tight wrap-anywhere sm:text-5xl">{session.reminding.label}</div>
        <div className="mb-4 text-muted-foreground tabular-nums">
          Paused with <Countdown session={session} /> left
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={continueFocus}>Continue</Button>
          <Button variant="ghost" className="text-muted-foreground" onClick={endFocus}>
            Stop
          </Button>
        </div>
      </div>
    )

  return (
    <div className="flex min-h-96 flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="text-sm text-muted-foreground">{session.ended ? 'Time is up' : paused ? 'Paused' : 'Focusing on'}</div>
      <div className="max-w-xl text-lg font-medium wrap-anywhere">{session.title}</div>
      <div
        className={cn('mt-2 mb-4 text-7xl leading-none font-medium tracking-tight tabular-nums sm:text-8xl lg:text-9xl', paused && 'text-faint')}
      >
        <Countdown session={session} />
      </div>
      {session.ended ? (
        <div className="flex max-w-2xl flex-col items-center gap-3">
          <StartNext variant="default" />
          <div className="flex flex-wrap justify-center gap-2">
            {finish}
            {MORE.map((minutes) => (
              <Button key={minutes} variant="outline" onClick={() => moreFocus(minutes)}>
                +{minutes} min
              </Button>
            ))}
            <Button variant="ghost" className="text-muted-foreground" onClick={endFocus}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={toggleFocus}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          {finish}
          <Button variant="ghost" className="text-muted-foreground" onClick={endFocus}>
            Stop
          </Button>
        </div>
      )}
    </div>
  )
}

export function FocusView() {
  const { focus } = useApp()
  return (
    <>
      {/* Before a session, Up next is under Options; during one it stays at
          hand, to plan what follows while the clock runs. */}
      <ViewHeader title="Focus">{focus && <UpNext />}</ViewHeader>
      {focus ? <Running session={focus} /> : <Setup />}
    </>
  )
}
