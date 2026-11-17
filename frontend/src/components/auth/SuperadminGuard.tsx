import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getSession, getPortalRole, clearSession, verifyAdminSessionServer } from '../../lib/authStore'

interface SuperadminGuardProps {
  children?: ReactNode
}

/**
 * Route guard that strictly protects Superadmin routes (/dashboard/superadmin/*).
 * Enforces both client-side role validation and server-side cryptographic token verification.
 * Strictly prevents standard Admins, Customers, and unauthenticated users from accessing the Superadmin Portal.
 * If a regular Admin attempts access, they are redirected to /dashboard.
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
    return 'authorized'
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

      // 2. Must hold the 'superadmin' role
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

      // 3. Cryptographic server-side verification
      const isServerValid = await verifyAdminSessionServer(session.token)
      if (!isMounted) return

      if (isServerValid) {
        setAuthState('authorized')
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
