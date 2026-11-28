# One filter for every task view

Step 1 (the library): fixed #114, merged. Steps 2 to 5: one PR, feat/filter-views, base 28e05f8 (after #116/#126, #118, #119, #122, #99). Fixes #115.

## Outcome

Step 1 of 5: the pure filter library every task view will share, and P0 made choosable in the filter Board and Timeline already have. No view gains or loses a filter in this step.

## What is there now

- One filter exists: `lib/view-filter.ts` + `components/view-filter.tsx`, on Board and Timeline only. Words, projects, people (Me / Nobody / member), priorities, a when-window. Button in the header (popover on desktop and tablet, bottom sheet on phone), a chip bar with "x of y tasks" and Clear, `NothingMatches` when nothing is left, F opens it.
- Every other list (Inbox, Today, Upcoming, project, Assigned to me, Completed) has no filter.
- Five text matchers that disagree (filter, Cmd+K, Focus picker, @mentions, Cmd+F). "cafe" finds "Café" in Cmd+K and the Focus picker but not in the Board filter; "hop" finds every Hop task in the Focus picker but not in the filter.
- Bug: P0 can never be chosen. `cleanFilter` keeps only priorities 1 to 4 (view-filter.ts:124), and `useViewFilter` (components/view-filter.tsx:37) runs it on every read, so P0 is gone before it is applied. No test covered it.

**Decision: grow the filter that exists onto every task list.** Do not build a second one.

## The dimensions

| Dimension | Kept | Why |
|---|---|---|
| Words | yes | the most common need. `matchesQuery` from lib/search.ts over title, notes and project name: the Focus picker's matching (folded, any word order) plus notes, which the filter searches today |
| Project | yes, several | "Hop and Catch Up" is a real need on Today, Board and Timeline |
| Person | yes, only when the scope has workspaces | Me, Nobody, each member. A two-person team needs "mine" and "nobody's" |
| Priority | yes, several, P0 to none | cheap, and already there. Fix P0 |
| When | yes: Late, Today, This week, No date | **"Next two weeks" goes**: one more chip, and This week plus the Timeline cover it. A stored `fortnight` is read back as `week` |
| Status (to do / doing / done) | **no** | Board columns are status, Completed is done, every list is open tasks. A status choice would mostly empty the view |
| Labels, created date, has-subtasks | no | the app has no labels; nobody has asked for the others |

## One control, one interaction (steps 2 to 5)

- **Where:** a `Filter` button at the right end of each task view's header (`ViewHeader` / `PhoneHeader` children), where Board has it now. Desktop and tablet: a popover. Phone: a bottom sheet.
- **F** opens it on every task surface (App.tsx tests `offered(view)` rather than board/timeline). Cmd+F and Cmd+K do not change.
- **When a filter is on:** the button shows the number of active choices; the chip bar shows each choice with an ×, then "8 of 23 tasks" and Clear.
- **Empty result:** "No tasks match the filter" and "Clear the filter", in place of the view's own empty text, which shows only when there are no tasks before filtering.
- **Adding a task** on a filtered page gets `addDefaults` on every surface.

## Global, and how long it lasts

- **Global:** one filter for all task views. A dimension the view already fixes is not shown there and does not apply there (table below).
- **It lasts until the app is closed.** It moves from localStorage to sessionStorage (`done-view-filter`) in step 2. *Ruling: today it is kept for ever (view-filter-store.ts:2-4). Why: a forgotten filter that hides tasks the next morning is how people get lost, and setting one again takes two keys. Cost if wrong: the owner sets the same filter after each launch; going back is one line.*
- **Things that stop you getting lost:**
  1. The chip bar shows on every view while a filter is on, even when the view hides some chips: "Filter on: 2 hidden here · 8 of 23 · Clear".
  2. Sidebar counts, Lists cards, the tab badge, the widget and MCP never use the filter.
  3. When the scope changes, projects not in the new scope are dropped from the filter.
- The Timeline's zoom and grouping, and Assigned to me's "Only me", stay as they are.

## How it fits each view

