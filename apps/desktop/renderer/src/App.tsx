import React, { lazy, Suspense } from 'react'

const FloatingUI = lazy(() => import('./components/FloatingUI/FloatingUI'))
const Toolbox = lazy(() => import('./components/Toolbox/Toolbox'))
const TaskManager = lazy(() => import('./components/TaskManager/TaskManager'))

function getWindowType(): 'floating' | 'toolbox' | 'tasks' {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'toolbox') return 'toolbox'
  if (hash === 'tasks') return 'tasks'
  return 'floating'
}

export default function App() {
  const windowType = getWindowType()

  return (
    <Suspense fallback={<div style={{ background: '#101010', height: '100vh' }} />}>
      {windowType === 'floating' && <FloatingUI />}
      {windowType === 'toolbox' && <Toolbox />}
      {windowType === 'tasks' && <TaskManager />}
    </Suspense>
  )
}
