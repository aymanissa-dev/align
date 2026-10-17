import { useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import { Badge } from './chrome.tsx'
import { ErrorState, ListSkeleton } from './ui.tsx'
import { formatDateTime } from '../lib/format.ts'

const LABELS = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  complete: 'Completed',
} as const

export function ActivityPanel({ projectId }: { projectId: string }) {
  const activity = useQuery({
    queryKey: ['activity', projectId],
    queryFn: () => api.listActivity(projectId),
  })

  if (!activity.data) {
    if (activity.isLoading) return <ListSkeleton rows={4} />
    return (
      <div className="mt-8">
        <ErrorState onRetry={() => void activity.refetch()} />
      </div>
    )
  }

  if (activity.data.length === 0) {
    return <p className="mt-8 text-sm text-neutral-500">Changes in this project will show up here.</p>
  }

  return (
    <ol className="mt-8 border border-neutral-200">
      {activity.data.map((item) => (
        <li key={item.id} className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0">
          <Badge>{LABELS[item.type]}</Badge>
          <p className="min-w-0 flex-1 text-sm text-neutral-950">{item.summary}</p>
          <time className="shrink-0 font-mono text-xs text-neutral-500" dateTime={item.createdAt}>
            {formatDateTime(item.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}
