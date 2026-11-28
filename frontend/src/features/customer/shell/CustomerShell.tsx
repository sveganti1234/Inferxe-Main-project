import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../../../lib/hooks'
import { useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { signOutCurrentUser } from '../../../lib/authStore'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { selectProfileSummary } from '../data/selectors'
import { sectionForPath } from '../navigation'
import { EmptyState, ErrorState } from '../ui/states'
import { Button, Notice } from '../ui/primitives'
import { CustomerToastViewport } from '../ui/CustomerToast'
import { useResourceRefreshing } from '../data/useAsyncResource'
import { CustomerSidebar } from './CustomerSidebar'
import { CustomerTopbar } from './CustomerTopbar'
import { ConsoleSignalsContext, useConsoleSignals } from './useConsoleSignals'
import { useConsoleTheme } from './useConsoleTheme'

const RAIL_KEY = 'inferxe_cx_sidebar_rail' // UI preference only

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

export async function signOutToLogin(): Promise<void> {
  await signOutCurrentUser()
  window.location.replace('/login')
}

export function CustomerShell() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const { state, workspace, refresh: refreshWorkspace, lastUpdated } = useCustomerWorkspace()
  const outlet = useOutlet()
  const refreshing = useResourceRefreshing()
  const signals = useConsoleSignals()
  const [rail, setRail] = useState(readRail)
  const { theme, toggleTheme } = useConsoleTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleRail = useCallback(() => {
    setRail((value) => {
      const next = !value
      try {
        localStorage.setItem(RAIL_KEY, next ? '1' : '0')
      } catch {
        // storage unavailable: preference is kept for this session only
      }
      return next
    })
  }, [])

  // ── Mobile drawer (≤1023px): modal behaviour and focus management ──
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  /** Where focus goes when the drawer closes: back to the menu button, or to the new page after navigating. */
  const focusAfterCloseRef = useRef<'menu' | 'main'>('menu')
  const wasOpenRef = useRef(false)

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const dismissDrawer = useCallback(() => {
    focusAfterCloseRef.current = 'menu'
    setDrawerOpen(false)
  }, [])

  // Navigating (e.g. tapping a nav link) closes the drawer and lands focus on the new page.
  useEffect(() => {
    focusAfterCloseRef.current = 'main'
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (drawerOpen) {
      wasOpenRef.current = true
      drawerCloseRef.current?.focus()
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') dismissDrawer()
      }
      document.addEventListener('keydown', onKey)
      // Reuse the site's existing rule that hides the floating assistant while a mobile menu is open.
      document.body.classList.add('has-mnav-open')
      return () => {
        document.removeEventListener('keydown', onKey)
        document.body.classList.remove('has-mnav-open')
      }
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      if (focusAfterCloseRef.current === 'main') mainRef.current?.focus()
      else menuButtonRef.current?.focus()
    }
  }, [drawerOpen, dismissDrawer])

  // Leaving mobile layout while the drawer is open: close it.
  useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false)
  }, [isMobile, drawerOpen])

  // Console-only marker: lets the stylesheet retire the floating assistant launcher here (the
  // topbar has its own Assistant button). Removed on unmount so public/admin pages are untouched.
  useEffect(() => {
    document.body.classList.add('cx-console-active')
    return () => document.body.classList.remove('cx-console-active')
  }, [])

  const drawerModal = isMobile && drawerOpen

  const section = sectionForPath(location.pathname)
  const profile = workspace ? selectProfileSummary(workspace) : null
  const sessionError = state.status === 'error' && state.error.kind === 'unauthenticated' ? state.error : null
  const accountBlocked = state.status === 'error' && state.error.kind === 'forbidden' ? state.error : null

  // A failed background refresh must not leave old figures looking current.
  const staleWorkspace = state.status === 'error' && !!workspace && !sessionError && !accountBlocked

  let content
  if (sessionError) {
    content = (
      <div className="cx-fullstate">
        <ErrorState error={sessionError} onSignIn={() => void signOutToLogin()} what="your workspace" />
      </div>
    )
  } else if (accountBlocked) {
    content = (
      <div className="cx-fullstate">
        <EmptyState
          tone="warning"
          icon={<ShieldAlert size={24} />}
          title="Your account is not active"
          body={accountBlocked.message || 'Please contact Inferxe support to restore access.'}
        />
      </div>
    )
  } else {
    content = (
      // popLayout: the leaving page is lifted out of the flow and fades while the next one enters,
      // so there is never an empty frame between routes. `outlet` is captured per page, so the
      // leaving copy keeps showing its own route.
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={location.pathname}
          className="cx-page"
          initial={reduceMotion ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
          exit={reduceMotion ? undefined : { opacity: 0, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {outlet}
        </motion.div>
      </AnimatePresence>
    )
  }

  return (
    <ConsoleSignalsContext.Provider value={signals}>
    {/* reducedMotion="user": every framer animation in the console follows the OS setting. */}
    <MotionConfig reducedMotion="user">
    <div className="cx-app" data-cx-theme={theme}>
      <a className="cx-skip" href="#cx-main">
        Skip to content
      </a>
      <div className={`cx-layout${rail ? ' is-rail' : ''}`}>
        <CustomerSidebar
          organizationName={profile?.organization?.name ?? null}
          account={profile ? { name: profile.displayName, email: profile.email, initials: profile.initials } : null}
          signals={signals}
          rail={rail}
          onToggleRail={toggleRail}
          open={drawerOpen}
          mobile={isMobile}
          onClose={dismissDrawer}
          onNavigate={() => {
            focusAfterCloseRef.current = 'main'
            setDrawerOpen(false)
          }}
          closeButtonRef={drawerCloseRef}
        />
        {drawerOpen ? <div className="cx-scrim" onClick={dismissDrawer} aria-hidden="true" /> : null}
        {/* While the mobile drawer is open, everything else is inert (focus stays in the drawer). */}
        <div className="cx-main" inert={drawerModal || undefined}>
          <CustomerTopbar
            section={section}
            displayName={profile?.displayName ?? null}
            email={profile?.email ?? null}
            initials={profile?.initials ?? '·'}
            unreadCount={signals.unreadCount}
            onOpenNav={openDrawer}
            onSignOut={() => void signOutToLogin()}
            menuButtonRef={menuButtonRef}
            navOpen={drawerOpen}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          <main id="cx-main" ref={mainRef} className="cx-content" tabIndex={-1}>
            <div className={`cx-refresh${refreshing ? ' is-active' : ''}`} aria-hidden="true" />
            <span className="cx-sr-only" role="status" aria-live="polite">{refreshing ? 'Refreshing data…' : ''}</span>
            {staleWorkspace ? (
              <div className="cx-stale">
                <Notice tone="warning" icon={<RefreshCw size={16} />}>
                  We couldn’t refresh your workspace, so the figures below may be out of date
                  {lastUpdated ? ` (last updated ${new Date(lastUpdated).toLocaleTimeString()})` : ''}.{' '}
                  <Button variant="ghost" size="sm" onClick={refreshWorkspace}>Retry</Button>
                </Notice>
              </div>
            ) : null}
            {content}
          </main>
        </div>
      </div>
      <CustomerToastViewport userId={profile?.email ?? workspace?.profile?.user_id ?? null} />
    </div>
    </MotionConfig>
    </ConsoleSignalsContext.Provider>
  )
}
