// Find on the page (Cmd+F): where a piece of text occurs in what is shown.
// Kept apart from the bar so it can be tested without a browser.

// Each place the query occurs in the text, case ignored, as [start, end).
export function occurrences(text: string, query: string): [number, number][] {
  const needle = query.toLowerCase()
  if (!needle.trim()) return []
  const hay = text.toLowerCase()
  // Lower-casing can change a string's length in rare scripts; then the
  // offsets would not line up, so such text is skipped rather than mis-marked.
  if (hay.length !== text.length) return []
  const found: [number, number][] = []
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) found.push([at, at + needle.length])
  return found
}

// Moving from one match to the next or the one before, wrapping around.
export const step = (current: number, count: number, by: 1 | -1): number => (count === 0 ? 0 : (current + by + count) % count)
