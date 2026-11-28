import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  getSession,
  getPortalRole,
  getAuthenticatedPortalRole,
  clearSession,
  verifyAdminSessionWithDetails,
  isDevelopmentBypassToken,
  isSessionVerifiedRecently,
  isSigningOutRedirect,
} from '../../lib/authStore'

interface SuperadminGuardProps {
  children?: ReactNode
}

/**
 * Route guard that strictly protects Superadmin routes (/dashboard/superadmin/* and /dashboard/super-admin/*).
 * Enforces authoritative server-side DB-backed session & role verification.
 * Strictly prevents standard Admins, Customers, revoked sessions, and unauthenticated users from accessing Superadmin modules.
 * If a regular Admin attempts direct URL access, they are redirected to /dashboard.
 * Uses optimistic rendering and cached session verification to prevent blank screens and flickering during navigation.
 */
export function SuperadminGuard({ children }: SuperadminGuardProps) {
  const location = useLocation()
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'to_admin' | 'to_customer' | 'to_login'>(() => {
    const session = getSession()
    if (!session || !session.token || isDevelopmentBypassToken(session.token)) return 'to_login'
    const portalRole = getAuthenticatedPortalRole(session)
    if (portalRole === 'admin') return 'to_admin'
    if (portalRole === 'customer') return 'to_customer'
    if (portalRole !== 'superadmin') return 'to_login'
    // If claims are valid, authorize immediately for smooth rendering while background check confirms
    return 'authorized'
  })

  useEffect(() => {
    let isMounted = true

    const validateSuperadminAccess = async (forceVerify = false) => {
      // Explicit sign-out via performSignOut() already calls window.location.replace('/login') once it finishes.
      // Avoid triggering a simultaneous React Router <Navigate to="/login"> that would mount and reload /login twice.
      if (isSigningOutRedirect()) {
        if (isMounted) setAuthState('checking')
        return
      }

      const session = getSession()

      // 1. Must have an active session
      if (!session || !session.token || isDevelopmentBypassToken(session.token)) {
        if (isMounted) setAuthState('to_login')
        return
      }

      // 2. Fast client-side check before authoritative backend verification
      const portalRole = getAuthenticatedPortalRole(session)
      if (portalRole === 'admin') {
        if (isMounted) setAuthState('to_admin')
        return
      }

      if (portalRole === 'customer') {
        if (isMounted) setAuthState('to_customer')
        return
      }

      if (portalRole !== 'superadmin') {
        if (isMounted) setAuthState('to_login')
        return
      }

      // If already verified within TTL, skip redundant network round-trip on every route change
      if (!forceVerify && isSessionVerifiedRecently(session.token)) {
        if (isMounted) setAuthState('authorized')
        return
      }

      // 3. Authoritative server-side DB-backed session and role verification
      const verification = await verifyAdminSessionWithDetails(session.token, forceVerify)
      if (!isMounted) return

      if (!verification.valid) {
        clearSession()
        setAuthState('to_login')
        return
      }

      const verifiedRole = getPortalRole(verification.user?.role)
      if (verifiedRole === 'superadmin') {
        setAuthState('authorized')
      } else if (verifiedRole === 'admin') {
        setAuthState('to_admin')
      } else {
        clearSession()
        setAuthState('to_login')
      }
    }

    void validateSuperadminAccess()
    // Re-evaluate when the session changes elsewhere (sign-out, revocation, another tab), matching CustomerGuard.
    const onAuthChange = () => void validateSuperadminAccess()
    window.addEventListener('inferxe_auth_change', onAuthChange)
    window.addEventListener('storage', onAuthChange)
    // Back/forward navigation can restore a stale page from the bfcache: re-verify the session then.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void validateSuperadminAccess(true)
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
      <div className="page-loading" aria-label="Verifying Superadmin privileges">
        <span className="page-loading__spinner" />
      </div>
    )
  }

  if (authState === 'to_admin') {
    return <Navigate to="/dashboard" replace />
  }

  if (authState === 'to_customer') {
    return <Navigate to="/dashboard/customer" replace />
  }

  if (authState === 'to_login') {
    return <Navigate to="/login" replace />
  }

  return <>{children ?? <Outlet />}</>
}
