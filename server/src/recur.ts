import type { RecurrenceInterval } from '../../shared/dates.ts'
import { nextOccurrenceDate } from '../../shared/dates.ts'
import type { bind } from './data/content.ts'
import type { TaskDoc } from './models.ts'

type Content = ReturnType<typeof bind>

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

function isRecurrence(value: string | null | undefined): value is RecurrenceInterval {
  return value === 'daily' || value === 'weekly' || value === 'monthly'
}

/**
 * Keep the finished occurrence and add the next one.
 * The spawn key is stable for a completion day, so a retried PATCH does not
 * create a second copy.
 */
export async function spawnNextOccurrence(db: Content, task: TaskDoc, today: string): Promise<TaskDoc | null> {
  if (!isRecurrence(task.recurrence) || !task.completed) return null
  const spawnKey = `recur:${task._id.toString()}:${task.completedOn ?? today}`
  const existing = await db.tasks.findOne({ clientId: spawnKey })
  if (existing) return null
  const dueDate = nextOccurrenceDate(task.dueDate, task.recurrence, today)
  const latest = await db.tasks.findOne({ projectId: task.projectId }).sort({ order: -1 }).select('order')
  const subtasks = (task.subtasks ?? []).flatMap((item) => {
    if (!item.text) return []
    return [{ id: crypto.randomUUID(), text: item.text, completed: false }]
  })
  try {
    return await db.tasks.create({
      projectId: task.projectId,
      title: task.title,
      completed: false,
      dueDate,
      priority: task.priority,
      labelIds: task.labelIds,
      plannedFor: null,
      completedOn: null,
      order: (latest?.order ?? task.order) + 1,
      clientId: spawnKey,
      recurrence: task.recurrence,
      status: 'todo',
      subtasks,
    })
  } catch (error) {
    if (isDuplicateKey(error)) return null
    throw error
  }
}
