import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { applyAccent, applyTheme, readTheme } from './lib/theme.ts'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { useAuth } from './auth/auth-context.ts'
import { BootScreen } from './components/BootScreen.tsx'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx'
import { Layout } from './components/Layout.tsx'
import { MarketingLayout } from './components/MarketingLayout.tsx'
import { ToastProvider } from './components/ToastProvider.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { LandingPage } from './pages/LandingPage.tsx'
import { PrivacyPage, TermsPage } from './pages/LegalPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NoteEditorPage } from './pages/NoteEditorPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { NotesPage } from './pages/NotesPage.tsx'
import { ProjectDetailPage } from './pages/ProjectDetailPage.tsx'
import { ProjectsPage } from './pages/ProjectsPage.tsx'
import { RegisterPage } from './pages/RegisterPage.tsx'
import { VerifyEmailPage } from './pages/VerifyEmailPage.tsx'
import { SearchPage } from './pages/SearchPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { TodayPage } from './pages/TodayPage.tsx'
import { clearSignedOut, wasSignedOut } from './lib/signedOut.ts'
import { queryClient } from './queryClient.ts'

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
    if (wasSignedOut()) return <Navigate to="/" replace />
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Layout />
}

function Home() {
  const { user, ready } = useAuth()
  useEffect(() => {
    if (ready && !user) clearSignedOut()
  }, [ready, user])
  if (!ready) return <BootScreen />
  if (!user) return <LandingPage />
  return <Layout />
}

function PublicPage({ children }: { children: ReactNode }) {
  const { ready } = useAuth()
  if (!ready) return <BootScreen />
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
              <Route path="/reset" element={<ResetPasswordPage />} />
              <Route path="/verify" element={<VerifyEmailPage />} />
              <Route
                path="/register"
                element={
                  <Guest>
                    <RegisterPage />
                  </Guest>
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
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/:id" element={<NoteEditorPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<PublicNotFound />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
