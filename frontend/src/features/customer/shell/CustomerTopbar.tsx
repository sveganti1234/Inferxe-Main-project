import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, Bell, BookOpen, ChevronRight, Cpu, FlaskConical, KeyRound, LogOut, Menu, Moon, Plus, Search, Settings2, Sun } from 'lucide-react'
import { getSection, sectionHref, type ConsoleSection, type SectionId } from '../navigation'
import type { ConsoleTheme } from './useConsoleTheme'

/** Dropdown motion: grows from the trigger's corner; quicker on close. */
const MENU_MOTION = {
  initial: { opacity: 0, scale: 0.96, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
} as const

/** Real destinations only: each item opens an existing console page. */
const QUICK_ACTIONS: Array<{ id: SectionId; label: string; hint: string; icon: typeof KeyRound }> = [
  { id: 'api-keys', label: 'Create an API key', hint: 'Authenticate inference requests', icon: KeyRound },
  { id: 'playground', label: 'Open the playground', hint: 'Send a prompt when the service is online', icon: FlaskConical },
  { id: 'gpus', label: 'Browse GPU capacity', hint: 'What providers have listed', icon: Cpu },
  { id: 'usage', label: 'View usage report', hint: 'Requests, tokens and latency', icon: BarChart3 },
]

/** Close a popover on outside pointer-down or Escape (returns focus handling to the caller). */
function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, ref])
}

export function CustomerTopbar({
  section,
  displayName,
  email,
  initials,
  unreadCount,
  onOpenNav,
  onSignOut,
  menuButtonRef,
  navOpen,
  theme,
  onToggleTheme,
}: {
  section: ConsoleSection | null
  displayName: string | null
  email: string | null
  initials: string
  unreadCount: number | null
  onOpenNav: () => void
  onSignOut: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
  navOpen: boolean
  theme: ConsoleTheme
  onToggleTheme: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const quickRef = useRef<HTMLDivElement>(null)
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef)
  useDismiss(quickOpen, () => setQuickOpen(false), quickRef)

  const openPalette = () => window.dispatchEvent(new Event('inferxe:palette'))
  const notifications = getSection('notifications')
  const settings = getSection('settings')
  const unreadLabel =
    unreadCount === null ? 'Notifications' : unreadCount === 0 ? 'Notifications, none unread' : `Notifications, ${unreadCount} unread`
  const themeLabel = theme === 'forest' ? 'Switch to the light theme' : 'Switch to the dark theme'

  return (
    <header className="cx-topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="cx-iconbtn cx-topbar__menu"
        onClick={onOpenNav}
        aria-label="Open navigation"
        aria-controls="cx-sidebar"
        aria-expanded={navOpen}
      >
        <Menu size={18} />
      </button>

      <nav className="cx-crumbs" aria-label="Breadcrumb">
        {/* First crumb: the sidebar group of the current page (General, Compute & AI, …). */}
        <span>{section?.group ?? 'Console'}</span>
        <ChevronRight size={14} aria-hidden="true" />
        <strong aria-current="page">{section?.label ?? 'Not found'}</strong>
      </nav>

      <div className="cx-topbar__spacer" />

      <button type="button" className="cx-search" onClick={openPalette} aria-label="Search Inferxe">
        <Search size={16} aria-hidden="true" />
        <span className="cx-search__text">Search models, GPUs, pages…</span>
        <kbd className="cx-kbd">Ctrl K</kbd>
      </button>

      <div className="cx-quick" ref={quickRef}>
        <button
          type="button"
          className="cx-quickbtn"
          onClick={() => setQuickOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={quickOpen}
          aria-label="Quick actions"
          title="Quick actions"
        >
          <Plus size={18} strokeWidth={2.4} />
        </button>
        <AnimatePresence>
        {quickOpen ? (
          <motion.div key="quick" className="cx-menu cx-menu--quick" role="menu" aria-label="Quick actions" style={{ transformOrigin: 'top right' }} {...MENU_MOTION}>
            {QUICK_ACTIONS.map(({ id, label, hint, icon: Icon }) => (
              <Link key={id} to={sectionHref(getSection(id))} className="cx-menu__item cx-menu__item--rich" role="menuitem" onClick={() => setQuickOpen(false)}>
                <span className="cx-menu__icon" aria-hidden="true"><Icon size={16} /></span>
                <span className="cx-menu__label">
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </Link>
            ))}
          </motion.div>
        ) : null}
        </AnimatePresence>
      </div>


      <span className="cx-topbar__divider" aria-hidden="true" />

      <button type="button" className="cx-iconbtn cx-topbar__theme" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
        {theme === 'forest' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <Link to={sectionHref(notifications)} className="cx-iconbtn" aria-label={unreadLabel} title={unreadLabel}>
        <Bell size={18} />
        {unreadCount !== null && unreadCount > 0 ? (
          <span className="cx-iconbtn__count" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </Link>

      <div className="cx-account" ref={menuRef}>
        <button
          type="button"
          className="cx-account__trigger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
        >
          <span className="cx-avatar" aria-hidden="true">{initials}</span>
          <span className="cx-account__name">{displayName ?? 'Account'}</span>
        </button>
        <AnimatePresence>
        {menuOpen ? (
          <motion.div key="account" className="cx-menu" role="menu" style={{ transformOrigin: 'top right' }} {...MENU_MOTION}>
            <div className="cx-menu__head">
              <span className="cx-avatar" aria-hidden="true">{initials}</span>
              <div className="cx-menu__who">
                <strong>{displayName ?? 'Account'}</strong>
                {email ? <span>{email}</span> : null}
              </div>
            </div>
            <Link to={sectionHref(settings)} className="cx-menu__item" role="menuitem" onClick={() => setMenuOpen(false)}>
              <Settings2 size={16} /> Settings
            </Link>
            <Link to="/developers" className="cx-menu__item" role="menuitem" onClick={() => setMenuOpen(false)}>
              <BookOpen size={16} /> Developer docs
            </Link>
            <button type="button" className="cx-menu__item" role="menuitem" onClick={() => { onToggleTheme(); setMenuOpen(false) }}>
              {theme === 'forest' ? <Sun size={16} /> : <Moon size={16} />} {theme === 'forest' ? 'Light theme' : 'Dark theme'}
            </button>
            <button type="button" className="cx-menu__item cx-menu__item--danger" role="menuitem" onClick={onSignOut}>
              <LogOut size={16} /> Sign out
            </button>
          </motion.div>
        ) : null}
        </AnimatePresence>
      </div>
    </header>
  )
}
