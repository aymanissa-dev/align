import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { buttonClass } from '../lib/buttonClass.ts'

export function MarketingLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link to="/" className="focus-ring rounded-sm text-lg font-medium tracking-tight">
            Align
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
            {user ? (
              <Link to="/" className={buttonClass('primary', 'px-3.5')}>
                Open workspace
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="focus-ring rounded-md px-3 py-2 text-sm text-neutral-700 hover:text-neutral-950"
                >
                  Sign in
                </Link>
                <Link to="/register" className={buttonClass('primary', 'px-3.5')}>
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div>
            <p className="text-sm font-medium">Align</p>
            <p className="mt-1 text-sm text-neutral-500">Keep your work in alignment.</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600" aria-label="Footer">
            {user ? (
              <Link to="/" className="focus-ring rounded-sm hover:text-neutral-950">
                Workspace
              </Link>
            ) : (
              <>
                <Link to="/login" className="focus-ring rounded-sm hover:text-neutral-950">
                  Sign in
                </Link>
                <Link to="/register" className="focus-ring rounded-sm hover:text-neutral-950">
                  Get started
                </Link>
              </>
            )}
            <Link to="/privacy" className="focus-ring rounded-sm hover:text-neutral-950">
              Privacy
            </Link>
            <Link to="/terms" className="focus-ring rounded-sm hover:text-neutral-950">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
