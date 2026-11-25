# Timeline: the Mac gets its 23 Nov design back

Branch `fix/timeline-desktop-back` · Worktree `../done-wt/timeline-desktop-back` · Base `origin/main` @ 2a03f9a (2026-11-24)

## Outcome

On the Mac and in a desktop browser the Timeline looks and works exactly as it did on 23 Nov (5161a05, end of #60): soft blocks with the title inside or beside, weekdays above, drag by the title, stretch from the end. iPhone and iPad keep the touch rebuild from #65.

## Evidence

- `docs/plans/2026-11-24-timeline-rebuild.md` set out to rebuild the Timeline "to work at every size", and commit 0520a7d replaced the desktop design too ("titles in a fixed left column ... at every size", "Bars carry no text").
- That plan's verification line: "No browser available to this agent: the owner checks the five sizes in the preview." The desktop view was never compared before #65 merged (four branches in one PR).
- Owner, 24 Nov: the mobile change "made it look shit compared to how it looked like before".

## Decisions

1. **Two components, chosen by layout.** `timeline-desktop.tsx` is 5161a05's `timeline.tsx` unchanged except its export name (`TimelineDesktop`). `App.tsx` renders it when `useLayout()` is `desktop`; `phone` and `tablet` keep `Timeline` from #65. — why: restoring the exact file is the only way to get exactly the look that was approved; merging the two designs is how the regression happened. — cost if wrong: two Timeline files to keep in step until one design is chosen for all sizes.
2. Nothing in the #65 Timeline changes, so the iPhone and iPad keep their fixes (hold-to-drag, safe areas, bounded height).

## Tests

`npm run typecheck`, `npm test`, `npm run build` in `ui/`. Preview on a copy of the tasks in a desktop browser before merge.

## Not verified

The iPad and iPhone, which this change does not touch.
