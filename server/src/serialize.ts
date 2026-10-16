import type { Types } from 'mongoose'
import type { ActivityDoc, LabelDoc, NoteDoc, NotificationDoc, ProjectDoc, TaskDoc, UserDoc } from './models.ts'

function docId(doc: { id?: string; _id: Types.ObjectId | { toString(): string } }): string {
  return doc.id || doc._id.toString()
}

export function publicUser(user: UserDoc) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accent: user.accent || '#171717',
    createdAt: user.createdAt.toISOString(),
  }
}

export function publicProject(project: ProjectDoc | (Pick<ProjectDoc, 'name' | 'description' | 'status' | 'createdAt' | 'updatedAt'> & { id?: string; _id: Types.ObjectId })) {
  return {
    id: docId(project),
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

export function publicLabel(label: LabelDoc | (Pick<LabelDoc, 'name' | 'color' | 'createdAt'> & { id?: string; _id: Types.ObjectId })) {
  return {
    id: docId(label),
    name: label.name,
    color: label.color,
    createdAt: label.createdAt.toISOString(),
  }
}

export function publicTask(task: TaskDoc | (Pick<TaskDoc, 'projectId' | 'title' | 'completed' | 'dueDate' | 'priority' | 'labelIds' | 'plannedFor' | 'completedOn' | 'order' | 'createdAt' | 'updatedAt'> & { id?: string; _id: Types.ObjectId })) {
  return {
    id: docId(task),
    projectId: task.projectId.toString(),
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    plannedFor: task.plannedFor ?? null,
    completedOn: task.completedOn ?? null,
    order: task.order,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

export function publicActivity(item: ActivityDoc | (Pick<ActivityDoc, 'projectId' | 'type' | 'summary' | 'createdAt'> & { id?: string; _id: Types.ObjectId })) {
  return {
    id: docId(item),
    projectId: item.projectId ? item.projectId.toString() : '',
    type: item.type,
    summary: item.summary,
    createdAt: item.createdAt.toISOString(),
  }
}

export function publicNotification(item: NotificationDoc | (Pick<NotificationDoc, 'projectId' | 'taskId' | 'kind' | 'title' | 'projectName' | 'dueDate' | 'read' | 'createdAt'> & { id?: string; _id: Types.ObjectId })) {
  return {
    id: docId(item),
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

export function publicNote(note: NoteDoc | (Pick<NoteDoc, 'projectId' | 'title' | 'body' | 'createdAt' | 'updatedAt'> & { id?: string; _id: Types.ObjectId })) {
  return {
    id: docId(note),
    projectId: note.projectId.toString(),
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  }
}
