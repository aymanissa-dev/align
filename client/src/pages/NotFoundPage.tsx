import { Link } from 'react-router-dom'
import { buttonClass } from '../lib/buttonClass.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function NotFoundPage() {
  useDocumentTitle('Page not found')

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-24 sm:px-8">
      <p className="text-sm text-neutral-500">404</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Page not found</h1>
      <p className="mt-4 text-sm leading-6 text-neutral-600">That address is not part of Align.</p>
      <Link to="/" className={buttonClass('primary', 'mt-8 px-4')}>
        Back home
      </Link>
    </div>
  )
}
