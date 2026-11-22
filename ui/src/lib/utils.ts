import { createCn } from 'cn/config'

// Joins class names and lets the later of two conflicting ones win. Told
// about the theme's own text sizes (index.css): without that, `text-body`
// looks like a colour to it, and a colour after it would remove it.
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['body', 'subhead', 'footnote', 'caption', 'title', 'large-title', 'tab'] }] } },
})
