// The Notes page's pieces for an iPhone, drawn as Apple Notes draws them:
// a bar at the top with one way back, a ⋯ that brings up the note's actions
// as an action sheet, and a compose button at the bottom right.
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, EllipsisIcon, SquarePenIcon } from 'lucide-react'
import { ProjectDot } from '@/components/marks'
import { cn } from '@/lib/utils'

// The navigation bar: fixed under the status bar, its background showing
// once the page scrolls under it. Marked so the editor keeps the caret
// below it.
export function NotesBar({ back, onBack, children }: { back: string; onBack: () => void; children?: ReactNode }) {
  const [under, setUnder] = useState(false)
  useEffect(() => {
    const onScroll = () => setUnder(window.scrollY > 0)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return createPortal(
    <div
      data-note-bar
      className={cn(
        'fixed inset-x-0 top-0 z-30 pt-[var(--safe-top)] transition-colors duration-200',
        under ? 'border-b border-border bg-background/80 backdrop-blur-xl backdrop-saturate-150' : 'border-b border-transparent bg-background',
      )}
    >
      <div className="flex h-11 items-center gap-2 px-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex h-11 min-w-0 items-center text-body text-primary active:opacity-40"
        >
          <ChevronLeftIcon className="size-7 shrink-0" strokeWidth={2.4} />
          <span className="truncate">{back}</span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ⋯ in the bar.
export function MoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Note actions"
      onClick={onClick}
      className="flex size-11 items-center justify-center active:opacity-40"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
        <EllipsisIcon className="size-5" strokeWidth={2.4} />
      </span>
    </button>
  )
}

// New note, bottom right above the tab bar, as Apple Notes' compose button.
// Drawn on the body: the page is pushed in with a transform, and a fixed
// element inside a transformed one is placed against it, not the screen.
export function ComposeButton({ onClick }: { onClick: () => void }) {
  return createPortal(
    <button
      type="button"
      aria-label="New note"
      onClick={onClick}
      className="fixed right-[max(16px,calc(var(--safe-right)+16px))] bottom-[calc(3.0625rem+var(--safe-bottom)+12px)] z-30 flex size-12 items-center justify-center rounded-full bg-background/85 text-primary shadow-[0_1px_8px_rgb(0_0_0/0.12)] backdrop-blur-xl active:opacity-40"
    >
      <SquarePenIcon className="size-6" strokeWidth={2} />
    </button>,
    document.body,
  )
}

export interface SheetChoice {
  key: string
  label: string
  project?: number | null
}

// The note's actions, rising from the bottom: Folder and Project each open
// their list in the same sheet; Read or Edit; Delete. Tapping outside or
// Cancel closes it.
export function NoteSheet({
  onClose,
  folder,
  folders,
  onFolder,
  project,
  projects,
  onProject,
  reading,
  onRead,
  onDelete,
}: {
  onClose: () => void
  folder: string | null
  folders: string[]
  onFolder: (folder: string | null) => void
  project: { id: number | null; name: string }
  projects: { id: number; name: string }[]
  onProject: (id: number | null) => void
  // null: nothing to read yet (an empty note).
  reading: boolean | null
  onRead: () => void
  onDelete: () => void
}) {
  const [step, setStep] = useState<'main' | 'folder' | 'project'>('main')
  const row = (content: ReactNode, onClick: () => void, className?: string) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn('flex min-h-14 w-full items-center gap-3 border-b border-border px-4 text-left text-body last:border-b-0 active:bg-accent', className)}
    >
      {content}
    </button>
  )
  const done = (act: () => void) => () => {
    act()
    onClose()
  }
  const check = (on: boolean) => <CheckIcon className={cn('ml-auto size-5 text-primary', !on && 'invisible')} strokeWidth={2.4} />
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end gap-2 bg-black/40 p-2 pb-[calc(var(--safe-bottom)+0.5rem)]" onClick={onClose}>
      <div className="flex max-h-[70svh] animate-rise flex-col overflow-y-auto rounded-2xl bg-background/95 backdrop-blur-xl" onClick={(event) => event.stopPropagation()}>
        {step === 'main' && (
          <>
            {row(
              <>
                <span>Folder</span>
                <span className="ml-auto truncate text-tertiary">{folder ?? 'None'}</span>
                <ChevronRightIcon className="size-4.5 shrink-0 text-faint" />
              </>,
              () => setStep('folder'),
            )}
            {row(
              <>
                <span>Project</span>
                <span className="ml-auto flex min-w-0 items-center gap-1.5 text-tertiary">
                  {project.id !== null && <ProjectDot id={project.id} />}
                  <span className="truncate">{project.name}</span>
                </span>
                <ChevronRightIcon className="size-4.5 shrink-0 text-faint" />
              </>,
              () => setStep('project'),
            )}
            {reading !== null && row(<span>{reading ? 'Edit' : 'Read as a document'}</span>, done(onRead), 'text-primary')}
            {row(<span>Delete note</span>, done(onDelete), 'text-destructive')}
          </>
        )}
        {step === 'folder' && (
          <>
            {row(<span className="font-semibold">Folder</span>, () => setStep('main'), 'min-h-11 text-subhead text-tertiary')}
            {row(
              <>
                <span>No folder</span>
                {check(folder === null)}
              </>,
              done(() => onFolder(null)),
            )}
            {folders.map((name) =>
              row(
                <>
                  <span className="truncate">{name}</span>
                  {check(folder !== null && folder.toLocaleLowerCase() === name.toLocaleLowerCase())}
                </>,
                done(() => onFolder(name)),
              ),
            )}
          </>
        )}
        {step === 'project' && (
          <>
            {row(<span className="font-semibold">Project</span>, () => setStep('main'), 'min-h-11 text-subhead text-tertiary')}
            {row(
              <>
                <ProjectDot id={null} />
                <span>No project</span>
                {check(project.id === null)}
              </>,
              done(() => onProject(null)),
            )}
            {projects.map((p) =>
              row(
                <>
                  <ProjectDot id={p.id} />
                  <span className="truncate">{p.name}</span>
                  {check(project.id === p.id)}
                </>,
                done(() => onProject(p.id)),
              ),
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (step === 'main') onClose()
          else setStep('main')
        }}
        className="h-14 shrink-0 animate-rise rounded-2xl bg-background text-body font-semibold text-primary active:bg-accent"
      >
        {step === 'main' ? 'Cancel' : 'Back'}
      </button>
    </div>,
    document.body,
  )
}
