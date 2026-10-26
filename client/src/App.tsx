import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { applyAccent, applyTheme, readTheme } from './lib/theme.ts'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ConnectionStatus } from './components/ConnectionStatus.tsx'
import { AppErrorBoundary } from './components/ErrorBoundary.tsx'
import { subscribeSignedOut } from './lib/authChannel.ts'
import { subscribeWorkspaceChange } from './lib/dataChannel.ts'
import { invalidateFromPeer } from './queryClient.ts'
import { forceSignOut } from './lib/forceSignOut.ts'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { useAuth } from './auth/auth-context.ts'
import { BootScreen } from './components/BootScreen.tsx'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx'
import { Layout } from './components/Layout.tsx'
import { MarketingLayout } from './components/MarketingLayout.tsx'
import { ToastProvider } from './components/ToastProvider.tsx'
import { LandingPage } from './pages/LandingPage.tsx'
import { ChangelogPage } from './pages/ChangelogPage.tsx'
import { PrivacyPage, TermsPage } from './pages/LegalPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NoteEditorPage } from './pages/NoteEditorPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { NotesPage } from './pages/NotesPage.tsx'
import { ProjectDetailPage } from './pages/ProjectDetailPage.tsx'
import { ProjectsPage } from './pages/ProjectsPage.tsx'
import { RegisterPage } from './pages/RegisterPage.tsx'
import { SearchPage } from './pages/SearchPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { TodayPage } from './pages/TodayPage.tsx'
import { UpcomingPage } from './pages/UpcomingPage.tsx'
import { TrashPage } from './pages/TrashPage.tsx'
import { readLocalUser } from './lib/localUser.ts'
import { clearSignedOut, wasSignedOut } from './lib/signedOut.ts'
import { queryClient } from './queryClient.ts'

const DashboardPage = lazy(() => import('./pages/DashboardPage.tsx').then((module) => ({ default: module.DashboardPage })))

function safeReturnPath(state: unknown): string | null {
  if (!state || typeof state !== 'object' || !('from' in state)) return null
  const from = (state as { from?: unknown }).from
  if (!from || typeof from !== 'object') return null
  const { pathname, search, hash } = from as { pathname?: unknown; search?: unknown; hash?: unknown }
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return null
  if (pathname === '/login' || pathname === '/register') return null
  const query = typeof search === 'string' ? search : ''
  const fragment = typeof hash === 'string' ? hash : ''
  return `${pathname}${query}${fragment}`
}

function AuthBroadcast() {
  const navigate = useNavigate()
  useEffect(() => {
    return subscribeSignedOut(() => {
      forceSignOut()
      navigate('/login?signedOut=1', { replace: true })
    })
  }, [navigate])
  return null
}

function DataBroadcast() {
  useEffect(() => subscribeWorkspaceChange(() => void invalidateFromPeer()), [])
  return null
}

function ThemeSync() {
  const { user } = useAuth()
  useEffect(() => {
    applyTheme(readTheme())
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readTheme() === 'system') applyTheme('system')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    applyAccent(user?.accent ?? '#171717')
  }, [user?.accent])
  return null
}

function Guest({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <BootScreen />
  if (user) return <Navigate to={safeReturnPath(location.state) ?? '/'} replace />
  return children
}

function Protected() {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <BootScreen />
  if (!user) {
    if (wasSignedOut()) return <Navigate to="/login?signedOut=1" replace />
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Layout />
}

function Home() {
  const { user, ready } = useAuth()
  useEffect(() => {
    if (ready && !user) clearSignedOut()
  }, [ready, user])
  // Guests have no stored profile, so the landing paints before the session
  // check instead of the app-shell skeleton. A stored profile is the same
  // signal MarketingLayout uses for "Open workspace": a signed-in user is
  // likely, and the shell covers the check until they enter the workspace.
  if (!ready && !user && readLocalUser()) return <BootScreen />
  if (!user) return <LandingPage />
  return <Layout />
}

function PublicPage({ children }: { children: ReactNode }) {
  // Changelog, privacy, and terms do not need a session. Waiting on auth
  // painted the app-shell skeleton and left the title as "Align".
  return <MarketingLayout>{children}</MarketingLayout>
}

function PublicNotFound() {
  const { user, ready } = useAuth()
  if (!ready) return <BootScreen />
  if (user) {
    return (
      <Layout>
        <NotFoundPage />
      </Layout>
    )
  }
  return (
    <MarketingLayout>
      <NotFoundPage />
    </MarketingLayout>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeSync />
        <ToastProvider>
          <BrowserRouter>
            <ConnectionStatus />
            <AuthBroadcast />
            <DataBroadcast />
            <AppErrorBoundary>
            <Suspense fallback={<BootScreen />}>
            <Routes>
              <Route
                path="/login"
                element={
                  <Guest>
                    <LoginPage />
                  </Guest>
                }
              />
              <Route
                path="/forgot"
                element={
                  <Guest>
                    <ForgotPasswordPage />
                  </Guest>
                }
              />
              <Route path="/reset" element={<Navigate to="/forgot" replace />} />
              <Route path="/forgot-password" element={<Navigate to="/forgot" replace />} />
              <Route path="/reset-password" element={<Navigate to="/forgot" replace />} />
              <Route path="/verify" element={<Navigate to="/login" replace />} />
              <Route
                path="/register"
                element={
                  <Guest>
                    <RegisterPage />
                  </Guest>
                }
              />
              <Route
                path="/changelog"
                element={
                  <PublicPage>
                    <ChangelogPage />
                  </PublicPage>
                }
              />
              <Route
                path="/privacy"
                element={
                  <PublicPage>
                    <PrivacyPage />
                  </PublicPage>
                }
              />
              <Route
                path="/terms"
                element={
                  <PublicPage>
                    <TermsPage />
                  </PublicPage>
                }
              />
              <Route path="/" element={<Home />}>
                <Route index element={<DashboardPage />} />
              </Route>
              <Route element={<Protected />}>
                <Route path="/today" element={<TodayPage />} />
                <Route path="/upcoming" element={<UpcomingPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/:id" element={<NoteEditorPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/trash" element={<TrashPage />} />
              </Route>
              <Route path="*" element={<PublicNotFound />} />
            </Routes>
            </Suspense>
            </AppErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
