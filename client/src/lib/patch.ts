import type { NotePatch, ProjectPatch, Task, TaskPatch, TaskPriority } from '../api/types.ts'

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((id, index) => id === b[index])
}

export function taskFieldPatch(
  base: Pick<Task, 'title' | 'dueDate' | 'priority' | 'labelIds'>,
  draft: { title: string; dueDate: string | null; priority: TaskPriority; labelIds: string[] },
): TaskPatch {
  const patch: TaskPatch = {}
  if (draft.title !== base.title) patch.title = draft.title
  if ((draft.dueDate || null) !== (base.dueDate || null)) patch.dueDate = draft.dueDate
  if (draft.priority !== base.priority) patch.priority = draft.priority
  if (!sameIds(draft.labelIds, base.labelIds)) patch.labelIds = draft.labelIds
  return patch
}

export function noteFieldPatch(base: { title: string; body: string }, draft: { title: string; body: string }): NotePatch {
  const patch: NotePatch = {}
  if (draft.title !== base.title) patch.title = draft.title
  if (draft.body !== base.body) patch.body = draft.body
  return patch
}

export function projectFieldPatch(
  base: { name: string; description: string },
  draft: { name: string; description: string },
): ProjectPatch {
  const patch: ProjectPatch = {}
  if (draft.name !== base.name) patch.name = draft.name
  if (draft.description !== base.description) patch.description = draft.description
  return patch
}
