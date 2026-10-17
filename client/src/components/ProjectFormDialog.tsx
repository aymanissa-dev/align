import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { Project, ProjectPatch } from '../api/types.ts'
import { ConflictDialog } from './ConflictDialog.tsx'
import { isConflict } from '../lib/conflict.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { projectFieldPatch } from '../lib/patch.ts'
import { invalidateWorkspace } from '../queryClient.ts'
import { useToast } from './toast-context.ts'
import { Button, Field, Input, Modal, Textarea } from './ui.tsx'

export function ProjectFormDialog({
  open,
  project,
  onClose,
}: {
  open: boolean
  project?: Project | null
  onClose: () => void
}) {
  return (
    <Modal open={open} title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      {open ? <ProjectForm key={project?.id ?? 'new'} project={project ?? null} onClose={onClose} /> : null}
    </Modal>
  )
}

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState<ProjectPatch | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    setPending(true)
    let previous: Project[] | undefined
    let inserted = false
    try {
      if (project) {
        const patch = projectFieldPatch(project, { name: name.trim(), description })
        if (Object.keys(patch).length === 0) {
          onClose()
          return
        }
        setConflict(null)
        await api.updateProject(project.id, patch, { version: project.version })
        await invalidateWorkspace()
        toast('Project updated')
        onClose()
      } else {
        const trimmed = name.trim()
        const about = description.trim()
        const tempId = `tmp-${crypto.randomUUID()}`
        const optimistic: Project = {
          id: tempId,
          name: trimmed,
          description: about,
        status: 'active',
        version: 0,
        createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        previous = queryClient.getQueryData<Project[]>(['projects', 'active'])
        queryClient.setQueryData<Project[]>(['projects', 'active'], (current) => [optimistic, ...(current ?? [])])
        inserted = true
        const created = await api.createProject({ name: trimmed, description: about })
        queryClient.setQueryData(['project', created.id], created)
        queryClient.setQueryData<Project[]>(['projects', 'active'], (current) => [
          created,
          ...(current ?? []).filter((item) => item.id !== tempId),
        ])
        toast('Project created')
        onClose()
        navigate(`/projects/${created.id}`)
        void invalidateWorkspace()
      }
    } catch (caught) {
      if (inserted) queryClient.setQueryData(['projects', 'active'], previous)
      if (project && isConflict(caught)) {
        setConflict(projectFieldPatch(project, { name: name.trim(), description }))
        return
      }
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  async function overwrite() {
    if (!project || !conflict) return
    setPending(true)
    try {
      await api.updateProject(project.id, conflict, { version: project.version, overwrite: true })
      await invalidateWorkspace()
      toast('Project updated')
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
    <ConflictDialog
      open={conflict !== null}
      pending={pending}
      onClose={() => setConflict(null)}
      onReload={() => {
        setConflict(null)
        void queryClient.invalidateQueries({ queryKey: ['project', project?.id] })
        void queryClient.invalidateQueries({ queryKey: ['projects'] })
        onClose()
      }}
      onOverwrite={() => void overwrite()}
    />
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Name" htmlFor="project-name" error={error}>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'project-name-error' : undefined}
        />
      </Field>
      <Field label="Description" htmlFor="project-description">
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Optional"
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : project ? 'Save' : 'Create project'}
        </Button>
      </div>
    </form>
    </>
  )
}
