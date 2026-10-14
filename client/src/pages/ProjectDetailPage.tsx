import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/errors.ts'
import { api } from '../api/index.ts'
import type { Note, Task } from '../api/types.ts'
import { ProjectFormDialog } from '../components/ProjectFormDialog.tsx'
import { IconPencil, IconTrash } from '../components/icons.tsx'
import { useToast } from '../components/toast-context.ts'
import {
  Button,
  CheckButton,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  ListSkeleton,
  ProgressBar,
  TextButton,
} from '../components/ui.tsx'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { excerpt, formatDate } from '../lib/format.ts'
import { compareTasks, taskProgress } from '../lib/tasks.ts'
import { invalidateWorkspace } from '../queryClient.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'notes' ? 'notes' : 'tasks'
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
    enabled: Boolean(id),
  })
  useDocumentTitle(project.data?.name ?? 'Project')

  const archive = useMutation({
    mutationFn: () => api.archiveProject(id),
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
      <Link to="/projects" className="focus-ring rounded-sm text-sm text-neutral-500 hover:text-neutral-900">
        Projects
      </Link>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-tight text-neutral-950">{current.name}</h1>
          {current.description ? (
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">{current.description}</p>
          ) : null}
          <p className="mt-3 text-xs text-neutral-400">
            {current.status === 'archived' ? 'Archived · ' : ''}
            Updated {formatDate(current.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-4">
          <TextButton onClick={() => setEditing(true)}>Edit</TextButton>
          <TextButton onClick={() => archive.mutate()} disabled={archive.isPending}>
            {current.status === 'active' ? 'Archive' : 'Restore'}
          </TextButton>
          <TextButton onClick={() => setConfirmDelete(true)}>Delete</TextButton>
        </div>
      </div>

      <div className="mt-8 flex gap-6 border-b border-neutral-200" role="tablist" aria-label="Project sections">
        {(['tasks', 'notes'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'notes' ? { tab: 'notes' } : {})}
            className={cn(
              'focus-ring -mb-px border-b-2 pb-2 text-sm',
              tab === key ? 'border-neutral-900 font-medium text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800',
            )}
          >
            {key === 'tasks' ? 'Tasks' : 'Notes'}
          </button>
        ))}
      </div>

      {tab === 'tasks' ? <TasksPanel projectId={current.id} /> : <NotesPanel projectId={current.id} />}

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

function TasksPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const toggle = useToggleTask()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDue, setDraftDue] = useState('')

  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks(projectId),
  })

  const create = useMutation({
    mutationFn: () => api.createTask(projectId, { title, dueDate: due || null }),
    onSuccess: async () => {
      setTitle('')
      setDue('')
      await invalidateWorkspace()
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const update = useMutation({
    mutationFn: (input: { id: string; title: string; dueDate: string | null }) =>
      api.updateTask(input.id, { title: input.title, dueDate: input.dueDate }),
    onSuccess: async () => {
      setEditingId(null)
      await invalidateWorkspace()
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (taskId: string) => api.deleteTask(taskId),
    onSuccess: () => invalidateWorkspace(),
    onError: (error) => toast(errorMessage(error)),
  })

  function onCreate(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    create.mutate()
  }

  function startEdit(task: Task) {
    setEditingId(task.id)
    setDraftTitle(task.title)
    setDraftDue(task.dueDate ?? '')
  }

  function saveEdit(taskId: string) {
    if (!draftTitle.trim()) {
      toast('Task title is required.')
      return
    }
    update.mutate({ id: taskId, title: draftTitle, dueDate: draftDue || null })
  }

  if (tasks.isLoading) return <ListSkeleton rows={4} />
  if (tasks.isError || !tasks.data) return <div className="mt-8"><ErrorState onRetry={() => void tasks.refetch()} /></div>

  const sorted = [...tasks.data].sort(compareTasks)
  const progress = taskProgress(sorted)

  return (
    <div className="mt-8">
      <form onSubmit={onCreate} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task"
          aria-label="Task title"
          className="sm:flex-1"
        />
        <Input
          type="date"
          value={due}
          onChange={(event) => setDue(event.target.value)}
          aria-label="Due date"
          className="sm:w-40"
        />
        <Button type="submit" disabled={create.isPending || !title.trim()}>
          {create.isPending ? 'Adding…' : 'Add'}
        </Button>
      </form>

      {sorted.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">Tasks you add will show up here.</p>
      ) : (
        <>
          <div className="mt-8">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <p className="text-neutral-500">
                {progress.completed} of {progress.total} complete
              </p>
              <p className="text-neutral-900 tabular-nums">{progress.percent}%</p>
            </div>
            <ProgressBar value={progress.percent} label="Task progress" />
          </div>
          <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
            {sorted.map((task) =>
              editingId === task.id ? (
                <li key={task.id} className="py-3">
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveEdit(task.id)
                    }}
                  >
                    <Input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      aria-label="Task title"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                      className="sm:flex-1"
                    />
                    <Input
                      type="date"
                      value={draftDue}
                      onChange={(event) => setDraftDue(event.target.value)}
                      aria-label="Due date"
                      className="sm:w-40"
                    />
                    <div className="flex gap-2">
                      <Button type="submit" disabled={update.isPending}>
                        Save
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={task.id} className="flex items-start gap-3 py-3">
                  <CheckButton
                    checked={task.completed}
                    label={task.completed ? `Mark “${task.title}” incomplete` : `Mark “${task.title}” complete`}
                    onChange={() =>
                      toggle.mutate(
                        { id: task.id, projectId: task.projectId, completed: task.completed },
                        { onError: (error) => toast(errorMessage(error)) },
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>
                      {task.title}
                    </p>
                  </div>
                  {task.dueDate ? (
                    <span className="shrink-0 pt-0.5 text-sm text-neutral-400">{formatDate(task.dueDate)}</span>
                  ) : null}
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="focus-ring rounded-md p-1 text-neutral-400 hover:text-neutral-900"
                      aria-label={`Edit “${task.title}”`}
                      onClick={() => startEdit(task)}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      className="focus-ring rounded-md p-1 text-neutral-400 hover:text-neutral-900"
                      aria-label={`Delete “${task.title}”`}
                      onClick={() => remove.mutate(task.id)}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        </>
      )}
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
        <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
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
    <Link to={`/notes/${note.id}`} className="focus-ring block rounded-sm py-3 hover:bg-neutral-50">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium text-neutral-950">{note.title || 'Untitled'}</p>
        <span className="shrink-0 text-xs text-neutral-400">{formatDate(note.updatedAt)}</span>
      </div>
      {note.body.trim() ? <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{excerpt(note.body)}</p> : null}
    </Link>
  )
}
