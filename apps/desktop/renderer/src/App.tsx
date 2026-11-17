import React, { lazy, Suspense, useState, useEffect } from 'react'

const ConfirmationToast = lazy(() => import('./components/ConfirmationToast/ConfirmationToast'))
const AgentPanel = lazy(() => import('./components/AgentPanel/AgentPanel'))
const FloatingUI = lazy(() => import('./components/FloatingUI/FloatingUI'))
const Toolbox = lazy(() => import('./components/Toolbox/Toolbox'))
const TaskManager = lazy(() => import('./components/TaskManager/TaskManager'))
const DesktopPreview = lazy(() => import('./components/DesktopPreview/DesktopPreview'))

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[App] Fatal window render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: '#f87171', background: '#121212', height: '100vh', fontFamily: 'sans-serif', boxSizing: 'border-box' }}>
          <h2 style={{ fontSize: 18, marginBottom: 12, color: '#ef4444' }}>No se pudo abrir esta ventana</h2>
          <p>Recárgala. Si el problema continúa, cierra y vuelve a abrir HELIX.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 16px', background: '#e27218', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function getWindowType(): 'floating' | 'toolbox' | 'tasks' | 'confirmation' | 'agents' | 'desktop-preview' {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'toolbox') return 'toolbox'
  if (hash === 'tasks') return 'tasks'
  if (hash === 'confirmation') return 'confirmation'
  if (hash === 'agents') return 'agents'
  if (hash === 'desktop-preview') return 'desktop-preview'
  return 'floating'
}

export default function App() {
  const [windowType, setWindowType] = useState(getWindowType)

  useEffect(() => {
    const handleHash = () => setWindowType(getWindowType())
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  return (
    <AppErrorBoundary>
      <Suspense fallback={<div style={{ background: '#101010', height: '100vh' }} />}>
        {windowType === 'floating' && <FloatingUI />}
        {windowType === 'toolbox' && <Toolbox />}
        {windowType === 'tasks' && <TaskManager />}
        {windowType === 'confirmation' && <ConfirmationToast />}
        {windowType === 'agents' && <AgentPanel />}
        {windowType === 'desktop-preview' && <DesktopPreview />}
      </Suspense>
    </AppErrorBoundary>
  )
}
