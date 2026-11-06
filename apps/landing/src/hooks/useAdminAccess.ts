import { useEffect, useState } from 'react'
import { requestAdmin } from '../lib/landingContent'

type AdminAccess =
  | { status: 'disabled' | 'checking' | 'allowed' | 'denied' }
  | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not verify admin access.'
}

export function useAdminAccess(enabled: boolean) {
  const [access, setAccess] = useState<AdminAccess>({ status: 'disabled' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setAccess({ status: 'disabled' })
      return
    }

    let active = true
    setAccess({ status: 'checking' })
    requestAdmin<{ authenticated: boolean }>('authorization')
      .then(({ authenticated }) => {
        if (active) setAccess({ status: authenticated ? 'allowed' : 'denied' })
      })
      .catch((error: unknown) => {
        if (!active) return
        console.error('Could not verify HELIX admin access:', error)
        setAccess({ status: 'error', message: errorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [attempt, enabled])

  return {
    access,
    retry: () => setAttempt((current) => current + 1),
  }
}
