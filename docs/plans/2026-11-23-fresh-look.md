# done: a look of its own

Branch `feat/fresh-look` (on `feat/view-filter`) · Worktree `../done-wt/fresh-look`
Status: local preview only, at the owner's request ("only test this locally and let me preview it"). Not for merge until the owner has looked. Size: standard plan.

## Outcome

done stops looking like a default component kit and starts looking like done: calm and neutral, with one colour that means finished.

## Evidence (verified, do not re-derive)

Research (web, 23 Nov 2026):
- Tells of generated UI recur across sources: Inter as the only face; purple and blue gradients; identical rounded cards with a grey 1px border and a soft shadow; uppercase tracked labels; emoji as icons; one uniform gap; every icon the same Lucide size and weight; shadcn defaults left as they are (developersdigest "16 patterns", 925studios, saasui.design, thefountaininstitute, uxplanet).
- Craft signals: Things is about 95% neutral and uses colour only for meaning (Today, deadline); Todoist has one saturated colour and hierarchy from spacing and colour, almost no shadows; Linear's March 2026 refresh: "Don't compete for attention you haven't earned", the sidebar dimmed, separators softened, icons smaller, neutrals moved to a warmer, less saturated grey ("too warm risks looking muddy").
- done today (`ui/src/index.css`, `App.tsx`): system font; cool grey sidebar `#ececef`; the content in a rounded inset sheet with `shadow-sm ring-1`; accent `#2f5fe0`; Today's goal in a bordered `Card`; Lucide icons at one size in the sidebar. Already good: no Inter, no gradients, no emoji, sentence case, colour mostly semantic.

## Design

Tokens:
- Paper `#FCFCFA` (content), shelf `#EDEDEA` (sidebar), ink `#1E1F1D` (text), muted text at the existing steps.
- Done green `#0F7B5F`: primary action, today, the finished check, focus ring. White on it is about 5:1.
- Late and P1 red `#D2402F`, P2 amber `#C98010`, P3 blue `#3A6FD8`. Project 3 moves from green to olive `#5B8C2A`, so no project reads as "done".
- Radius 6px.

Type: Familjen Grotesk (variable, bundled with `@fontsource-variable/familjen-grotesk`, so it works offline) for view titles, Today's goal and note headings on a wide screen; the system face for everything else. The iPhone keeps SF throughout: its large titles are Apple's.

Shell: the content sits flush in the window, divided from the sidebar by a hairline, no shadow or inset card. The sidebar's icons are smaller and dimmed, its active row a slightly darker neutral, not blue.

Today's goal: no box. "Today's goal" in green, the title in the display face, Start focus as a quiet button.

Principle: spend the boldness on the colour of done; everything else recedes.

## Verification

Typecheck, tests, build; screenshots of Today, a project, Board, Timeline, Notes, a phone frame; contrast of green on white and white on green.

## Out of scope

Dark mode, new icons, motion changes, layout restructuring.
