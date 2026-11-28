// "For how long?": three lengths most blocks use, and "Other" for the rest:
// the other presets and a length of your own. Used by the Focus page and by
// Up next, so a length is chosen the same way in both.
import { useState, type FormEvent } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { COMMON, MAX_MINUTES, presetLabel, PRESETS } from '@/lib/focus'
import { minutesText } from '@/lib/time-sheet'

// Other names the length when it is the one chosen, so a choice made there
// is seen without opening it.
// `length` is what will be used: the typed minutes when they are a usable
// number (the field wins, as it always has), else the chosen button. The
// owner works it out with chosenMinutes and reads it directly, so pressing
// Start or Add straight from the field never depends on the popover closing
// first.
export function Length({
  labelId,
  label = 'For how long?',
  typed,
  setTyped,
  length,
  onChoose,
}: {
  labelId: string
  label?: string
  typed: string
  setTyped: (typed: string) => void
  length: number
  onChoose: (minutes: number) => void
}) {
  const [open, setOpen] = useState(false)
  const other = !COMMON.includes(length)
  // Choosing a button empties the field, or the field would still win.
  const choose = (minutes: number) => {
    onChoose(minutes)
    setTyped('')
    setOpen(false)
  }
  // Leaving the popover (Set, Enter, a tap outside) keeps the typed length
  // as the one chosen.
  const close = (next: boolean) => {
    setOpen(next)
    if (!next && typed.trim()) onChoose(length)
  }
  const own = (event: FormEvent) => {
    event.preventDefault()
    close(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label id={labelId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {/* Wraps only if it must: a 320-wide phone with "1 h 30 min" chosen. */}
      <div className="flex flex-wrap items-center gap-1">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          aria-labelledby={labelId}
          value={other ? '' : String(length)}
          // Pressing the chosen one again would leave no length at all.
          onValueChange={(value) => value && choose(Number(value))}
        >
          {COMMON.map((minutes) => (
            <ToggleGroupItem key={minutes} value={String(minutes)} className="touch:h-10 touch:px-3">
              {presetLabel(minutes)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Popover open={open} onOpenChange={close}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-pressed={other} className="aria-pressed:bg-muted touch:h-10 touch:px-3">
              {other ? minutesText(length * 60000) : 'Other'}
              <ChevronDownIcon className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-64 flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-1">
              {PRESETS.filter((minutes) => !COMMON.includes(minutes)).map((minutes) => (
                <Button
                  key={minutes}
                  variant="outline"
                  aria-pressed={length === minutes}
                  className="aria-pressed:bg-muted touch:h-11"
                  onClick={() => choose(minutes)}
                >
                  {presetLabel(minutes)}
                </Button>
              ))}
            </div>
            <form onSubmit={own} className="flex items-center gap-1">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_MINUTES}
                placeholder="Minutes"
                aria-label="Minutes"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="flex-1 text-base md:text-sm touch:h-11"
              />
              <Button type="submit" variant="outline" className="touch:h-11">
                Set
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
