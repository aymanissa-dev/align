import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/errors.ts'
import { api } from '../api/index.ts'
import type { Note } from '../api/types.ts'
import { ConflictDialog } from '../components/ConflictDialog.tsx'
import { useToast } from '../components/toast-context.ts'
import { isConflict } from '../lib/conflict.ts'
import { noteFieldPatch } from '../lib/patch.ts'
import { ConfirmDialog, EmptyState, ErrorState, ListSkeleton, TextButton } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { broadcastWorkspaceChange } from '../lib/dataChannel.ts'
import { invalidateWorkspace, queryClient } from '../queryClient.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function NoteEditorPage() {
  const { id = '' } = useParams()
  const note = useQuery({
    queryKey: ['note', id],
    queryFn: () => api.getNote(id),
    enabled: Boolean(id),
  })

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
    if (note.isLoading) return <ListSkeleton />
    return <ErrorState onRetry={() => void note.refetch()} />
  }

  return <Editor key={`${note.data.id}:${note.data.version}`} note={note.data} />
}

function Editor({ note }: { note: Note }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = useRef({ title: note.title, body: note.body, version: note.version })
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

  async function persist(nextTitle: string, nextBody: string, overwrite = false) {
    const id = ++generation.current
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
      if (generation.current !== id) return
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
      if (generation.current !== id) return
      if (isConflict(error)) setConflict({ title: normalized, body: nextBody })
      setStatus('error')
    }
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
    const readLatest = () => latest.current
    const readSaved = () => saved.current
    const nextGeneration = () => ++generation.current
    const currentGeneration = () => generation.current
    return () => {
      const current = readLatest()
      const stored = readSaved()
      const normalized = current.title.trim() || 'Untitled'
      const patch = noteFieldPatch(stored, { title: normalized, body: current.body })
      if (Object.keys(patch).length === 0) return
      const requestId = nextGeneration()
      void api.updateNote(noteId, patch, { version: stored.version }).then((updated) => {
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
      <textarea
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
        body="Delete this note? This cannot be undone."
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
