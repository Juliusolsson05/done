// Focus: one countdown on one task. Before a session it asks what and for how
// long; during one it shows the time left, as large as the type scale goes.
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ViewHeader } from '@/components/list-view'
import { UpNext } from '@/components/up-next'
import { useApp } from '@/lib/app-context'
import { TODAY } from '@/lib/days'
import { chosenMinutes, clockText, focusTasks, MAX_MINUTES, presetLabel, PRESETS, timeLeft, type Session } from '@/lib/focus'
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

// A select cannot have an empty value, so "no task" has a name.
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
  const { data } = useApp()
  const next = useSyncExternalStore(subscribeFocus, getUpNext)[0]
  if (!next) return null
  return (
    <Button variant={variant} className="max-w-full" onClick={() => startNext(data.tasks)}>
      <span className="truncate">Start next: {next.title}</span>
      <span className="opacity-70 tabular-nums">· {minutesText(next.minutes * 60000)}</span>
    </Button>
  )
}

// Asking for more time when it is up. Counts toward the time taken, not the
// time planned, which is the point of the time sheet.
const MORE = [5, 10, 15]

function Setup() {
  const { data, ui, chooseFocus } = useApp()
  const [typed, setTyped] = useState('')
  const tasks = focusTasks(data.tasks, TODAY)
  const goal = goalTask(data.tasks, TODAY)
  const wanted = ui.focusPick ?? (goal && !goal.done ? String(goal.id) : NOTHING)
  // The task chosen earlier may have been finished or deleted since.
  const pick = tasks.some((t) => String(t.id) === wanted) ? wanted : NOTHING

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="focus-task" className={FIELD_LABEL}>
          What are you working on?
        </Label>
        <Select value={pick} onValueChange={(focusPick) => chooseFocus({ focusPick })}>
          <SelectTrigger id="focus-task" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOTHING}>Nothing in particular</SelectItem>
            {tasks.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.title}
                {t.goalDay === TODAY && ' (today’s goal)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label id="focus-length" className={FIELD_LABEL}>
          For how long?
        </Label>
        <div className="flex flex-wrap items-center gap-1">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-labelledby="focus-length"
            className="flex-wrap"
            value={String(ui.focusMinutes)}
            onValueChange={(value) => {
              // Pressing the chosen one again would leave no length at all.
              if (value) chooseFocus({ focusMinutes: Number(value) })
              // The field wins when filled, so choosing a button empties it.
              setTyped('')
            }}
          >
            {PRESETS.map((minutes) => (
              <ToggleGroupItem key={minutes} value={String(minutes)}>
                {presetLabel(minutes)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Input
            type="number"
            min={1}
            max={MAX_MINUTES}
            placeholder="min"
            aria-label="Minutes"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-7 w-20"
          />
        </div>
      </div>
      <Reminders />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => startFocus(tasks.find((t) => String(t.id) === pick) ?? null, chosenMinutes(typed, ui.focusMinutes))}>
          Start focus
        </Button>
        {/* With blocks queued, the first of them can be started from here too:
            after a Stop, or to begin a day already planned. */}
        <StartNext variant="outline" />
      </div>
    </div>
  )
}

function Running({ session }: { session: Session }) {
  const { data, complete } = useApp()
  const paused = session.endsAt === null
  const finishTask = () => {
    const id = session.taskId
    endFocus()
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
      <ViewHeader title="Focus">
        <UpNext />
      </ViewHeader>
      {focus ? <Running session={focus} /> : <Setup />}
    </>
  )
}
