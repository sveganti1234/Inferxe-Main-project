import { Navigate, useLocation } from 'react-router-dom'
import { resolveLegacyWorkspaceTarget } from './routing'

/**
 * Customer-only catch-all for the old /dashboard/<page> workspace (demo data, "Sahith" identity).
 * Customers are sent to the native console equivalent; admin routes are declared before this
 * catch-all and are unaffected. Always rendered inside <CustomerGuard>.
 */
export default function LegacyWorkspaceRedirect() {
  const { pathname } = useLocation()
  return <Navigate to={resolveLegacyWorkspaceTarget(pathname)} replace />
}
