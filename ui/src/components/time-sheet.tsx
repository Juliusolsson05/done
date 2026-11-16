// The time sheet: what was focused on during a day, and how long each block
// took against what was planned for it. One day at a time, today first.
import { useEffect, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HeaderButton, ViewHeader } from '@/components/list-view'
import { useApp } from '@/lib/app-context'
import { deleteEntry, loadEntries } from '@/lib/backend'
import { addDays, fullDay, TODAY } from '@/lib/days'
import { onRecorded } from '@/lib/focus-store'
import { clockTime, differenceText, isOver, minutesText, totals, type Entry } from '@/lib/time-sheet'
import { cn } from '@/lib/utils'

const NUMBER = 'px-3 py-2 text-right tabular-nums whitespace-nowrap'

function Difference({ plannedMs, focusedMs }: { plannedMs: number; focusedMs: number }) {
  return (
    <span className={isOver(plannedMs, focusedMs) ? 'text-overdue' : 'text-muted-foreground'}>{differenceText(plannedMs, focusedMs)}</span>
  )
}

export function TimeSheet() {
  const { say } = useApp()
  const [day, setDay] = useState(TODAY)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  // Bumped to read the day again: a block was written down, one was
  // deleted, or the window came back (another window may have added one).
  const [reads, setReads] = useState(0)
  const reread = () => setReads((n) => n + 1)

  useEffect(() => {
    const stop = onRecorded(reread)
    window.addEventListener('focus', reread)
    return () => {
      stop()
      window.removeEventListener('focus', reread)
    }
  }, [])

  useEffect(() => {
    // Only the answer for the day still on screen is shown: paging quickly
    // can leave an earlier day's answer arriving last.
    let current = true
    loadEntries(day).then(
      (rows) => current && setEntries(rows),
      () => current && setEntries([]),
    )
    return () => {
      current = false
    }
  }, [day, reads])

  const remove = (entry: Entry) => {
    setEntries((rows) => rows && rows.filter((e) => e.id !== entry.id))
    deleteEntry(entry.id).then(
      () => say('Removed from the time sheet'),
      () => {
        say('That could not be removed.')
        reread()
      },
    )
  }

  const sum = totals(entries ?? [])

  return (
    <div className="max-w-4xl">
      <ViewHeader title="Time sheet" sub={fullDay(day)}>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Day before" onClick={() => setDay(addDays(day, -1))}>
          <ChevronLeftIcon />
        </Button>
        {day !== TODAY && <HeaderButton onClick={() => setDay(TODAY)}>Today</HeaderButton>}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Day after"
          disabled={day >= TODAY}
          onClick={() => setDay(addDays(day, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </ViewHeader>

      {entries === null ? null : entries.length === 0 ? (
        <p className="text-muted-foreground">
          {day === TODAY ? 'Nothing yet today. Each focus block is written here when it ends.' : 'No focus blocks on this day.'}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-3 text-left font-normal">Time</th>
              <th className="px-3 py-2 text-left font-normal">Worked on</th>
              <th className={cn(NUMBER, 'font-normal')}>Planned</th>
              <th className={cn(NUMBER, 'font-normal')}>Took</th>
              <th className={cn(NUMBER, 'font-normal')}>Difference</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="group border-b border-border/60">
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground tabular-nums">
                  {clockTime(entry.startedAt)}–{clockTime(entry.endedAt)}
                </td>
                <td className="max-w-0 truncate px-3 py-2" title={entry.title}>
                  {entry.title}
                </td>
                <td className={cn(NUMBER, 'text-muted-foreground')}>{minutesText(entry.plannedMs)}</td>
                <td className={NUMBER}>{minutesText(entry.focusedMs)}</td>
                <td className={NUMBER}>
                  <Difference plannedMs={entry.plannedMs} focusedMs={entry.focusedMs} />
                </td>
                <td className="py-1 text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={'Remove from the time sheet: ' + entry.title}
                    onClick={() => remove(entry)}
                  >
                    <XIcon />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-2 pr-3" />
              <td className="px-3 py-2">Total</td>
              <td className={cn(NUMBER, 'text-muted-foreground')}>{minutesText(sum.plannedMs)}</td>
              <td className={NUMBER}>{minutesText(sum.focusedMs)}</td>
              <td className={NUMBER}>
                <Difference plannedMs={sum.plannedMs} focusedMs={sum.focusedMs} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
