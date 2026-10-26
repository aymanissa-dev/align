import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { buttonClass } from '../lib/buttonClass.ts'
import { readLocalUser } from '../lib/localUser.ts'
import { Eyebrow } from './chrome.tsx'
import { Reveal } from './Reveal.tsx'

export function MarketingLayout({ children }: { children: ReactNode }) {
  const { user: sessionUser, ready } = useAuth()
  // These pages paint before the session check finishes. A stored profile keeps
  // "Open workspace" in place until that check confirms who is signed in.
  const user = ready ? sessionUser : readLocalUser()

  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="site-header sticky top-0 z-20">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link to="/" className="focus-ring text-sm font-medium tracking-[-0.03em] text-current">
            Align
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
            {user ? (
              <Link to="/" className={buttonClass('primary', 'press px-3.5')}>
                Open workspace
              </Link>
            ) : (
              <>
                <Link to="/login" className="nav-link focus-ring inline-flex min-h-11 items-center px-3 text-sm font-medium">
                  <span className="text-link">Sign in</span>
                </Link>
                <Link to="/register" className={buttonClass('primary', 'press px-3.5')}>
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
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-8 sm:px-8 sm:py-10 md:grid-cols-[1.5fr_auto_auto] md:items-start md:gap-16">
          <Reveal>
            <div className="border-b border-dashed border-neutral-200 pb-6 md:border-b-0 md:pb-0">
              <p className="text-sm font-medium tracking-[-0.03em]">Align</p>
              <p className="mt-1.5 max-w-xs text-sm leading-6 text-neutral-600">Keep your work in alignment.</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <Eyebrow>Product</Eyebrow>
            <nav className="mt-3 flex flex-col gap-1.5 text-sm text-neutral-700" aria-label="Product">
              {user ? (
                <Link to="/" className="text-link focus-ring w-fit hover:text-neutral-950">
                  Workspace
                </Link>
              ) : (
                <>
                  <Link to="/register" className="text-link focus-ring w-fit hover:text-neutral-950">
                    Get started
                  </Link>
                  <Link to="/login" className="text-link focus-ring w-fit hover:text-neutral-950">
                    Sign in
                  </Link>
                </>
              )}
              <Link to="/changelog" className="text-link focus-ring w-fit hover:text-neutral-950">
                Changelog
              </Link>
            </nav>
          </Reveal>
          <Reveal delay={150}>
            <Eyebrow>Legal</Eyebrow>
            <nav className="mt-3 flex flex-col gap-1.5 text-sm text-neutral-700" aria-label="Footer">
              <Link to="/privacy" className="text-link focus-ring w-fit hover:text-neutral-950">
                Privacy
              </Link>
              <Link to="/terms" className="text-link focus-ring w-fit hover:text-neutral-950">
                Terms
              </Link>
            </nav>
          </Reveal>
        </div>
      </footer>
    </div>
  )
}
