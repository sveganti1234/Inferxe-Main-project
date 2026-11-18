import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Route order map for calculating transition direction (dir = 1 or -1)
 * Matches the sidebar visual order.
 */
export const ADMIN_ROUTE_ORDER: Record<string, number> = {
  '/dashboard/super-admin': 0,
  '/dashboard/super-admin/accounts': 1,
  '/dashboard/super-admin/roles': 2,
  '/dashboard/super-admin/permissions': 3,
  '/dashboard/super-admin/activity': 4,
  '/dashboard/super-admin/audit': 5,
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
  order: number
  children: ReactNode
  scrollContainerRef: React.RefObject<HTMLElement | null>
}

/**
 * AdminViewTransition — Faithful replication of Customer Dashboard's `Jc` transition component.
 * 
 * Choreography:
 * 1. Outgoing: cards fade/scale down (0.18s, power2.in), headers lift, container shifts -dir * 16px
 * 2. On Swap: resets scrollTop = 0 on the scroll container
 * 3. Incoming: slides from dir * 24px to 0 with expo.out easing (0.45s)
 */
export function AdminViewTransition({
  k,
  order,
  children,
  scrollContainerRef,
}: AdminViewTransitionProps) {
  // Local state holds the displayed node so outgoing content remains mounted during exit
  const [displayState, setDisplayState] = useState<{ k: string; node: ReactNode }>({
    k,
    node: children,
  })

  // Keep a ref of the latest children so we always have the frozen outgoing element
  const frozenChildrenRef = useRef<ReactNode>(children)
  if (displayState.k === k) {
    frozenChildrenRef.current = children
  }

  const activeAnimationsRef = useRef<Animation[]>([])
  const viewRef = useRef<HTMLDivElement>(null)
  const orderRef = useRef(order)
  const dirRef = useRef(1)
  const isTransitioningRef = useRef(false)
  const isInitialMount = useRef(true)

  useLayoutEffect(() => {
    if (displayState.k === k) return

    dirRef.current = order >= orderRef.current ? 1 : -1
    orderRef.current = order

    const container = viewRef.current
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resetScroll = () => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0
      } else {
        window.scrollTo({ top: 0, left: 0 })
      }
    }

    if (!container || prefersReduced) {
      resetScroll()
      setDisplayState({ k, node: children })
      return
    }

    // Cancel any previous active animations before starting new exit
    activeAnimationsRef.current.forEach((a) => {
      try { a.cancel() } catch {}
    })
    activeAnimationsRef.current = []

    isTransitioningRef.current = true

    const dir = dirRef.current
    const exitDuration = 180 // ms (0.18s matches Verdelo qc)
    const viewShift = -dir * 16

    // Animate visible card elements in the outgoing view
    const viewportH = window.innerHeight
    const cardElements = Array.from(
      container.querySelectorAll<HTMLElement>(
        '.dash-card, .dash-stat-card, .dash-panel-card, .card, .kpi, .tile, .lane, .dash-deploy-row, .cust-table-wrap, .cust-stat-grid, .mw-card, .xs-card, .sa-stat-card, .sa-kpi-card, .sa-role-card, .sa-role-card-lg, .sa-activity-card, .sa-section-container, .sa-table-container, .sa-analytics-card, .sa-header-banner, .sa-audit-table-container'
      )
    ).filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < viewportH
    })

    cardElements.forEach((card, idx) => {
      const anim = card.animate(
        [
          { opacity: 1, transform: 'translateY(0px) scale(1)' },
          { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
        ],
        {
          duration: exitDuration,
          easing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', // power2.in
          delay: Math.min(idx * 8, 64),
          fill: 'forwards',
        }
      )
      activeAnimationsRef.current.push(anim)
    })

    // Animate headers and breadcrumbs
    const headerElements = Array.from(
      container.querySelectorAll<HTMLElement>('.dash-header-row, .dash-breadcrumb, .phead, .tabs, .toolbar')
    )
    headerElements.forEach((h) => {
      const anim = h.animate(
        [
          { opacity: 1, transform: 'translateY(0px)' },
          { opacity: 0, transform: 'translateY(-6px)' },
        ],
        {
          duration: exitDuration * 0.8,
          easing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
          fill: 'forwards',
        }
      )
      activeAnimationsRef.current.push(anim)
    })

    // Container shift
    const containerAnim = container.animate(
      [
        { transform: 'translateX(0px)', opacity: 1 },
        { transform: `translateX(${viewShift}px)`, opacity: 0 },
      ],
      {
        duration: exitDuration,
        easing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
        fill: 'forwards',
      }
    )
    activeAnimationsRef.current.push(containerAnim)

    containerAnim.onfinish = () => {
      activeAnimationsRef.current.forEach((a) => {
        try { a.cancel() } catch {}
      })
      activeAnimationsRef.current = []

      isTransitioningRef.current = false
      resetScroll()
      setDisplayState({ k, node: children })
    }
  }, [k, order, children, scrollContainerRef, displayState.k])

  // Entrance slide when displayState.k changes to the new view
  useLayoutEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    const container = viewRef.current
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!container || prefersReduced) return

    const dir = dirRef.current
    const enterDuration = 450 // ms (expo.out)

    const enterAnim = container.animate(
      [
        { transform: `translateX(${dir * 24}px)`, opacity: 0 },
        { transform: 'translateX(0px)', opacity: 1 },
      ],
      {
        duration: enterDuration,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)', // expo.out
        fill: 'both',
      }
    )

    enterAnim.onfinish = () => {
      container.style.transform = ''
      container.style.opacity = ''
    }
  }, [displayState.k])

  return (
    <div
      ref={viewRef}
      className="dash-view-transition"
      style={{ width: '100%', minHeight: '100%', position: 'relative' }}
    >
      {displayState.k === k ? children : frozenChildrenRef.current}
    </div>
  )
}
