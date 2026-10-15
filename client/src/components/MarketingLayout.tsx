import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { buttonClass } from '../lib/buttonClass.ts'
import { Eyebrow } from './chrome.tsx'

export function MarketingLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link to="/" className="focus-ring text-sm font-medium tracking-[-0.03em]">
            Align
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account">
            {user ? (
              <Link to="/" className={buttonClass('primary', 'px-3.5')}>
                Open workspace
              </Link>
            ) : (
              <>
                <Link to="/login" className="focus-ring px-3 py-2 text-sm text-neutral-700 hover:text-neutral-950">
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
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-sm font-medium tracking-[-0.03em]">Align</p>
            <p className="mt-2 max-w-xs text-sm leading-6 text-neutral-600">Keep your work in alignment.</p>
          </div>
          <div>
            <Eyebrow>Product</Eyebrow>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-neutral-700" aria-label="Product">
              {user ? (
                <Link to="/" className="focus-ring w-fit hover:text-neutral-950">
                  Workspace
                </Link>
              ) : (
                <>
                  <Link to="/register" className="focus-ring w-fit hover:text-neutral-950">
                    Get started
                  </Link>
                  <Link to="/login" className="focus-ring w-fit hover:text-neutral-950">
                    Sign in
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div>
            <Eyebrow>Legal</Eyebrow>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-neutral-700" aria-label="Footer">
              <Link to="/privacy" className="focus-ring w-fit hover:text-neutral-950">
                Privacy
              </Link>
              <Link to="/terms" className="focus-ring w-fit hover:text-neutral-950">
                Terms
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}
