// Finds the web addresses in a task's notes, so they can be shown as links.
// Plain text otherwise: no markdown, nothing but http(s) and www. addresses.

export type Part = { text: string; href?: string }

const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi
// A sentence often ends right after an address: "see https://x.com." The
// full stop belongs to the sentence, not the link.
const TRAILING = /[.,;:!?'"]+$/

// An address in brackets, "(https://x.com)", keeps its closing bracket out,
// but a bracket that is part of it, "wiki/Done_(app)", stays in.
const trimEnd = (url: string): string => {
  let end = url.replace(TRAILING, '')
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ]) {
    while (end.endsWith(close) && end.split(close).length > end.split(open).length) end = end.slice(0, -1).replace(TRAILING, '')
  }
  return end
}

export function linkParts(text: string): Part[] {
  const parts: Part[] = []
  let at = 0
  for (const match of text.matchAll(ADDRESS)) {
    const url = trimEnd(match[0])
    const start = match.index
    if (start > at) parts.push({ text: text.slice(at, start) })
    parts.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    at = start + url.length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
