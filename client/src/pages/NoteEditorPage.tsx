import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/errors.ts'
import { api } from '../api/index.ts'
import type { LinkedTask, Note } from '../api/types.ts'
import { ConflictDialog } from '../components/ConflictDialog.tsx'
import { NoteTaskLinks } from '../components/NoteTaskLinks.tsx'
import { useToast } from '../components/toast-context.ts'
import { isConflict } from '../lib/conflict.ts'
import { noteFieldPatch } from '../lib/patch.ts'
import { ConfirmDialog, EmptyState, ErrorState, ListSkeleton, OfflineState, TextButton } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { broadcastWorkspaceChange } from '../lib/dataChannel.ts'
import { invalidateWorkspace, queryClient } from '../queryClient.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

function chainWrite<T>(chain: { current: Promise<void> }, work: () => Promise<T>): Promise<T> {
  const next = chain.current.then(work, work)
  chain.current = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function linksFor(ids: string[], known: { id: string; title: string }[], previous: LinkedTask[]): LinkedTask[] {
  return ids.map((id) => {
    const task = known.find((item) => item.id === id)
    if (task) return { id, title: task.title, trashed: false }
    const existing = previous.find((item) => item.id === id)
    if (existing) return existing
    return { id, title: 'Removed', trashed: true }
  })
}

export function NoteEditorPage() {
  const { id = '' } = useParams()
  const note = useQuery({
    queryKey: ['note', id],
    queryFn: () => api.getNote(id),
    enabled: Boolean(id),
  })
  const miss = useQueryMiss(note)

  if (note.error instanceof ApiError && note.error.status === 404) {
    return (
      <EmptyState
        title="Note not found"
        body="It may have been deleted."
        action={
          <Link to="/notes" className="text-sm text-neutral-900 underline underline-offset-4">
            Back to notes
          </Link>
        }
      />
    )
  }
  if (!note.data) {
    if (miss === 'loading') return <ListSkeleton />
    if (miss === 'offline') return <OfflineState />
    return <ErrorState error={note.error} onRetry={() => void note.refetch()} />
  }

  return <Editor key={`${note.data.id}:${note.data.version}`} note={note.data} />
}

function Editor({ note }: { note: Note }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [taskIds, setTaskIds] = useState(() => note.taskIds ?? [])
  const [linkedTasks, setLinkedTasks] = useState(() => note.linkedTasks ?? [])
  const [linking, setLinking] = useState(false)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = useRef({ title: note.title, body: note.body, version: note.version })
  const writeChain = useRef(Promise.resolve())
  const latest = useRef({ title: note.title, body: note.body })
  const [conflict, setConflict] = useState<{ title: string; body: string } | null>(null)
  const generation = useRef(0)
  latest.current = { title, body }
  useDocumentTitle(title.trim() || 'Note')

  const project = useQuery({
    queryKey: ['project', note.projectId],
    queryFn: () => api.getProject(note.projectId),
  })

  function isSaved(nextTitle: string, nextBody: string): boolean {
    return (nextTitle.trim() || 'Untitled') === saved.current.title && nextBody === saved.current.body
  }

  function rememberLinks(nextIds: string[], nextLinks: LinkedTask[]) {
    const apply = (current: Note[] | undefined) =>
      current?.map((item) => (item.id === note.id ? { ...item, taskIds: nextIds, linkedTasks: nextLinks } : item))
    queryClient.setQueryData<Note[]>(['notes', note.projectId], apply)
    queryClient.setQueryData<Note[]>(['notes'], apply)
  }

  function setTaskLinks(next: string[], known: { id: string; title: string }[]) {
    const previousIds = taskIds
    const previousLinks = linkedTasks
    const optimistic = linksFor(next, known, previousLinks)
    setLinking(true)
    setTaskIds(next)
    setLinkedTasks(optimistic)
    rememberLinks(next, optimistic)
    void chainWrite(writeChain, async () => {
      setStatus('saving')
      try {
        const updated = await api.updateNote(note.id, { taskIds: next }, { version: saved.current.version })
        saved.current.version = updated.version
        const nextIds = updated.taskIds ?? []
        const nextLinks = updated.linkedTasks ?? []
        setTaskIds(nextIds)
        setLinkedTasks(nextLinks)
        rememberLinks(nextIds, nextLinks)
        queryClient.setQueryData<Note>(['note', note.id], (current) =>
          current ? { ...current, taskIds: nextIds, linkedTasks: nextLinks, version: updated.version } : updated,
        )
        broadcastWorkspaceChange()
        void queryClient.invalidateQueries({ queryKey: ['notes'] })
        if (isSaved(latest.current.title, latest.current.body)) setStatus('saved')
      } catch (error) {
        if (error instanceof ApiError && error.queued) {
          toast('Saved on this device. It will sync when you reconnect.')
          if (isSaved(latest.current.title, latest.current.body)) setStatus('saved')
          return
        }
        setTaskIds(previousIds)
        setLinkedTasks(previousLinks)
        rememberLinks(previousIds, previousLinks)
        if (isConflict(error)) {
          toast('This note changed elsewhere.')
          void queryClient.invalidateQueries({ queryKey: ['note', note.id] })
        } else {
          toast(errorMessage(error))
        }
        setStatus(isSaved(latest.current.title, latest.current.body) ? 'saved' : 'error')
      } finally {
        setLinking(false)
      }
    })
  }

  function persist(nextTitle: string, nextBody: string, overwrite = false) {
    const id = ++generation.current
    return chainWrite(writeChain, async () => {
      if (!overwrite && generation.current !== id) return
      const normalized = nextTitle.trim() || 'Untitled'
      const patch = noteFieldPatch(saved.current, { title: normalized, body: nextBody })
      if (!overwrite && Object.keys(patch).length === 0) {
        setStatus('saved')
        return
      }
      try {
        const updated = await api.updateNote(note.id, patch, {
          version: saved.current.version,
          overwrite,
        })
        if (!overwrite && generation.current !== id) return
        saved.current = { title: updated.title, body: updated.body, version: updated.version }
        setConflict(null)
        queryClient.setQueryData(['note', note.id], updated)
        broadcastWorkspaceChange()
        void queryClient.invalidateQueries({ queryKey: ['notes'] })
        const current = latest.current
        if ((current.title.trim() || 'Untitled') === updated.title && current.body === updated.body) {
          setStatus('saved')
        }
      } catch (error) {
        if (!overwrite && generation.current !== id) return
        if (isConflict(error)) setConflict({ title: normalized, body: nextBody })
        setStatus('error')
      }
    })
  }

  useEffect(() => {
    if (isSaved(title, body)) return
    setStatus('saving')
    const handle = window.setTimeout(() => {
      void persist(title, body)
    }, 500)
    return () => window.clearTimeout(handle)
    // persist is recreated each render and closes over the latest note id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, note.id])

  useEffect(() => {
    const noteId = note.id
    const chain = writeChain
    const readLatest = () => latest.current
    const readSaved = () => saved.current
    const nextGeneration = () => ++generation.current
    const currentGeneration = () => generation.current
    return () => {
      const current = readLatest()
      const requestId = nextGeneration()
      void chainWrite(chain, async () => {
        if (currentGeneration() !== requestId) return
        const stored = readSaved()
        const normalized = current.title.trim() || 'Untitled'
        const patch = noteFieldPatch(stored, { title: normalized, body: current.body })
        if (Object.keys(patch).length === 0) return
        const updated = await api.updateNote(noteId, patch, { version: stored.version })
        if (currentGeneration() !== requestId) return
        queryClient.setQueryData(['note', noteId], updated)
        broadcastWorkspaceChange()
        void queryClient.invalidateQueries({ queryKey: ['notes'] })
      })
    }
  }, [note.id])

  const remove = useMutation({
    mutationFn: () => api.deleteNote(note.id),
    onSuccess: async () => {
      saved.current = {
        title: latest.current.title.trim() || 'Untitled',
        body: latest.current.body,
        version: saved.current.version,
      }
      await invalidateWorkspace()
      toast('Note deleted')
      navigate('/notes')
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const statusLabel = status === 'saving' ? 'Saving…' : status === 'error' ? 'Couldn’t save' : 'Saved'

  return (
    <div>
      <ConflictDialog
        open={conflict !== null}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null)
          void queryClient.invalidateQueries({ queryKey: ['note', note.id] })
        }}
        onOverwrite={() => {
          if (!conflict) return
          void persist(conflict.title, conflict.body, true)
        }}
      />
      <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-4 text-sm">
        <Link to="/notes" className="focus-ring inline-flex min-h-11 items-center font-pixel text-[11px] tracking-[0.16em] text-neutral-800 uppercase hover:text-neutral-950">
          Notes
        </Link>
        <span className="border border-neutral-300 px-2 py-0.5 font-pixel text-[10px] tracking-[0.14em] text-neutral-600 uppercase" role="status">
          {statusLabel}
        </span>
      </div>
      <input
        id="note-editor-title"
        name="title"
        autoComplete="off"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (!title.trim()) setTitle('Untitled')
        }}
        aria-label="Title"
        placeholder="Untitled"
        className="mt-6 w-full bg-transparent text-3xl font-medium tracking-[-0.04em] text-neutral-950 placeholder:text-neutral-300 focus:outline-none sm:text-4xl"
      />
      {project.data ? (
        <Link
          to={`/projects/${project.data.id}?tab=notes`}
          className="focus-ring mt-3 inline-block text-sm text-neutral-600 hover:text-neutral-950"
        >
          {project.data.name}
        </Link>
      ) : (
        <p className="mt-3 text-sm text-neutral-400">Project</p>
      )}
      <NoteTaskLinks
        projectId={note.projectId}
        taskIds={taskIds}
        linkedTasks={linkedTasks}
        pending={linking}
        onChange={setTaskLinks}
      />
      <textarea
        id="note-editor-body"
        name="body"
        autoComplete="off"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write…"
        aria-label="Note body"
        className="mt-6 min-h-[55vh] w-full resize-none bg-transparent text-base leading-7 text-neutral-800 placeholder:text-neutral-300 focus:outline-none"
      />
      <div className="mt-10 border-t border-neutral-200 pt-6">
        <TextButton onClick={() => setConfirmDelete(true)}>Delete note</TextButton>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete note"
        body="Delete this note? Moved to Trash. You can restore it for 30 days."
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
