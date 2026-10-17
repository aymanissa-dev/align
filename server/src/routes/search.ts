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

function textSearch(value: string): string | null {
  const cleaned = value
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 3) return null
  return cleaned
}

const score = { score: { $meta: 'textScore' as const } }
const projectFields = { name: 1, description: 1, status: 1, createdAt: 1, updatedAt: 1, ...score }
const taskFields = { projectId: 1, title: 1, completed: 1, ...score }
const noteFields = { projectId: 1, title: 1, body: 1, ...score }

export function searchRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const text = textSearch(queryText(req.query.q))
      if (!text) {
        res.json({ projects: [], tasks: [], notes: [] })
        return
      }

      const userId = currentUserId(req)
      const search = { $search: text }
      const [projects, tasks, notes] = await Promise.all([
        Project.find({ userId, $text: search })
          .select(projectFields)
          .sort({ score: { $meta: 'textScore' } })
          .limit(RESULT_LIMIT)
          .maxTimeMS(TIME_MS)
          .lean(),
        Task.find({ userId, $text: search })
          .select(taskFields)
          .sort({ score: { $meta: 'textScore' } })
          .limit(RESULT_LIMIT)
          .maxTimeMS(TIME_MS)
          .lean(),
        Note.find({ userId, $text: search })
          .select(noteFields)
          .sort({ score: { $meta: 'textScore' } })
          .limit(RESULT_LIMIT)
          .maxTimeMS(TIME_MS)
          .lean(),
      ])

      const projectIds = [...new Set([...tasks, ...notes].map((item) => item.projectId.toString()))]
      const named =
        projectIds.length === 0
          ? []
          : await Project.find({ userId, _id: { $in: projectIds } }).select('name').maxTimeMS(TIME_MS).lean()
      const names = new Map(named.map((project) => [project._id.toString(), project.name]))

      res.json({
        projects: projects.map(publicProject),
        tasks: tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString())
          if (!projectName) return []
          return [
            {
              id: task._id.toString(),
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
              id: note._id.toString(),
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
