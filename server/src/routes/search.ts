import { Router } from 'express'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Note, Project, Task } from '../models.ts'
import { publicProject } from '../serialize.ts'

const RESULT_LIMIT = 20
const TIME_MS = 800

function queryText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 200)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textSearch(value: string): string | null {
  const cleaned = value
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 3) return null
  return cleaned
}

async function settle<T>(query: Promise<T[]>): Promise<T[]> {
  try {
    return await query
  } catch (error) {
    console.error(error)
    return []
  }
}

function mergeById<T>(groups: T[][], idOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const group of groups) {
    for (const item of group) {
      const id = idOf(item)
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(item)
      if (merged.length >= RESULT_LIMIT) return merged
    }
  }
  return merged
}

async function whenText<T>(text: string | null, query: () => Promise<T[]>): Promise<T[]> {
  if (!text) return []
  return settle(query())
}

export function searchRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = queryText(req.query.q)
      if (!query) {
        res.json({ projects: [], tasks: [], notes: [] })
        return
      }

      const userId = currentUserId(req)
      const prefix = { $regex: `^${escapeRegex(query)}`, $options: 'i' }
      const text = textSearch(query)

      const [projectText, projectName, taskText, taskTitle, noteText, noteTitle, ownedProjects] = await Promise.all([
        whenText(text, () => Project.find({ userId, $text: { $search: text ?? '' } }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS)),
        settle(
          Project.find({ userId, name: prefix })
            .sort({ updatedAt: -1 })
            .limit(RESULT_LIMIT)
            .maxTimeMS(TIME_MS),
        ),
        whenText(text, () => Task.find({ userId, $text: { $search: text ?? '' } }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS)),
        settle(Task.find({ userId, title: prefix }).sort({ updatedAt: -1 }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS)),
        whenText(text, () => Note.find({ userId, $text: { $search: text ?? '' } }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS)),
        settle(Note.find({ userId, title: prefix }).sort({ updatedAt: -1 }).limit(RESULT_LIMIT).maxTimeMS(TIME_MS)),
        Project.find({ userId }).select('name').maxTimeMS(TIME_MS),
      ])

      const projects = mergeById([projectText, projectName], (item) => item.id)
      const tasks = mergeById([taskText, taskTitle], (item) => item.id)
      const notes = mergeById([noteText, noteTitle], (item) => item.id)
      const names = new Map(ownedProjects.map((project) => [project.id, project.name]))

      res.json({
        projects: projects.map(publicProject),
        tasks: tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString())
          if (!projectName) return []
          return [
            {
              id: task.id,
              projectId: task.projectId.toString(),
              projectName,
              title: task.title,
              completed: task.completed,
            },
          ]
        }),
        notes: notes.flatMap((note) => {
          const projectName = names.get(note.projectId.toString())
          if (!projectName) return []
          return [
            {
              id: note.id,
              projectId: note.projectId.toString(),
              projectName,
              title: note.title,
              body: note.body,
            },
          ]
        }),
      })
    }),
  )

  return router
}
