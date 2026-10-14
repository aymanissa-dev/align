import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { Project, ProjectStatus } from '../api/types.ts'
import { ProjectFormDialog } from '../components/ProjectFormDialog.tsx'
import { useToast } from '../components/toast-context.ts'
import { Button, ConfirmDialog, EmptyState, ErrorState, ListSkeleton, TextButton } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { cn } from '../lib/cn.ts'
import { invalidateWorkspace } from '../queryClient.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function ProjectsPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const status: ProjectStatus = params.get('status') === 'archived' ? 'archived' : 'active'
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  useDocumentTitle('Projects')

  const projects = useQuery({
    queryKey: ['projects', status],
    queryFn: () => api.listProjects({ status }),
  })

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: async (project) => {
      await invalidateWorkspace()
      toast(project.status === 'archived' ? 'Project archived' : 'Project restored')
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: async () => {
      await invalidateWorkspace()
      setDeleting(null)
      toast('Project deleted')
    },
    onError: (error) => toast(errorMessage(error)),
  })

  function setStatus(next: ProjectStatus) {
    setParams(next === 'archived' ? { status: 'archived' } : {})
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-neutral-950">Projects</h1>
          <p className="mt-2 text-sm text-neutral-500">Active work, and what you’ve set aside.</p>
        </div>
        <Button onClick={() => setCreating(true)}>New project</Button>
      </div>

      <div className="mt-8 flex gap-6 border-b border-neutral-200" role="tablist" aria-label="Project status">
        {(['active', 'archived'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={cn(
              'focus-ring -mb-px border-b-2 pb-2 text-sm',
              status === key ? 'border-neutral-900 font-medium text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800',
            )}
          >
            {key === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {projects.isLoading ? <ListSkeleton rows={3} header={false} /> : null}
        {projects.isError ? <div className="mt-8"><ErrorState onRetry={() => void projects.refetch()} /></div> : null}
        {projects.data && projects.data.length === 0 ? (
          <div className="mt-8">
            {status === 'active' ? (
              <EmptyState
                title="No active projects"
                body="Create a project for the work you want to keep in view."
                action={<Button onClick={() => setCreating(true)}>New project</Button>}
              />
            ) : (
              <EmptyState
                title="No archived projects"
                body="Archive a project when you want it out of the way but still on record."
              />
            )}
          </div>
        ) : null}
        {projects.data && projects.data.length > 0 ? (
          <ul>
            {projects.data.map((project) => (
              <li key={project.id} className="border-b border-neutral-200 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${project.id}`}
                      className="focus-ring rounded-sm font-medium text-neutral-950 hover:underline"
                    >
                      {project.name}
                    </Link>
                    {project.description ? (
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-500">{project.description}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-4">
                    <TextButton onClick={() => setEditing(project)}>Edit</TextButton>
                    <TextButton onClick={() => archive.mutate(project.id)} disabled={archive.isPending}>
                      {project.status === 'active' ? 'Archive' : 'Restore'}
                    </TextButton>
                    <TextButton onClick={() => setDeleting(project)}>Delete</TextButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ProjectFormDialog open={creating} onClose={() => setCreating(false)} />
      <ProjectFormDialog open={editing !== null} project={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete project"
        body={
          deleting
            ? `Delete “${deleting.name}”? Tasks and notes in this project are deleted too. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
        onClose={() => {
          if (!remove.isPending) setDeleting(null)
        }}
      />
    </div>
  )
}
