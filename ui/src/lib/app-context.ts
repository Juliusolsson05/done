// What every part of the interface can read and do. App.tsx provides it.
import { createContext, useContext, type CSSProperties, type RefObject } from 'react'
import type { Info } from '@/lib/backend'
import type { Day } from '@/lib/days'
import type { Session } from '@/lib/focus'
import type { Hit } from '@/lib/search'
import { colorIndex, type Data, type Project, type Task, type View } from '@/lib/tasks'
import type { Scope, Shown, Team } from '@/lib/team'

// What is on screen right now. The view and the open task are in the
// address (lib/route.ts), so a reload comes back to them; the rest is not kept.
export interface Ui {
  view: View
  // Where the phone's Back button goes: the place this one was opened from,
  // read from the browser's history (lib/router.ts). Empty when there is none.
  history: View[]
  adding: boolean
  // The quick add box is naming today's goal rather than adding to the view.
  asGoal: boolean
  editing: number | null
  newProject: boolean
  renaming: boolean
  confirmDelete: boolean
  // The search over the whole app (Cmd+F) is open.
  searching: boolean
  tlStart: Day
  // What the Focus view offers before a session starts: the task chosen (its
  // id as text, or 'none'; null until something is chosen, which offers
  // today's goal) and the length chosen with the buttons.
  focusPick: string | null
  focusMinutes: number
}

export interface App {
  // Everything this window holds. Changes go through `update`, always on all
  // of it; what a view lists comes from `shown`.
  data: Data
  info: Info
  // With an account: the spaces, members and notifications; null without.
  team: Team | null
  // This person's account id, for "assigned to me" and whose goal is whose.
  me: string | null
  // Where the picker is, and what each view lists there.
  scope: Scope
  setScope(scope: Scope): void
  shown: Shown
  // Narrows Today and Upcoming: in All, someone else's workspace tasks are left out.
  keep(task: Task): boolean
  // Runs a workspace call on the server and brings the window up to date. A
  // refusal is said in its own words; true when it worked.
  teamAct(run: () => Promise<unknown>, said?: string): Promise<boolean>
  ui: Ui
  zoom: number
  // The focus session that is running, paused or just ended, if any.
  focus: Session | null
  // The task that was just added or moved, marked for a moment.
  noticed: number | null
  // Set while a bar or card is being dragged, so nothing reloads under it.
  dragging: RefObject<boolean>

  openView(view: View): void
  // Back to the view this one was opened from; Lists when there is none.
  back(): void
  // The Notes page says which note it shows, for the address. `auto` for a
  // note it opened by itself, which is not a step to go back through.
  showNote(id: number | null, auto?: boolean): void
  add(): void
  addGoal(): void
  edit(id: number): void
  search(): void
  // Show what a search found: a project's list, a task open in its list, or a note.
  reveal(hit: Hit): void
  closeAll(): void
  newProject(): void
  rename(): void
  askDelete(): void
  setTlStart(day: Day): void
  setZoom(next: number): void
  // Open the Focus view with this task chosen.
  focusOn(id: number): void
  chooseFocus(choice: { focusPick?: string; focusMinutes?: number }): void

  // Change the data, save it, and optionally mark one task as just changed.
  update(fn: (data: Data) => Data, notice?: number): void
  // The sound of finishing a task, for the rows: they play it when the check
  // is pressed, a moment before the task is marked done.
  completeSound(id: number): void
  // `heard` when completeSound has already played for this.
  complete(id: number, heard?: boolean): void
  reopen(id: number): void
  removeTask(id: number): void
  removeProject(id: number): void
  say(text: string, undo?: (data: Data) => Data): void
}

export const AppContext = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) throw new Error('useApp is used outside App')
  return app
}

// A project's colour is data, so it reaches the stylesheet through a style
// prop: this sets --project, and the theme's `project` utilities read it.
export const colorStyle = (index: number | null): CSSProperties =>
  ({ '--project': index === null ? 'var(--project-none)' : `var(--project-${index})` }) as CSSProperties
export const projectStyle = (projects: Project[], id: number | null): CSSProperties => colorStyle(colorIndex(projects, id))
