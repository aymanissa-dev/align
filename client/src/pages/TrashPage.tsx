import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import type { TrashItem } from '../api/types.ts'
import { PageHeader } from '../components/chrome.tsx'
import { useToast } from '../components/toast-context.ts'
import { Button, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, OfflineState } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { formatDate } from '../lib/format.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { invalidateWorkspace } from '../queryClient.ts'

export function TrashPage() {
  useDocumentTitle('Trash')
  const toast = useToast()
  const trash = useQuery({ queryKey: ['trash'], queryFn: () => api.listTrash() })
  const miss = useQueryMiss(trash)
  const [purge, setPurge] = useState<{ kind: 'project' | 'task'; id: string; label: string } | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)

  const restoreProject = useMutation({
    mutationFn: (id: string) => api.restoreProject(id),
    onSuccess: async (project) => {
      await invalidateWorkspace()
      toast(`Restored ${project.name}`)
    },
    onError: (caught) => toast(errorMessage(caught)),
  })

  const restoreTask = useMutation({
    mutationFn: (id: string) => api.restoreTask(id),
    onSuccess: async (task) => {
      await invalidateWorkspace()
      toast(`Restored ${task.title}`)
    },
    onError: (caught) => toast(errorMessage(caught)),
  })

  const purgeItem = useMutation({
    mutationFn: (item: { kind: 'project' | 'task'; id: string }) =>
      item.kind === 'project' ? api.purgeProject(item.id) : api.purgeTask(item.id),
    onSuccess: async () => {
      setPurge(null)
      await invalidateWorkspace()
      toast('Deleted permanently')
    },
    onError: (caught) => toast(errorMessage(caught)),
  })

  const emptyTrash = useMutation({
    mutationFn: () => api.emptyTrash(),
    onSuccess: async () => {
      setEmptyOpen(false)
      await invalidateWorkspace()
      toast('Trash emptied')
    },
    onError: (caught) => toast(errorMessage(caught)),
  })

  const projects = trash.data?.projects ?? []
  const tasks = trash.data?.tasks ?? []
  const empty = projects.length === 0 && tasks.length === 0
  const loading = trash.isLoading && !trash.data
  const offline = miss === 'offline' && !trash.data
  const failed = !trash.data && trash.isError && !offline
  const pendingId = restoreProject.isPending
    ? restoreProject.variables
    : restoreTask.isPending
      ? restoreTask.variables
      : null

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Trash"
        description="Deleted projects and tasks stay here for 30 days, then they are removed."
        action={
          empty ? null : (
            <Button variant="secondary" onClick={() => setEmptyOpen(true)}>
              Empty Trash
            </Button>
          )
        }
      />

      {loading || miss === 'loading' ? (
        <div className="mt-8">
          <ListSkeleton />
        </div>
      ) : null}
      {offline ? (
        <div className="mt-8">
          <OfflineState />
        </div>
      ) : null}
      {failed && miss !== 'loading' ? (
        <div className="mt-8">
          <ErrorState onRetry={() => void trash.refetch()} />
        </div>
      ) : null}

      {!loading && !failed && !offline && empty ? (
        <div className="mt-8">
          <EmptyState title="Trash is empty" body="Deleted projects and tasks show up here until the 30 days are up." />
        </div>
      ) : null}

      {!loading && !failed && projects.length > 0 ? (
        <section className="mt-8" aria-labelledby="trash-projects">
          <h2 id="trash-projects" className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
            Projects
          </h2>
          <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
            {projects.map((project) => (
              <TrashRow
                key={project.id}
                label={project.name || 'Untitled project'}
                deletedAt={project.deletedAt}
                purgeAt={project.purgeAt}
                pending={pendingId === project.id || (purgeItem.isPending && purgeItem.variables?.id === project.id)}
                onRestore={() => restoreProject.mutate(project.id)}
                onPurge={() => setPurge({ kind: 'project', id: project.id, label: project.name || 'Untitled project' })}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {!loading && !failed && tasks.length > 0 ? (
        <section className="mt-8" aria-labelledby="trash-tasks">
          <h2 id="trash-tasks" className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
            Tasks
          </h2>
          <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200">
            {tasks.map((task) => (
              <TrashRow
                key={task.id}
                label={task.title || 'Untitled task'}
                deletedAt={task.deletedAt}
                purgeAt={task.purgeAt}
                pending={pendingId === task.id || (purgeItem.isPending && purgeItem.variables?.id === task.id)}
                onRestore={() => restoreTask.mutate(task.id)}
                onPurge={() => setPurge({ kind: 'task', id: task.id, label: task.title || 'Untitled task' })}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <ConfirmDialog
        open={purge !== null}
        title="Delete permanently"
        body={purge ? `Permanently delete “${purge.label}”? This cannot be undone.` : ''}
        confirmLabel="Delete permanently"
        pending={purgeItem.isPending}
        onConfirm={() => {
          if (purge) purgeItem.mutate(purge)
        }}
        onClose={() => {
          if (!purgeItem.isPending) setPurge(null)
        }}
      />
      <ConfirmDialog
        open={emptyOpen}
        title="Empty Trash"
        body="Permanently delete everything in Trash, including tasks and notes that belong to those projects? This cannot be undone."
        confirmLabel="Empty Trash"
        pending={emptyTrash.isPending}
        onConfirm={() => emptyTrash.mutate()}
        onClose={() => {
          if (!emptyTrash.isPending) setEmptyOpen(false)
        }}
      />
    </div>
  )
}

function TrashRow({
  label,
  deletedAt,
  purgeAt,
  pending,
  onRestore,
  onPurge,
}: {
  label: string
  deletedAt: TrashItem['deletedAt']
  purgeAt: TrashItem['purgeAt']
  pending: boolean
  onRestore: () => void
  onPurge: () => void
}) {
  const removed = formatDate(deletedAt)
  const purge = formatDate(purgeAt)
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-950">{label}</p>
        <p className="mt-1 text-xs text-neutral-500">
          {removed ? `Deleted ${removed}` : 'Deleted'}
          {purge ? ` · Removed after ${purge}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" disabled={pending} onClick={onRestore}>
          {pending ? 'Restoring…' : `Restore ${label}`}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onPurge}>
          {`Delete ${label} permanently`}
        </Button>
      </div>
    </li>
  )
}
