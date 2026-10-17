import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/errors.ts'
import { api } from '../api/index.ts'
import type { Note } from '../api/types.ts'
import { ProjectFormDialog } from '../components/ProjectFormDialog.tsx'
import { ActivityPanel } from '../components/ActivityPanel.tsx'
import { Whiteboard } from '../components/Whiteboard.tsx'
import { TasksPanel } from '../components/TasksPanel.tsx'
import { useToast } from '../components/toast-context.ts'
import { Button, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, TextButton } from '../components/ui.tsx'
import { Badge } from '../components/chrome.tsx'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { excerpt, formatDate } from '../lib/format.ts'
import { invalidateWorkspace } from '../queryClient.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = requested === 'notes' || requested === 'activity' || requested === 'whiteboard' ? requested : 'tasks'
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
    enabled: Boolean(id),
  })
  useDocumentTitle(project.data?.name ?? 'Project')

  const archive = useMutation({
    mutationFn: (version?: number) => api.archiveProject(id, { version }),
    onSuccess: async (next) => {
      await invalidateWorkspace()
      toast(next.status === 'archived' ? 'Project archived' : 'Project restored')
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteProject(id),
    onSuccess: async () => {
      await invalidateWorkspace()
      toast('Project deleted')
      navigate('/projects')
    },
    onError: (error) => toast(errorMessage(error)),
  })

  if (project.isLoading) return <ListSkeleton />
  if (project.error instanceof ApiError && project.error.status === 404) {
    return (
      <EmptyState
        title="Project not found"
        body="It may have been deleted."
        action={
          <Link to="/projects" className="text-sm text-neutral-900 underline underline-offset-4">
            Back to projects
          </Link>
        }
      />
    )
  }
  if (project.isError || !project.data) return <ErrorState onRetry={() => void project.refetch()} />

  const current = project.data

  return (
    <div>
      <Link to="/projects" className="focus-ring inline-flex min-h-11 items-center font-pixel text-[11px] tracking-[0.16em] text-neutral-800 uppercase hover:text-neutral-950">
        Projects
      </Link>
      <div className="mt-4 flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-medium tracking-[-0.04em] text-neutral-950 sm:text-4xl">{current.name}</h1>
            <Badge tone={current.status === 'archived' ? 'outline' : 'solid'}>
              {current.status === 'archived' ? 'Archived' : 'Active'}
            </Badge>
          </div>
          {current.description ? (
            <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-600">{current.description}</p>
          ) : null}
          <p className="mt-3 font-mono text-xs text-neutral-500">Updated {formatDate(current.updatedAt)}</p>
        </div>
        <div className="flex shrink-0 gap-4">
          <TextButton onClick={() => setEditing(true)}>Edit</TextButton>
          <TextButton onClick={() => archive.mutate(current.version)} disabled={archive.isPending}>
            {current.status === 'active' ? 'Archive' : 'Restore'}
          </TextButton>
          <TextButton onClick={() => setConfirmDelete(true)}>Delete</TextButton>
        </div>
      </div>

      <div className="mt-6 flex gap-2" role="tablist" aria-label="Project sections">
        {(['tasks', 'notes', 'activity', 'whiteboard'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'tasks' ? {} : { tab: key })}
            className={cn(
              'focus-ring border px-3 py-1.5 text-sm',
              tab === key
                ? 'border-neutral-950 bg-neutral-950 font-medium text-white'
                : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50',
            )}
          >
            {key === 'tasks' ? 'Tasks' : key === 'notes' ? 'Notes' : key === 'activity' ? 'Activity' : 'Whiteboard'}
          </button>
        ))}
      </div>

      {tab === 'tasks' ? <TasksPanel projectId={current.id} /> : null}
      {tab === 'notes' ? <NotesPanel projectId={current.id} /> : null}
      {tab === 'activity' ? <ActivityPanel projectId={current.id} /> : null}
      {tab === 'whiteboard' ? <Whiteboard projectId={current.id} /> : null}

      <ProjectFormDialog open={editing} project={current} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete project"
        body={`Delete “${current.name}”? Tasks and notes in this project are deleted too. This cannot be undone.`}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => {
          if (!remove.isPending) setConfirmDelete(false)
        }}
      />
    </div>
  )
}

function NotesPanel({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const notes = useQuery({
    queryKey: ['notes', projectId],
    queryFn: () => api.listProjectNotes(projectId),
  })

  const create = useMutation({
    mutationFn: () => api.createNote(projectId, { title: 'Untitled', body: '' }),
    onSuccess: async (note) => {
      await invalidateWorkspace()
      navigate(`/notes/${note.id}`)
    },
    onError: (error) => toast(errorMessage(error)),
  })

  if (notes.isLoading) return <ListSkeleton rows={3} />
  if (notes.isError || !notes.data) return <div className="mt-8"><ErrorState onRetry={() => void notes.refetch()} /></div>

  return (
    <div className="mt-8">
      <Button onClick={() => create.mutate()} disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'New note'}
      </Button>
      {notes.data.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">Notes for this project will show up here.</p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200 border border-neutral-200">
          {notes.data.map((note) => (
            <li key={note.id}>
              <NoteRow note={note} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NoteRow({ note }: { note: Note }) {
  return (
    <Link to={`/notes/${note.id}`} className="focus-ring block px-4 py-3 hover:bg-neutral-50">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium text-neutral-950">{note.title || 'Untitled'}</p>
        <span className="shrink-0 text-xs text-neutral-400">{formatDate(note.updatedAt)}</span>
      </div>
      {note.body.trim() ? <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{excerpt(note.body)}</p> : null}
    </Link>
  )
}
