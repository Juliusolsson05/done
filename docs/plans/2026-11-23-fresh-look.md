# done: a look of its own

Fixes #46.
Branch `feat/fresh-look` (on `feat/view-filter`) · Worktree `../done-wt/fresh-look`
Status: the owner compared green, red and ink blue in local previews and chose ink blue; asked to merge it. Size: standard plan.

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
- done's ink blue `#1E4FBF` (final; green and red were tried first, see the notes): primary action, today, where you are, the finished check, focus ring. White on it is about 7:1.
- Late, P1 and destructive red `#D2402F`, P2 amber `#C98010`, P3 blue `#3A6FD8`.
- Radius 6px.

Type: Familjen Grotesk (variable, bundled with `@fontsource-variable/familjen-grotesk`, so it works offline) for view titles, Today's goal and note headings on a wide screen; the system face for everything else. The iPhone keeps SF throughout: its large titles are Apple's.

Shell: the content sits flush in the window, divided from the sidebar by a hairline, no shadow or inset card. The sidebar's icons are smaller and dimmed, its active row a slightly darker neutral, not blue.

Today's goal: no box. "Today's goal" in the accent, the title in the display face, Start focus as a quiet button.

Principle: spend the boldness on done's one colour, in small touches; everything else recedes.

## Verification

Typecheck, tests, build; screenshots of Today, a project, Board, Timeline, Notes, a phone frame; contrast of the accent on white and white on the accent.

## Out of scope

Dark mode, new icons, motion changes, layout restructuring.

## Execution notes

- Owner, after the first pass: "not a fan of the green color, test blue or red". Both were compared in the preview (ink blue #1E4FBF, signal red #D23A2A) through a temporary address switch, since removed.
- Owner: "I do like red the most, sneak in the accent a little more while still making it clean". Ruling: red #D23A2A is done's colour; late moves to burnt orange #E0731C, so a late date never reads as the brand and today's goal never reads as a warning — cost if wrong: one token. P1 keeps red: the most important tasks wear the brand colour. Project 3 goes back to green, as green no longer means anything else.
- More red, as small touches, not surfaces: the active sidebar row (a 10% wash, red icon, ink text), today's goal's check ring, links in notes, the text selection and the caret.
- Owner, after comparing red (4483, late in orange) and ink blue (4484, late in red) with the same accent touches: "lets go with blue that makes the most sense". Final: ink blue #1E4FBF is done's colour with every accent touch above; red #D2402F goes back to meaning late, P1 and destructive; the burnt orange is dropped.
