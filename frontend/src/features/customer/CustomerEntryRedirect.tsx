import { Navigate, useLocation } from 'react-router-dom'
import { resolveLegacyCustomerTarget } from './routing'

/**
 * Replaces the old /dashboard/customer entry: signed-in customers land in the native console
 * (or, for Verdelo-only tabs, on the explicit /dashboard/legacy route). Always rendered inside
 * <CustomerGuard>, so only signed-in customers ever reach it.
 */
export default function CustomerEntryRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={resolveLegacyCustomerTarget(pathname, search)} replace />
}