| Surface | Offered | Fixed by the view |
|---|---|---|
| Inbox | words, priority, when | project (Inbox); person (personal) |
| Today | words, project, person, priority | when. The goal block is never filtered |
| Upcoming | words, project, person, priority | when (future) |
| Project (personal or workspace) | words, person, priority, when | project |
| Assigned to me | words, project, priority, when | person = Me (Only me stays) |
| Board | all five | status (the columns) |
| Timeline, desktop and touch | all five | none. "No date" leaves the chart empty, so it shows only the No date list |
| Completed | words, project, priority | when (finished day), status. Person is not offered until finished tasks carry assignees |
| Search, Find, Focus and Up next pickers, @mention | no filter; they use the same `matchTask` words matcher | search, not lists |
| Time sheet, note task cards, counts, widget, MCP | never filtered | not lists, or they count what exists |

Sort and group are not in the filter: each view's order is part of what it means.

## Data shape (ui/src/lib/view-filter.ts)

```ts
export type When = 'any' | 'late' | 'today' | 'week' | 'fortnight' | 'none'   // fortnight goes in step 3
export type Dimension = 'words' | 'projects' | 'people' | 'priorities' | 'when'

export interface ViewFilter {
  words: string                // every word, folded, over title, notes and project name
  projects: (number | null)[]  // null = Inbox; empty = all
  people: string[]             // 'me' | 'nobody' | account id; empty = anyone
  priorities: number[]         // 0..4; empty = all
  when: When
}

export interface FilterContext {
  today: Day
  me: string | null
  projects: Pick<Project, 'id' | 'name'>[]  // the scope's projects: names for words, and which ids still count
  fixed: readonly Dimension[]               // what the view decides; skipped
}

export function applyFilter(tasks: Task[], filter: ViewFilter, ctx: FilterContext): Task[]
export function matchTask(task: Task, words: string, projects: FilterContext['projects']): boolean
export function offered(view: View): Dimension[] | null   // null = this view has no filter
export function fixedFor(view: View): Dimension[]
```

`matchesFilter` goes away once its callers use `applyFilter` (step 3). `filterChips` gets `fixed` so it can leave those chips out and count them as "hidden here" (step 2).

## Steps (each one a PR)

