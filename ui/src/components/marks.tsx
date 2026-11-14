// The two small marks that carry colour: a project's square and a priority's dot.
import { projectStyle, useApp } from '@/lib/app-context'
import { cn } from '@/lib/utils'

export function ProjectDot({ id, className }: { id: number | null; className?: string }) {
  const { data } = useApp()
  return <span style={projectStyle(data.projects, id)} className={cn('size-2 shrink-0 rounded-xs bg-project', className)} />
}

const PRIORITY_DOT: Record<number, string> = { 1: 'bg-priority-1', 2: 'bg-priority-2', 3: 'bg-priority-3' }
export function PriorityDot({ priority }: { priority: number }) {
  if (priority > 3) return null
  return <span className={cn('size-1.5 shrink-0 rounded-full', PRIORITY_DOT[priority])} />
}
