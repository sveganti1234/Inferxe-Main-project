import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession, getPortalRole } from '../../lib/authStore'

interface CustomerGuardProps {
  children: ReactNode
}

/**
 * Route guard that strictly protects customer workspace routes (/dashboard/customer, /dashboard/gpus, etc.).
 * Strictly prevents unauthenticated users and admin accounts from accessing the Customer Portal.
 * If an admin tries to access customer routes, they are redirected to /dashboard.
 */
export function CustomerGuard({ children }: CustomerGuardProps) {
  const location = useLocation()
  const [authState, setAuthState] = useState<'checking' | 'authorized' | 'to_admin' | 'to_login'>('checking')

  useEffect(() => {
    const session = getSession()

    // 1. Must have an active session
    if (!session || !session.token) {
      setAuthState('to_login')
      return
    }

    const role = getPortalRole(session.user?.role)
    const subpath = location.pathname.replace(/^\/dashboard\/?/, '')
    const isAdminRoute = subpath.startsWith('provider') || subpath === 'users/map'

    // 2. Admin accounts accessing admin/provider routes are authorized; customer-only routes redirect to /dashboard
    if (role === 'admin') {
      if (isAdminRoute) {
        setAuthState('authorized')
        return
      }
      setAuthState('to_admin')
      return
    }

    // 3. Customer accounts must not access admin/provider management routes
    if (isAdminRoute) {
      setAuthState('to_admin')
      return
    }

    // 4. Authorized customer
    setAuthState('authorized')
  }, [location.pathname])

  if (authState === 'checking') {
    return (
      <div className="page-loading" aria-label="Verifying credentials">
        <span className="page-loading__spinner" />
      </div>
    )
  }

  if (authState === 'to_admin') {
    return <Navigate to="/dashboard" replace />
  }

  if (authState === 'to_login') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

