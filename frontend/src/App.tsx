import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore, authActions } from './stores/auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import LoginPage   from './pages/Login'
import Dashboard   from './pages/Dashboard'
import AdminLayout from './pages/Admin'

function RequireAuth({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !user.is_admin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const navigate  = useNavigate()
  const clearAuth = authActions.clearAuth

  useEffect(() => {
    const handler = () => { clearAuth(); navigate('/login') }
    window.addEventListener('op:unauthorized', handler)
    return () => window.removeEventListener('op:unauthorized', handler)
  }, [clearAuth, navigate])

  return (
    <ErrorBoundary fallback="OpenPortal failed to load. Try refreshing the page.">
      <Routes>
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/admin/*"  element={<RequireAuth adminOnly><AdminLayout /></RequireAuth>} />
        <Route path="/"         element={<Navigate to="/dashboard" replace />} />
        <Route path="*"         element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
