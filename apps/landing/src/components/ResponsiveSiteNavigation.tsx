import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { HelixLogo } from './HelixLogo/HelixLogo'
import './ResponsiveSiteNavigation.css'

export function ResponsiveSiteNavigation() {
  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const { user } = useAuth()

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        toggleRef.current?.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <header className="site-header">
      <Link to="/" className="site-header__brand" aria-label="HELIX home" onClick={closeMenu}>
        <HelixLogo size="sm" showText />
      </Link>
      <button
        ref={toggleRef}
        type="button"
        className={`site-header__toggle${menuOpen ? ' is-open' : ''}`}
        aria-expanded={menuOpen}
        aria-controls="site-navigation"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span /><span /><span />
      </button>
      <nav
        id="site-navigation"
        className={`site-header__navigation${menuOpen ? ' is-open' : ''}`}
        aria-label="Main navigation"
      >
        <Link to="/" onClick={closeMenu}>Home</Link>
        <Link to="/features" onClick={closeMenu}>What’s New</Link>
        <Link to="/announcements" onClick={closeMenu}>Announcements</Link>
        <Link to="/docs" onClick={closeMenu}>Documentation</Link>
        <Link to="/privacy" onClick={closeMenu}>Privacy</Link>
        {user ? (
          <>
            <Link to="/admin" onClick={closeMenu}>Admin panel</Link>
            <span className="site-header__user">{user.email ?? 'GitHub account'}</span>
          </>
        ) : (
          <Link to="/login" onClick={closeMenu}>Log in</Link>
        )}
        <Link to="/download" className="site-header__download" onClick={closeMenu}>Download HELIX</Link>
      </nav>
    </header>
  )
}
