import { Router } from 'express'
import { relevanceScore, searchTokens } from '../../../shared/search.ts'
import { bind } from '../data/content.ts'
import { currentTenant } from '../data/tenant.ts'
import { ensureSearchWords } from '../db.ts'
import { asyncHandler, requireAuth } from '../middleware.ts'
import { publicProject } from '../serialize.ts'

const RESULT_LIMIT = 20
const CANDIDATE_LIMIT = 60
const TIME_MS = 800

function queryText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 200)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every token is a case-sensitive prefix of a lowercase searchWords entry, ANDed. */
function tokenFilter(tokens: string[]) {
  return {
    $and: tokens.map((token) => ({ searchWords: { $regex: `^${escapeRegExp(token)}` } })),
  }
}

function byScore<T extends { score: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score).slice(0, RESULT_LIMIT)
}

export function searchRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const tokens = searchTokens(queryText(req.query.q))
      if (!tokens) {
        res.json({ projects: [], tasks: [], notes: [] })
        return
      }

      await ensureSearchWords()
      const db = bind(currentTenant(req))
      const filter = tokenFilter(tokens)
      const [projects, tasks, notes] = await Promise.all([
        db.projects
          .find(filter)
          .select('name description status createdAt updatedAt __v')
          .limit(CANDIDATE_LIMIT)
          .maxTimeMS(TIME_MS)
          .lean(),
        db.tasks
          .find(filter)
          .select('projectId title completed')
          .limit(CANDIDATE_LIMIT)
          .maxTimeMS(TIME_MS)
          .lean(),
        db.notes
          .find(filter)
          .select('projectId title body')
          .limit(CANDIDATE_LIMIT)
          .maxTimeMS(TIME_MS)
          .lean(),
      ])

      const projectIds = [...new Set([...tasks, ...notes].map((item) => item.projectId.toString()))]
      const named =
        projectIds.length === 0
          ? []
          : await db.projects.find({ _id: { $in: projectIds } }).select('name').maxTimeMS(TIME_MS).lean()
      const names = new Map(named.map((project) => [project._id.toString(), project.name]))

      const rankedProjects = byScore(
        projects.map((project) => ({
          project,
          score: relevanceScore(tokens, [
            { text: project.name, weight: 5 },
            { text: project.description, weight: 1 },
          ]),
        })),
      )
      const rankedTasks = byScore(
        tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString())
          if (!projectName) return []
          return [
            {
              task,
              projectName,
              score: relevanceScore(tokens, [{ text: task.title, weight: 5 }]),
            },
          ]
        }),
      )
      const rankedNotes = byScore(
        notes.flatMap((note) => {
          const projectName = names.get(note.projectId.toString())
          if (!projectName) return []
          return [
            {
              note,
              projectName,
              score: relevanceScore(tokens, [
                { text: note.title, weight: 5 },
                { text: note.body, weight: 1 },
              ]),
            },
          ]
        }),
      )

      res.json({
        projects: rankedProjects.map((item) => publicProject(item.project)),
        tasks: rankedTasks.map((item) => ({
          id: item.task._id.toString(),
          projectId: item.task.projectId.toString(),
          projectName: item.projectName,
          title: item.task.title,
          completed: item.task.completed,
        })),
        notes: rankedNotes.map((item) => ({
          id: item.note._id.toString(),
          projectId: item.note.projectId.toString(),
          projectName: item.projectName,
          title: item.note.title,
          body: item.note.body,
        })),
      })
    }),
  )

  return router
}
