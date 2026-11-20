import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  getSession,
  getPortalRole,
  clearSession,
  verifyAdminSessionWithDetails,
  isDevelopmentBypassToken,
} from '../../lib/authStore'

interface AdminGuardProps {
  children?: ReactNode
}

/**
 * Route guard that protects admin routes.
 * Enforces both client-side role validation and server-side DB-backed session verification.
 * Prevents unauthenticated users, revoked sessions, and customer accounts from accessing the Admin Portal.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const location = useLocation()
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'unauthorized'>(() => {
    const session = getSession()
    if (!session || !session.token || isDevelopmentBypassToken(session.token)) return 'unauthorized'
    const portalRole = getPortalRole(session.user?.role)
    if (portalRole !== 'admin' && portalRole !== 'superadmin') return 'unauthorized'
    return 'checking'
  })

  useEffect(() => {
    let isMounted = true

    const validateAdminAccess = async () => {
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

      // 3. Authoritative server-side DB-backed session verification
      const verification = await verifyAdminSessionWithDetails(session.token)
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

    return () => {
      isMounted = false
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
