import { Router } from 'express'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Note, Project, Task } from '../models.ts'
import { publicProject } from '../serialize.ts'

const RESULT_LIMIT = 50

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

async function searchDocs<T extends { updatedAt: Date }>(
  query: string,
  byText: (text: string) => Promise<T[]>,
  byRegex: () => Promise<T[]>,
): Promise<T[]> {
  const text = textSearch(query)
  if (text) {
    try {
      const hits = await byText(text)
      if (hits.length > 0) {
        return hits.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      }
    } catch (error) {
      console.error(error)
    }
  }
  return byRegex()
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
      const pattern = escapeRegex(query)
      const contains = { $regex: pattern, $options: 'i' }
      const [projects, tasks, notes, ownedProjects] = await Promise.all([
        searchDocs(
          query,
          (text) => Project.find({ userId, $text: { $search: text } }).limit(RESULT_LIMIT),
          () =>
            Project.find({ userId, $or: [{ name: contains }, { description: contains }] })
              .sort({ updatedAt: -1 })
              .limit(RESULT_LIMIT),
        ),
        searchDocs(
          query,
          (text) => Task.find({ userId, $text: { $search: text } }).limit(RESULT_LIMIT),
          () => Task.find({ userId, title: contains }).sort({ updatedAt: -1 }).limit(RESULT_LIMIT),
        ),
        searchDocs(
          query,
          (text) => Note.find({ userId, $text: { $search: text } }).limit(RESULT_LIMIT),
          () =>
            Note.find({ userId, $or: [{ title: contains }, { body: contains }] })
              .sort({ updatedAt: -1 })
              .limit(RESULT_LIMIT),
        ),
        Project.find({ userId }).select('name'),
      ])
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
