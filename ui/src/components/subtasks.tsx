// The list under a task: its subtasks, each with a check, and a field to add
// another.
import { useState, type FormEvent } from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NotesText } from '@/components/notes-text'
import { TaskEditor } from '@/components/task-editor'
import { TaskCheck } from '@/components/task-row'
import { useApp } from '@/lib/app-context'
import { play } from '@/lib/sounds'
import { addSubtask, subtasksOf, type Task } from '@/lib/tasks'
import { cn } from '@/lib/utils'

function SubtaskRow({ task }: { task: Task }) {
  const { ui, edit, complete, reopen } = useApp()
  if (ui.editing === task.id) return <TaskEditor task={task} />
  return (
    // data-task, so a right-click offers the same menu as on any task.
    <div data-task={task.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted max-md:gap-3 max-md:px-1 max-md:py-2">
      {/* No fade-out as on a task's row: a ticked subtask stays where it is. */}
      <TaskCheck task={task} checked={!!task.done} onChange={() => (task.done ? reopen(task.id) : complete(task.id))} className="mt-px size-4 max-md:size-5" />
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <Button
          variant="ghost"
          onClick={() => edit(task.id)}
          className="h-auto w-full min-w-0 justify-start rounded-none p-0 text-left font-normal whitespace-normal hover:bg-transparent max-md:text-base max-md:leading-snug"
        >
          <span className={cn('wrap-anywhere', task.done && 'text-faint line-through')}>{task.title}</span>
        </Button>
        {/* Not cut to one line as on a task's row: for a subtask the notes
            are the point, the few words that say what the line is about. */}
        {task.notes && <NotesText notes={task.notes} onEdit={() => edit(task.id)} className={cn('wrap-anywhere whitespace-pre-line', task.done && 'text-faint')} />}
      </div>
    </div>
  )
}

function AddSubtask({ parentId }: { parentId: number }) {
  const { update } = useApp()
  const [title, setTitle] = useState('')
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    play('confirm')
    update((d) => addSubtask(d, parentId, title.trim()))
    // The field is kept and emptied, so a list can be typed one Enter at a time.
    setTitle('')
  }
  return (
    <form onSubmit={save} className="flex items-center gap-2.5 px-2 max-md:gap-3 max-md:px-1">
      <PlusIcon className="size-4 text-faint" />
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add subtask"
        aria-label="Add subtask"
        className="h-8 border-0 px-0 focus-visible:ring-0 max-md:h-11"
      />
    </form>
  )
}

export function Subtasks({ parent }: { parent: Task }) {
  const { data } = useApp()
  return (
    // Indented to sit under the task's title, past its check.
    <div className="mb-1 ml-7 flex flex-col max-md:ml-8">
      {subtasksOf(data.tasks, parent.id).map((task) => (
        <SubtaskRow key={task.id} task={task} />
      ))}
      <AddSubtask parentId={parent.id} />
    </div>
  )
}
