import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useAdminAccess } from '../../hooks/useAdminAccess'

export function RequireAuth({ children, adminOnly = false }: { children: JSX.Element; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  const { access: adminAccess, retry: retryAdminAccess } = useAdminAccess(adminOnly && Boolean(user))

  if (isLoading) {
    return <main className="auth-page"><p className="auth-subtitle">Checking your account…</p></main>
  }
  if (!user) {
    const redirectTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirectTo=${encodeURIComponent(redirectTo)}`} replace />
  }
  if (adminOnly && adminAccess.status === 'checking') {
    return <main className="auth-page"><p className="auth-subtitle">Checking admin access…</p></main>
  }
  if (adminOnly && adminAccess.status === 'denied') {
    return (
      <main className="auth-page">
        <p className="auth-alert" role="alert">Your account does not have an admin rank.</p>
        <Link to="/">Return to HELIX</Link>
      </main>
    )
  }
  if (adminOnly && adminAccess.status === 'error') {
    return (
      <main className="auth-page">
        <p className="auth-alert" role="alert">Admin access could not be verified: {adminAccess.message}</p>
        <button type="button" onClick={retryAdminAccess}>Retry</button>
        <Link to="/">Return to HELIX</Link>
      </main>
    )
  }
  if (adminOnly && adminAccess.status !== 'allowed') {
    return <main className="auth-page"><p className="auth-subtitle">Checking admin access…</p></main>
  }
  return children
}
