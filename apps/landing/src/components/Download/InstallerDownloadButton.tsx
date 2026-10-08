import { useState } from 'react'
import { getInstallerDownloadUrl } from '../../lib/downloads'
import { useAuth } from '../../hooks/useAuth'
import { Link } from 'react-router-dom'

interface Props {
  className: string
  children: string
}

export function InstallerDownloadButton({ className, children }: Props) {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownload = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const url = await getInstallerDownloadUrl()
      window.location.assign(url)
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'Could not authorize installer download. Please sign in and try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (isAuthLoading) {
    return <button className={className} type="button" disabled>Checking account…</button>
  }
  if (!user) {
    return <Link className={className} to="/login?redirectTo=%2Fdownload">{children}</Link>
  }

  return (
    <div>
      <button className={className} type="button" onClick={() => void handleDownload()} disabled={isLoading}>
        {isLoading ? 'Preparing download…' : children}
      </button>
      {error && <p className="auth-alert" role="alert">{error}</p>}
    </div>
  )
}