1. **lib only (this PR).** `lib/view-filter.ts`: applyFilter, matchTask, offered/fixedFor, P0 fix, fortnight read as week inside applyFilter; folded words in the existing `matchesFilter`. Tests in `lib/view-filter.test.ts`.
2. **List views.** *In feat/filter-views.* `components/list-view.tsx` (Inbox, Today, Upcoming, project, Mine), `App.tsx` (F on every `offered` view: the key handler only), `components/quick-add.tsx` (addDefaults on every view), `lib/view-filter-store.ts` (sessionStorage), `components/view-filter.tsx` (chips skip `fixed`, clean against `shown.projects`).
3. **Board and Timeline move to applyFilter.** *In feat/filter-views.* `components/board.tsx`, `components/timeline.tsx`, `components/timeline-desktop.tsx`; "Next two weeks" leaves the panel.
4. **Completed.** *In feat/filter-views.* `components/completed.tsx` (filter bar; keep only tasks in the scope).
5. **Pickers and agents use the same matcher.** *In feat/filter-views.* `lib/mentions.ts` and the assignee picker use `matchesQuery`; `components/up-next.tsx` already uses `FocusPicker` (#122); `crates/mcp/src/lib.rs`: P0 in the instructions, text only.

## Rulings in steps 2 to 5 (feat/filter-views)

- *Ruling: one PR for steps 2 to 5, Board and Timeline first, then the list views, the store, quick add, Completed, the matchers. Why: the owner's node contract for #115 asked for one PR. Cost if wrong: a bigger review; each step is its own commit.*
- *Ruling: the MCP's `today`/`upcoming` keep returning what they return now; only the instructions change (P0 exists). Why: the contract for this PR says text only, no tool behaviour. Cost if wrong: an agent still sees others' workspace tasks in today/upcoming; a follow-up issue.*
- *Ruling: sessionStorage, as planned above; the old localStorage key is removed on start. Why: as above (a forgotten filter hides tasks the next morning). The owner was told and did not object. Cost if wrong: the owner sets the filter again after each launch; going back is one line in view-filter-store.ts.*
- *Ruling: the filter is not part of the route (feat/routes, in flight). The view components hold the control; App.tsx changes only in the F handler.*
- *Ruling: where the scope has nobody to choose (one's own space, local mode), person counts as fixed: it is not offered and an old person choice shows as "hidden here" instead of hiding every task. Why: personal tasks have no assignees, so "Me" would empty the page with nothing to explain it. Cost if wrong: none for data; Board in the personal scope stops narrowing by a person no one there can be.*
- *Ruling: a scope switch writes the filter back without projects outside the new scope, the first time a filtered view is drawn after it (the store remembers which scope it last checked). Until then a read leaves them out anyway. Why: App.tsx is not touched beyond F, and the drop must not run before the tasks load (it would drop every project on start).*
- *Ruling: Board's "x of y" still counts what the columns hold, Done included, as before; lists and Timeline count open tasks. Why: "behaviour otherwise identical" for Board; its Done column is drawn. Cost if wrong: one line.*
- *Ruling: a project's "Delete it and move N tasks" counts every task in it, never the filtered few.*
- *Ruling: on a phone a project's header buttons live behind ⋯ (an action sheet), so its Filter button sits on its own row under the large title instead (in list-view.tsx; phone.tsx is not touched).*
- *Ruling: a task added under a words filter that it does not contain leaves the page, as on Board and Timeline today. Words cannot be given to a new task. Cost if wrong: a noticed task kept on the page for a moment; not built.*
- *Ruling: Cmd+F keeps its own matcher (lib/find.ts): it marks where the text is on the page, which needs positions, not a yes or no.*

## Left out on purpose

Saved or named filters, a query language, OR/NOT across dimensions, a status filter, sort or group menus, filtering counts, the widget or MCP, per-view filters.

## Rulings in step 1

- *Ruling: `fortnight` stays in `When` and `WHEN_NAMES`, and `cleanFilter` still keeps it; only `applyFilter` reads it as `week`. Why: the panel (components/view-filter.tsx, not touched here) lists `WHEN_NAMES`, and "Next two weeks" must keep working on Board and Timeline until step 3 moves them. Cost if wrong: none for users; step 3 deletes it.*
- *Ruling: no new text-matching module. `fold` and `matchesQuery` already live in `lib/search.ts` and the Focus picker imports them from there; `matchTask` calls them. focus-picker.ts is not touched. Cost if wrong: none; the matcher is already shared.*
- *Ruling: `matchTask` matches a task with no project on "Inbox", as the Focus picker does, so "inbox" finds Inbox tasks in both.*
- *Ruling: `applyFilter` drops chosen projects that are not in `ctx.projects` (the Inbox always counts); if none is left, the project choice does not narrow. This is the step-1 half of "projects not in the scope are dropped"; step 2 also cleans the stored filter against `shown.projects`.*
- *Ruling: a subtask passes when its task passes. A subtask whose task is not in the list is judged by itself.*
- *Ruling: a view with no filter gets `offered` null and `fixedFor` every dimension, so `applyFilter` with it changes nothing.*
- The existing `matchesFilter` keeps its fields (title and notes, not project name); its words are now folded, so "cafe" finds "Café" on Board and Timeline. That and P0 are the only visible changes.

## Tests

`ui/src/lib/view-filter.test.ts`, existing cases unchanged, plus: P0 kept after a JSON round trip through `cleanFilter` (fail-first on 6b8c47c), "cafe" finds "Café" in `matchesFilter` (fail-first), and for the new API: "hop" finds a task in Hop, a subtask follows its task, fixed dimensions are ignored, a project from another scope is dropped, fortnight reads as week, workspace and personal tasks with people, undated and overdue tasks, `offered`/`fixedFor` per view.

## Verified

- Fail-first: the three new bug tests were run against view-filter.ts as on 6b8c47c and failed: P0 read back as `[1]` instead of `[0, 1]`; `[-1, 0, 1.5, 5, '0']` cleaned to `[1.5]` (non-integers also got through) instead of `[0]`; "cafe" found `[3]` instead of `[1, 2, 3]`. All pass on the branch.
- Existing view-filter, focus-picker and search tests pass unchanged (the only edit to the old test file is its import lines).
- `npm run typecheck`, `npm test` (38 files, 689 tests) and `npm run build` pass.
- Not verified here: the panel in a browser. The code path is unchanged apart from `cleanFilter` keeping 0 and words being folded; board.tsx, timeline.tsx, timeline-desktop.tsx and components/view-filter.tsx are not touched.
