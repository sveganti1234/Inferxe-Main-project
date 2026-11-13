import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, LogOut, Menu, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { NAV } from '../../data/site'
import { Logo } from '../Logo'
import { LinkButton } from '../ui/Button'
import { getSession, clearSession } from '../../lib/authStore'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [mobile, setMobile] = useState(false)
  const [session, setSession] = useState(() => getSession())
  const { pathname } = useLocation()
  const closeTimer = useRef<number>(0)

  useEffect(() => {
    const handleAuthChange = () => setSession(getSession())
    window.addEventListener('inferxe_auth_change', handleAuthChange)
    window.addEventListener('storage', handleAuthChange)
    return () => {
      window.removeEventListener('inferxe_auth_change', handleAuthChange)
      window.removeEventListener('storage', handleAuthChange)
    }
  }, [])

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    setOpen(null)
    setMobile(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : ''
    document.body.classList.toggle('has-mnav-open', mobile)
    return () => {
      document.body.style.overflow = ''
      document.body.classList.remove('has-mnav-open')
    }
  }, [mobile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(null), setMobile(false))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hoverOpen = (label: string) => {
    window.clearTimeout(closeTimer.current)
    setOpen(label)
  }
  const hoverClose = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(null), 120)
  }

  return (
    <header className={`nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="nav__inner container">
        <Link to="/" className="nav__logo" aria-label="Inferxe — home">
          <Logo />
        </Link>

        <nav className="nav__links" aria-label="Primary">
          {NAV.map((item) =>
            item.items ? (
              <div
                key={item.label}
                className="nav__group"
                onMouseEnter={() => hoverOpen(item.label)}
                onMouseLeave={hoverClose}
                onFocus={() => hoverOpen(item.label)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) hoverClose()
                }}
              >
                <button
                  className={`nav__link ${open === item.label ? 'is-open' : ''}`}
                  aria-expanded={open === item.label}
                  aria-haspopup="true"
                  onClick={() => setOpen(open === item.label ? null : item.label)}
                >
                  {item.label}
                  <ChevronDown aria-hidden />
                </button>
                <AnimatePresence>
                  {open === item.label && (
                    <motion.div
                      className="nav__panel glass glass--deep"
                      initial={{ opacity: 0, y: 10, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.98 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {item.items.map((l, i) => (
                        <motion.div key={l.to} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i + 0.05 }}>
                          <Link to={l.to} className="nav__leaf">
                            <span className="icon-tile icon-tile--sm">
                              <l.icon />
                            </span>
                            <span>
                              <strong>{l.title}</strong>
                              <small>{l.desc}</small>
                            </span>
                          </Link>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <NavLink key={item.label} to={item.to} className={({ isActive }) => `nav__link ${isActive ? 'is-active' : ''}`}>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="nav__actions">
          <button className="nav__search" onClick={() => window.dispatchEvent(new Event('inferxe:palette'))} aria-label="Search the site (Ctrl K)">
            <Search aria-hidden />
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          {session ? (
            <>
              <Link to="/dashboard/customer" className="nav__profile">
                <span className="nav__profile-avatar">{session.user.fullName.charAt(0).toUpperCase()}</span>
                <span className="nav__profile-name">{session.user.fullName}</span>
              </Link>
              <button className="nav__signout" onClick={() => { clearSession(); window.location.replace('/') }}>
                <LogOut size={14} /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav__signin">
                Sign in
              </Link>
              <LinkButton to="/signup" size="sm" arrow className="nav__cta">
                Sign up
              </LinkButton>
            </>
          )}
          <button className="nav__burger" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} onClick={() => setMobile((v) => !v)}>
            {mobile ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobile && (
          <motion.div className="mnav glass glass--deep" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="mnav__scroll">
              {NAV.map((item, gi) => (
                <motion.div key={item.label} className="mnav__group" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * gi + 0.05 }}>
                  {item.items ? (
                    <>
                      <span className="mnav__label">{item.label}</span>
                      {item.items.map((l) => (
                        <Link key={l.to} to={l.to} className="mnav__link" onClick={() => setMobile(false)}>
                          <l.icon aria-hidden /> {l.title}
                        </Link>
                      ))}
                    </>
                  ) : (
                    <Link to={item.to} className="mnav__link mnav__link--top" onClick={() => setMobile(false)}>
                      {item.label}
                    </Link>
                  )}
                </motion.div>
              ))}
              {session ? (
                <>
                  <div className="mnav__profile">
                    <span className="nav__profile-avatar">{session.user.fullName.charAt(0).toUpperCase()}</span>
                    <span>{session.user.fullName}</span>
                    <small>{session.user.email}</small>
                  </div>
                  <button className="btn btn--glass btn--block mt-2" onClick={() => { clearSession(); setMobile(false); window.location.replace('/') }}>
                    <LogOut size={16} /> Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="btn btn--glass btn--block mt-2"
                    onClick={() => setMobile(false)}
                  >
                    Sign in
                  </Link>
                  <LinkButton to="/signup" block size="lg" arrow className="mt-2" onClick={() => setMobile(false)}>
                    Sign up
                  </LinkButton>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
