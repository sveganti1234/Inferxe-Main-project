import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import * as authStore from '../../lib/authStore'

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
    let active = true

    const evaluate = async () => {
      // Explicit sign-out via performSignOut() already calls window.location.replace('/login') once it finishes.
      // Avoid triggering a simultaneous React Router <Navigate to="/login"> that would mount and reload /login twice.
      if (authStore.isSigningOutRedirect?.()) {
        if (active) setAuthState('checking')
        return
      }

      // 1. Must have a session with a currently valid token. Customer sessions are refreshed
      //    through Amplify when expired; a failed refresh clears the session.
      const session = await authStore.ensureFreshSession()
      if (!active) return
      if (authStore.isSigningOutRedirect?.()) {
        setAuthState('checking')
        return
      }

      if (!session || !session.token) {
        setAuthState('to_login')
        return
      }

      const role = authStore.getPortalRole(session.user?.role)
      const subpath = location.pathname.replace(/^\/dashboard\/?/, '')
      const isAdminRoute = subpath.startsWith('provider') || subpath === 'users/map'

      // 2. Admin and superadmin accounts accessing admin/provider routes are authorized (AdminGuard
      //    verifies them with the server); customer-only routes redirect to /dashboard
      if (role === 'admin' || role === 'superadmin') {
        setAuthState(isAdminRoute ? 'authorized' : 'to_admin')
        return
      }

      // 3. Customer accounts must not access admin/provider management routes
      if (isAdminRoute) {
        setAuthState('to_admin')
        return
      }

      // 4. Authorized customer
      setAuthState('authorized')
    }

    void evaluate()
    // Re-evaluate when the session changes elsewhere (sign-out, refresh failure, another tab).
    const onAuthChange = () => void evaluate()
    window.addEventListener('inferxe_auth_change', onAuthChange)
    window.addEventListener('storage', onAuthChange)
    // Back/forward navigation can restore a stale page from the bfcache: re-verify the session then.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void evaluate()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      active = false
      window.removeEventListener('inferxe_auth_change', onAuthChange)
      window.removeEventListener('storage', onAuthChange)
    }
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

