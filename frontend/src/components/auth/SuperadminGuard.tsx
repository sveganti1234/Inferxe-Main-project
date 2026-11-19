import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  getSession,
  getPortalRole,
  clearSession,
  verifyAdminSessionWithDetails,
} from '../../lib/authStore'

interface SuperadminGuardProps {
  children?: ReactNode
}

/**
 * Route guard that strictly protects Superadmin routes (/dashboard/superadmin/* and /dashboard/super-admin/*).
 * Enforces authoritative server-side DB-backed session & role verification.
 * Strictly prevents standard Admins, Customers, revoked sessions, and unauthenticated users from accessing Superadmin modules.
 * If a regular Admin attempts direct URL access, they are redirected to /dashboard.
 */
export function SuperadminGuard({ children }: SuperadminGuardProps) {
  const location = useLocation()
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'to_admin' | 'to_customer' | 'to_login'>(() => {
    const session = getSession()
    if (!session || !session.token) return 'to_login'
    const portalRole = getPortalRole(session.user?.role)
    if (portalRole === 'admin') return 'to_admin'
    if (portalRole === 'customer') return 'to_customer'
    if (portalRole !== 'superadmin') return 'to_login'
    return 'checking'
  })

  useEffect(() => {
    let isMounted = true

    const validateSuperadminAccess = async () => {
      const session = getSession()

      // 1. Must have an active session
      if (!session || !session.token) {
        if (isMounted) setAuthState('to_login')
        return
      }

      // 2. Fast client-side check before authoritative backend verification
      const portalRole = getPortalRole(session.user?.role)
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

      // 3. Authoritative server-side DB-backed session and role verification
      const verification = await verifyAdminSessionWithDetails(session.token)
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

    return () => {
      isMounted = false
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
