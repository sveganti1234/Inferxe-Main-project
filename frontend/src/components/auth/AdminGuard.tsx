import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  getSession,
  getPortalRole,
  clearSession,
  verifyAdminSessionWithDetails,
  isDevelopmentBypassToken,
  isSessionVerifiedRecently,
  isSigningOutRedirect,
} from '../../lib/authStore'

interface AdminGuardProps {
  children?: ReactNode
}

/**
 * Route guard that protects admin routes.
 * Enforces both client-side role validation and server-side DB-backed session verification.
 * Prevents unauthenticated users, revoked sessions, and customer accounts from accessing the Admin Portal.
 * Uses optimistic rendering and cached session verification to prevent blank screens and flickering during navigation.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const location = useLocation()
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'unauthorized'>(() => {
    const session = getSession()
    if (!session || !session.token || isDevelopmentBypassToken(session.token)) return 'unauthorized'
    const portalRole = getPortalRole(session.user?.role)
    if (portalRole !== 'admin' && portalRole !== 'superadmin') return 'unauthorized'
    // If claims are valid, authorize immediately for smooth rendering while background check confirms
    return 'authorized'
  })

  useEffect(() => {
    let isMounted = true

    const validateAdminAccess = async (forceVerify = false) => {
      // Explicit sign-out via performSignOut() already calls window.location.replace('/login') once it finishes.
      // Avoid triggering a simultaneous React Router <Navigate to="/login"> that would mount and reload /login twice.
      if (isSigningOutRedirect()) {
        if (isMounted) setAuthState('checking')
        return
      }

      const session = getSession()

      // 1. Must have an active session
      if (!session || !session.token || isDevelopmentBypassToken(session.token)) {
        if (isMounted) setAuthState('unauthorized')
        return
      }

      // 2. Must hold an admin or superadmin role
      const portalRole = getPortalRole(session.user?.role)
      if (portalRole !== 'admin' && portalRole !== 'superadmin') {
        if (isMounted) setAuthState('unauthorized')
        return
      }

      // If already verified within TTL, skip redundant network round-trip on every route change
      if (!forceVerify && isSessionVerifiedRecently(session.token)) {
        if (isMounted) setAuthState('authorized')
        return
      }

      // 3. Authoritative server-side DB-backed session verification
      const verification = await verifyAdminSessionWithDetails(session.token, forceVerify)
      if (!isMounted) return

      const verifiedRole = getPortalRole(verification.user?.role)
      if (verification.valid && (verifiedRole === 'admin' || verifiedRole === 'superadmin')) {
        setAuthState('authorized')
      } else {
        clearSession()
        setAuthState('unauthorized')
      }
    }

    void validateAdminAccess()
    // Re-evaluate when the session changes elsewhere (sign-out, revocation, another tab), matching CustomerGuard.
    const onAuthChange = () => void validateAdminAccess()
    window.addEventListener('inferxe_auth_change', onAuthChange)
    window.addEventListener('storage', onAuthChange)
    // Back/forward navigation can restore a stale page from the bfcache: re-verify the session then.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void validateAdminAccess(true)
    }
    window.addEventListener('pageshow', onPageShow)

    return () => {
      isMounted = false
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('inferxe_auth_change', onAuthChange)
      window.removeEventListener('storage', onAuthChange)
    }
  }, [location.pathname])

  if (authState === 'checking') {
    return (
      <div className="page-loading" aria-label="Verifying admin credentials">
        <span className="page-loading__spinner" />
      </div>
    )
  }

  if (authState === 'unauthorized') {
    // If user is a logged-in customer, redirect to customer dashboard; otherwise to login.
    const currentSession = getSession()
    if (currentSession && getPortalRole(currentSession.user?.role) === 'customer') {
      return <Navigate to="/dashboard/customer" replace />
    }
    return <Navigate to="/login" replace />
  }

  return <>{children ?? <Outlet />}</>
}
