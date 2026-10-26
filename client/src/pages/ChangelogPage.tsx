import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { CHANGELOG } from './changelog.ts'

function formatReleaseDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export function ChangelogPage() {
  useDocumentTitle('Changelog')

  return (
    <article className="mx-auto w-full max-w-2xl px-5 py-16 sm:px-8 sm:py-24">
      <p className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Product</p>
      <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">Changelog</h1>
      <p className="mt-3 text-sm leading-7 text-neutral-600">What changed in Align, newest first.</p>
      <ol className="mt-10 border border-neutral-200">
        {CHANGELOG.map((entry) => (
          <li key={entry.date} className="border-b border-neutral-200 px-5 py-6 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-base font-medium text-neutral-950">{entry.title}</h2>
              <time dateTime={entry.date} className="font-mono text-xs text-neutral-500">
                {formatReleaseDate(entry.date)}
              </time>
            </div>
            <ul className="mt-4 space-y-2.5">
              {entry.items.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-neutral-700">
                  <span aria-hidden="true" className="mt-[0.55rem] size-1.5 shrink-0 border border-current" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </article>
  )
}
