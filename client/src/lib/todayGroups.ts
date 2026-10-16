import type { TodayData, TodayTask } from '../api/types.ts'

export type TodayGroups = {
  open: TodayTask[]
  done: TodayTask[]
  overdue: TodayTask[]
  carried: TodayTask[]
  available: TodayTask[]
}

function unique(data: TodayData): TodayTask[] {
  const byId = new Map<string, TodayTask>()
  for (const task of [
    ...data.planned,
    ...data.carried,
    ...(data.overdue ?? []),
    ...data.available,
    ...(data.finished ?? []),
  ]) {
    byId.set(task.id, task)
  }
  return [...byId.values()]
}

/**
 * Groups a day using calendar dates (YYYY-MM-DD), never instants.
 * A future due date is not carried over. Overdue work stays out of the
 * unscheduled list. Anything completed on this calendar day is Done.
 */
export function groupToday(data: TodayData, date: string): TodayGroups {
  const all = unique(data)
  const onToday = all.filter((task) => task.plannedFor === date)
  const overdue = all.filter(
    (task) => !task.completed && Boolean(task.dueDate) && (task.dueDate ?? '') < date && task.plannedFor !== date,
  )
  const overdueIds = new Set(overdue.map((task) => task.id))
  const carried = all.filter(
    (task) =>
      !task.completed &&
      Boolean(task.plannedFor) &&
      (task.plannedFor ?? '') < date &&
      !overdueIds.has(task.id) &&
      !(task.dueDate && task.dueDate > date),
  )
  const taken = new Set([...onToday, ...overdue, ...carried].map((task) => task.id))
  return {
    open: onToday.filter((task) => !task.completed),
    done: all.filter((task) => task.completed && (task.completedOn === date || task.plannedFor === date)),
    overdue,
    carried,
    available: all.filter((task) => !task.completed && !taken.has(task.id)),
  }
}
