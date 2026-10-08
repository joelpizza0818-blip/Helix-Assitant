import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <main className="auth-page"><p className="auth-subtitle">Checking your account…</p></main>
  }
  if (!user) {
    const redirectTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirectTo=${encodeURIComponent(redirectTo)}`} replace />
  }
  return children
}
