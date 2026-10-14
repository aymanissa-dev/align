import { Types } from 'mongoose'
import { HttpError } from './errors.ts'
import { Note, Project, Task, type NoteDoc, type ProjectDoc, type TaskDoc } from './models.ts'

export function objectId(id: string): Types.ObjectId | null {
  if (!/^[a-f\d]{24}$/i.test(id)) return null
  return new Types.ObjectId(id)
}

export async function requireProject(userId: string, id: string): Promise<ProjectDoc> {
  const projectId = objectId(id)
  if (!projectId) throw new HttpError(404, 'Project not found.')
  const project = await Project.findOne({ _id: projectId, userId })
  if (!project) throw new HttpError(404, 'Project not found.')
  return project
}

export async function requireTask(userId: string, id: string): Promise<TaskDoc> {
  const taskId = objectId(id)
  if (!taskId) throw new HttpError(404, 'Task not found.')
  const task = await Task.findOne({ _id: taskId, userId })
  if (!task) throw new HttpError(404, 'Task not found.')
  return task
}

export async function requireNote(userId: string, id: string): Promise<NoteDoc> {
  const noteId = objectId(id)
  if (!noteId) throw new HttpError(404, 'Note not found.')
  const note = await Note.findOne({ _id: noteId, userId })
  if (!note) throw new HttpError(404, 'Note not found.')
  return note
}

export async function touchProject(projectId: Types.ObjectId, userId: string): Promise<void> {
  await Project.updateOne({ _id: projectId, userId }, { $currentDate: { updatedAt: true } })
}
