import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { Project } from '../api/types.ts'
import { errorMessage } from '../lib/errorMessage.ts'
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
  const toast = useToast()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    setPending(true)
    try {
      if (project) {
        await api.updateProject(project.id, { name, description })
        await invalidateWorkspace()
        toast('Project updated')
        onClose()
      } else {
        const created = await api.createProject({ name, description })
        await invalidateWorkspace()
        toast('Project created')
        onClose()
        navigate(`/projects/${created.id}`)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
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
  )
}
