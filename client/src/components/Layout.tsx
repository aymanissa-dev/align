import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { cn } from '../lib/cn.ts'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'
import { IconClose, IconDashboard, IconMenu, IconNotes, IconProjects, IconSearch, IconSettings } from './icons.tsx'

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: IconProjects, end: false },
  { to: '/notes', label: 'Notes', icon: IconNotes, end: false },
  { to: '/settings', label: 'Settings', icon: IconSettings, end: false },
] as const

function navClass(isActive: boolean): string {
  return cn(
    'focus-ring flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
    isActive ? 'bg-neutral-100 font-medium text-neutral-950' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950',
  )
}

export function Layout({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(() =>
    location.pathname === '/search' ? (new URLSearchParams(location.search).get('q') ?? '') : '',
  )
  const closeRef = useRef<HTMLButtonElement>(null)
  const routeKey = `${location.pathname}?${location.search}`
  const [syncedRoute, setSyncedRoute] = useState(routeKey)

  if (syncedRoute !== routeKey) {
    setSyncedRoute(routeKey)
    setOpen(false)
    setSearch(location.pathname === '/search' ? (params.get('q') ?? '') : '')
  }
  if (isDesktop && open) setOpen(false)

  const drawerOpen = isDesktop || open

  useEffect(() => {
    if (!drawerOpen || isDesktop) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeButton = closeRef.current
    closeButton?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen, isDesktop])

  if (!user) return null

  return (
    <div className="min-h-screen bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-1 border-b border-neutral-200 bg-white px-3 md:hidden">
        <button
          type="button"
          className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(true)}
        >
          <IconMenu />
          <span className="sr-only">Open menu</span>
        </button>
        <span className="text-sm font-medium tracking-tight">Align</span>
      </header>

      {open && !isDesktop ? (
        <div className="fixed inset-0 z-40 bg-neutral-900/30 md:hidden" onClick={() => setOpen(false)} />
      ) : null}

      <aside
        id="sidebar"
        inert={!drawerOpen ? true : undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 md:z-30',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-4 pt-5 md:pt-6">
          <NavLink to="/" className="focus-ring rounded-sm text-lg font-medium tracking-tight text-neutral-950">
            Align
          </NavLink>
          <button
            ref={closeRef}
            type="button"
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md md:hidden"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <IconClose />
          </button>
        </div>

        <form
          className="px-4 pt-5"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            const query = search.trim()
            navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search')
          }}
        >
          <label htmlFor="sidebar-search" className="sr-only">
            Search
          </label>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              id="sidebar-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="focus-ring w-full rounded-md border border-neutral-300 bg-white py-1.5 pr-3 pl-8 text-sm placeholder:text-neutral-400"
            />
          </div>
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>

        <nav className="mt-6 flex-1 space-y-1 overflow-y-auto px-3" aria-label="Primary">
          {NAV.map((item) => {
            const ItemIcon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navClass(isActive)}>
                <ItemIcon />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-neutral-200 px-4 py-4">
          <p className="truncate text-sm font-medium text-neutral-950">{user.name}</p>
          <p className="truncate text-xs text-neutral-500">{user.email}</p>
        </div>
      </aside>

      <main id="main" className="min-h-screen pt-14 md:pt-0 md:pl-60">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-16">
          {children ?? <Outlet />}
        </div>
      </main>
    </div>
  )
}
