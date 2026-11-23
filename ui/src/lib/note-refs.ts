// The tasks and links a note points at, shown above it while writing. A few
// are shown as they are; more than that fold into one line, opened with +,
// so a long list does not push the note itself down the page.

// Up to this many show without folding.
export const SHOWN_OPEN = 4

export const folds = (tasks: number, links: number): boolean => tasks + links > SHOWN_OPEN

// "12 tasks and 3 links", "1 task", "2 links".
export function summary(tasks: number, links: number): string {
  const part = (n: number, one: string) => (n === 0 ? '' : `${n} ${one}${n === 1 ? '' : 's'}`)
  return [part(tasks, 'task'), part(links, 'link')].filter(Boolean).join(' and ')
}

// Which notes were opened up this session. Kept in memory only: a note read
// again tomorrow starts folded, as it is meant to.
const opened = new Set<number>()
export const isOpened = (note: number): boolean => opened.has(note)
export function setOpened(note: number, open: boolean) {
  if (open) opened.add(note)
  else opened.delete(note)
}
