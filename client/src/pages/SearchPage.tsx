import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/index.ts'
import { PageHeader } from '../components/chrome.tsx'
import { EmptyState, ErrorState, ListSkeleton, OfflineState } from '../components/ui.tsx'
import { excerpt } from '../lib/format.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function SearchPage() {
  const [params] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  useDocumentTitle(query ? `Search “${query}”` : 'Search')

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: query.length >= 3,
  })
  const miss = useQueryMiss(results)

  const total =
    (results.data?.projects.length ?? 0) + (results.data?.tasks.length ?? 0) + (results.data?.notes.length ?? 0)

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title={query ? `Results for “${query}”` : 'Search'}
        description={
          !query
            ? 'Find a project, task, or note.'
            : query.length < 3
              ? 'Type at least 3 characters.'
              : results.data
                ? `${total} ${total === 1 ? 'match' : 'matches'}`
                : 'Looking through your workspace.'
        }
      />

      {query.length >= 3 && miss === 'loading' ? <ListSkeleton rows={4} /> : null}
      {query.length >= 3 && miss === 'offline' ? (
        <div className="mt-8">
          <OfflineState />
        </div>
      ) : null}
      {query.length >= 3 && miss === 'error' ? (
        <div className="mt-8">
          <ErrorState onRetry={() => void results.refetch()} />
        </div>
      ) : null}

      {query && results.data && total === 0 ? (
        <div className="mt-8">
          <EmptyState title="No matches" body={`Nothing matches “${query}”.`} />
        </div>
      ) : null}

      {results.data && results.data.projects.length > 0 ? (
        <Group title="Projects" count={results.data.projects.length}>
          {results.data.projects.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`} className="focus-ring block border-b border-neutral-200 px-4 py-3 last:border-b-0 hover:bg-neutral-50">
                <p className="font-medium text-neutral-950">
                  <Highlight text={project.name} query={query} />
                </p>
                {project.description ? (
                  <p className="mt-1 text-sm text-neutral-500">
                    <Highlight text={excerpt(project.description, query)} query={query} />
                  </p>
                ) : null}
                {project.status === 'archived' ? <p className="mt-1 text-xs text-neutral-400">Archived</p> : null}
              </Link>
            </li>
          ))}
        </Group>
      ) : null}

      {results.data && results.data.tasks.length > 0 ? (
        <Group title="Tasks" count={results.data.tasks.length}>
          {results.data.tasks.map((task) => (
            <li key={task.id}>
              <Link
                to={`/projects/${task.projectId}`}
                className="focus-ring block border-b border-neutral-200 px-4 py-3 last:border-b-0 hover:bg-neutral-50"
              >
                <p className="font-medium text-neutral-950">
                  <Highlight text={task.title} query={query} />
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  {task.projectName}
                  {task.completed ? ' · Done' : ''}
                </p>
              </Link>
            </li>
          ))}
        </Group>
      ) : null}

      {results.data && results.data.notes.length > 0 ? (
        <Group title="Notes" count={results.data.notes.length}>
          {results.data.notes.map((note) => (
            <li key={note.id}>
              <Link to={`/notes/${note.id}`} className="focus-ring block border-b border-neutral-200 px-4 py-3 last:border-b-0 hover:bg-neutral-50">
                <p className="font-medium text-neutral-950">
                  <Highlight text={note.title} query={query} />
                </p>
                <p className="mt-1 text-sm text-neutral-500">{note.projectName}</p>
                {note.body.trim() ? (
                  <p className="mt-1 text-sm leading-6 text-neutral-500">
                    <Highlight text={excerpt(note.body, query)} query={query} />
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </Group>
      ) : null}
    </div>
  )
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="mt-8 border border-neutral-200">
      <h2 className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
        {title}
        <span className="font-mono text-xs tracking-normal text-neutral-500 normal-case tabular-nums">{count}</span>
      </h2>
      <ul>{children}</ul>
    </section>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (!needle) return text
  const index = text.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-neutral-200 text-inherit">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}
