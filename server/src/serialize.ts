import type { ActivityDoc, LabelDoc, NoteDoc, NotificationDoc, ProjectDoc, TaskDoc, UserDoc } from './models.ts'

export function publicUser(user: UserDoc) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  }
}

export function publicProject(project: ProjectDoc) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

export function publicLabel(label: LabelDoc) {
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    createdAt: label.createdAt.toISOString(),
  }
}

export function publicTask(task: TaskDoc) {
  return {
    id: task.id,
    projectId: task.projectId.toString(),
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    order: task.order,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

export function publicActivity(item: ActivityDoc) {
  return {
    id: item.id,
    projectId: item.projectId.toString(),
    type: item.type,
    summary: item.summary,
    createdAt: item.createdAt.toISOString(),
  }
}

export function publicNotification(item: NotificationDoc) {
  return {
    id: item.id,
    projectId: item.projectId.toString(),
    taskId: item.taskId.toString(),
    kind: item.kind,
    title: item.title,
    projectName: item.projectName,
    dueDate: item.dueDate,
    read: item.read,
    createdAt: item.createdAt.toISOString(),
  }
}

export function publicNote(note: NoteDoc) {
  return {
    id: note.id,
    projectId: note.projectId.toString(),
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  }
}
