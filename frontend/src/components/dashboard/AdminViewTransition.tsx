import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Route order map for reference and route indexing
 */
export const ADMIN_ROUTE_ORDER: Record<string, number> = {
  '/dashboard/super-admin': 0,
  '/dashboard/superadmin': 0,
  '/dashboard/super-admin/accounts': 1,
  '/dashboard/superadmin/admins': 1,
  '/dashboard/super-admin/roles': 2,
  '/dashboard/super-admin/permissions': 3,
  '/dashboard/super-admin/activity': 4,
  '/dashboard/super-admin/audit': 5,
  '/dashboard/superadmin/audit-logs': 5,
  '/dashboard/superadmin/telemetry': 5.5,
  '/dashboard/superadmin/keys': 5.8,
  '/dashboard': 6,
  '/dashboard/customers': 7,
  '/dashboard/users': 8,
  '/dashboard/users/add': 9,
  '/dashboard/users/map': 10,
  '/dashboard/provider': 11,
  '/dashboard/provider/listings': 12,
  '/dashboard/provider/capacity': 13,
  '/dashboard/provider/workloads': 14,
  '/dashboard/provider/analytics': 15,
  '/dashboard/provider/earnings': 16,
  '/dashboard/provider/integrations': 17,
  '/dashboard/provider/profile': 18,
  '/dashboard/notifications': 19,
  '/dashboard/settings': 20,
  '/dashboard/faq': 21,
}

export function getAdminRouteOrder(pathname: string): number {
  const clean = pathname.replace(/\/+$/, '') || '/dashboard'
  if (clean in ADMIN_ROUTE_ORDER) return ADMIN_ROUTE_ORDER[clean]
  for (const [key, val] of Object.entries(ADMIN_ROUTE_ORDER)) {
    if (clean.startsWith(`${key}/`)) return val
  }
  return 0
}

interface AdminViewTransitionProps {
  k: string
  order?: number
  children: ReactNode
  scrollContainerRef?: React.RefObject<HTMLElement | null>
}

/**
 * AdminViewTransition — Smooth, hardware-accelerated transition container.
 * 
 * Guarantees:
 * - Content is NEVER permanently stuck at opacity: 0.
 * - Hardware accelerated CSS keyframe animation (0.22s ease-out).
 * - Instant scroll reset to top on navigation.
 * - Completely immune to Web Animations API cancel race conditions.
 */
export function AdminViewTransition({
  k,
  children,
  scrollContainerRef,
}: AdminViewTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollContainerRef?.current) {
      scrollContainerRef.current.scrollTop = 0
    } else {
      window.scrollTo({ top: 0, left: 0 })
    }
  }, [k, scrollContainerRef])

  return (
    <div
      key={k}
      ref={containerRef}
      className="dash-view-enter"
      style={{ width: '100%', minHeight: '100%', position: 'relative' }}
    >
      {children}
    </div>
  )
}
