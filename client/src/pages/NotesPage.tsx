import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { Note, Project } from '../api/types.ts'
import { useToast } from '../components/toast-context.ts'
import { Button, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, Select } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { excerpt, formatDate } from '../lib/format.ts'
import { invalidateWorkspace } from '../queryClient.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function NotesPage() {
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  useDocumentTitle('Notes')

  const notes = useQuery({ queryKey: ['notes'], queryFn: () => api.listNotes() })
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api.listProjects() })

  const loading = notes.isLoading || projects.isLoading
  const failed = notes.isError || projects.isError
  const activeProjects = (projects.data ?? []).filter((project) => project.status === 'active')

  function onNew() {
    if (activeProjects.length === 0) {
      toast('Create or restore a project first.')
      return
    }
    setCreating(true)
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-neutral-950">Notes</h1>
          <p className="mt-2 text-sm text-neutral-500">Writing attached to a project.</p>
        </div>
        <Button onClick={onNew}>New note</Button>
      </div>

      {loading ? <ListSkeleton /> : null}
      {failed ? (
        <div className="mt-8">
          <ErrorState
            onRetry={() => {
              void notes.refetch()
              void projects.refetch()
            }}
          />
        </div>
      ) : null}

      {!loading && !failed && notes.data && projects.data && notes.data.length === 0 ? (
        <div className="mt-8">
          {activeProjects.length === 0 ? (
            <EmptyState
              title="No notes yet"
              body="Notes live with a project. Create one, then come back to write."
              action={
                <Link
                  to="/projects"
                  className="focus-ring inline-flex rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Go to projects
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No notes yet"
              body="A short note is enough. Capture the decision, not the whole meeting."
              action={<Button onClick={onNew}>New note</Button>}
            />
          )}
        </div>
      ) : null}

      {!loading && !failed && notes.data && projects.data && notes.data.length > 0 ? (
        <div className="mt-10 space-y-10">
          {groupNotes(notes.data, projects.data).map((group) => (
            <section key={group.project.id}>
              <h2 className="text-sm font-medium text-neutral-500">
                <Link
                  to={`/projects/${group.project.id}?tab=notes`}
                  className="focus-ring rounded-sm hover:text-neutral-900"
                >
                  {group.project.name}
                </Link>
              </h2>
              <ul className="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
                {group.notes.map((note) => (
                  <li key={note.id}>
                    <Link to={`/notes/${note.id}`} className="focus-ring block rounded-sm py-3 hover:bg-neutral-50">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="font-medium text-neutral-950">{note.title || 'Untitled'}</p>
                        <span className="shrink-0 text-xs text-neutral-400">{formatDate(note.updatedAt)}</span>
                      </div>
                      {note.body.trim() ? (
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-500">{excerpt(note.body)}</p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      <NewNoteDialog open={creating} projects={activeProjects} onClose={() => setCreating(false)} />
    </div>
  )
}

function groupNotes(notes: Note[], projects: Project[]): Array<{ project: Project; notes: Note[] }> {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const grouped = new Map<string, Note[]>()
  for (const note of notes) {
    const list = grouped.get(note.projectId)
    if (list) list.push(note)
    else grouped.set(note.projectId, [note])
  }
  const groups = []
  for (const [projectId, items] of grouped) {
    const project = byId.get(projectId)
    if (!project) continue
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    groups.push({ project, notes: items })
  }
  groups.sort((a, b) => b.notes[0].updatedAt.localeCompare(a.notes[0].updatedAt))
  return groups
}

function NewNoteDialog({
  open,
  projects,
  onClose,
}: {
  open: boolean
  projects: Project[]
  onClose: () => void
}) {
  return (
    <Modal open={open} title="New note" onClose={onClose}>
      {open ? <NewNoteForm key={projects[0]?.id ?? 'none'} projects={projects} onClose={onClose} /> : null}
    </Modal>
  )
}

function NewNoteForm({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const create = useMutation({
    mutationFn: () => api.createNote(projectId, { title: title.trim() || 'Untitled', body: '' }),
    onSuccess: async (note) => {
      await invalidateWorkspace()
      onClose()
      navigate(`/notes/${note.id}`)
    },
    onError: (caught) => {
      setError(errorMessage(caught))
      toast(errorMessage(caught))
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!projectId) {
      setError('Choose a project.')
      return
    }
    setError('')
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Project" htmlFor="note-project" error={error}>
        <Select
          id="note-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'note-project-error' : undefined}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" htmlFor="note-title">
        <Input
          id="note-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled"
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create note'}
        </Button>
      </div>
    </form>
  )
}
