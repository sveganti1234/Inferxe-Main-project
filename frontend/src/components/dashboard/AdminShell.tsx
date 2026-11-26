import { Suspense, useEffect, useState, useRef, useLayoutEffect } from 'react'
import { Link, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity as ActivityIcon,
  BarChart3,
  Bell,
  Moon,
  Sun,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Cpu,
  ExternalLink,
  Globe,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Settings,
  User,
  Users,
  Wallet,
  Wrench,
  X,
  ShieldCheck,
  UserCheck,
  KeyRound,
  Sliders,
  FileText,
} from 'lucide-react'
import { Ambient } from '../layout/Ambient'
import { LogoMark } from '../Logo'
import { getSession, performSignOut, getPortalRole, type AuthSession, type PortalRole } from '../../lib/authStore'
import { getAdminAccounts, syncAdminAccountsFromBackend } from '../../lib/adminAccountStore'
import { getAllRoles } from '../../lib/adminRoleStore'
import { animateNavPill } from './navPillAnimation'
import { AdminViewTransition, getAdminRouteOrder } from './AdminViewTransition'
import { AdminContentSkeleton } from './AdminContentSkeleton'
// Admin-only styles (all selectors scoped to .sa-* / .dash-shell): loaded with the admin chunk, not on public pages.
import '../../styles/super-admin.css'
import { AdminErrorBoundary } from './AdminErrorBoundary'
import { DashboardLayoutContext } from './DashboardLayoutContext'
import { AdminHeaderSearch, type AdminSearchSectionItem } from './AdminHeaderSearch'
import { useAdminSidebarKeyboardNav } from './useAdminSidebarKeyboardNav'

export function preloadRoute(_path: string) {}

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }>
  badge?: string
  badgeType?: 'pill' | 'count'
}

interface AdminNavGroup {
  title: string
  icon?: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }>
  items: NavItem[]
}

export function AdminShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentOutlet = useOutlet()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const notifRef = useRef<HTMLDivElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const topbarProfileRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const mainPaneRef = useRef<HTMLElement>(null)

  // Unified Floating Nav Pill & Container Refs
  const sidebarNavWrapRef = useRef<HTMLDivElement>(null)
  const unifiedNavPillRef = useRef<HTMLSpanElement>(null)

  // Initial render flag to skip animation on first load
  const isFirstNavPillMount = useRef(true)

  // Sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('inferxe_dash_sidebar_collapsed')
      if (saved !== null) return saved === 'true'
    } catch {
      /* ignore */
    }
    return false
  })

  // Dev preview mode for Super Admin vs Normal Admin view
  const [devSuperAdminMode, setDevSuperAdminMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('inferxe_dev_super_admin_mode')
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  useEffect(() => {
    const handleRoleToggle = () => {
      try {
        const saved = localStorage.getItem('inferxe_dev_super_admin_mode')
        setDevSuperAdminMode(saved === null ? true : saved === 'true')
      } catch {}
    }
    window.addEventListener('inferxe_admin_role_toggle', handleRoleToggle)
    window.addEventListener('storage', handleRoleToggle)
    return () => {
      window.removeEventListener('inferxe_admin_role_toggle', handleRoleToggle)
      window.removeEventListener('storage', handleRoleToggle)
    }
  }, [])

  // Live Admin Accounts Count (synced dynamically with Supabase via adminAccountStore)
  const [adminAccountsCount, setAdminAccountsCount] = useState<number>(() => {
    try {
      return getAdminAccounts().length
    } catch {
      return 0
    }
  })

  useEffect(() => {
    const syncAdminCount = () => {
      try {
        setAdminAccountsCount(getAdminAccounts().length)
      } catch {}
    }
    const currentPortalRole = getPortalRole(getSession()?.user?.role)
    if (currentPortalRole === 'superadmin') {
      void syncAdminAccountsFromBackend().then((res) => {
        if (res.ok) setAdminAccountsCount(res.accounts.length)
      })
    }
    window.addEventListener('inferxe_admin_accounts_change', syncAdminCount)
    window.addEventListener('storage', syncAdminCount)
    return () => {
      window.removeEventListener('inferxe_admin_accounts_change', syncAdminCount)
      window.removeEventListener('storage', syncAdminCount)
    }
  }, [])

  // Live Admin Roles Count (synced dynamically with adminRoleStore)
  const [adminRolesCount, setAdminRolesCount] = useState<number>(() => {
    try {
      return getAllRoles().length
    } catch {
      return 6
    }
  })

  useEffect(() => {
    const syncRoleCount = () => {
      try {
        setAdminRolesCount(getAllRoles().length)
      } catch {}
    }
    window.addEventListener('inferxe_admin_roles_change', syncRoleCount)
    window.addEventListener('storage', syncRoleCount)
    return () => {
      window.removeEventListener('inferxe_admin_roles_change', syncRoleCount)
      window.removeEventListener('storage', syncRoleCount)
    }
  }, [])

  // Floating flyout tooltip in collapsed rail mode
  const [hoveredFlyout, setHoveredFlyout] = useState<{
    label: string
    badge?: string
    top: number
    left: number
  } | null>(null)

  // Live Notifications State
  const [liveNotifs, setLiveNotifs] = useState<Array<{ id: string; title: string; detail: string; type: string; time: string; read: boolean }>>(() => {
    try {
      const raw = localStorage.getItem('inferxe_demo_notifications_v3')
      if (raw) return JSON.parse(raw)
    } catch {}
    return [
      { id: 'n1', title: 'Deployment qwen-chat-staging is healthy', detail: 'Serving tokens at 118 tok/s with 0.42s P95 TTFT.', type: 'Deployment', time: '12 mins ago', read: false },
      { id: 'n2', title: 'Monthly spending alert threshold reached', detail: 'Estimated spend has reached 48% of your monthly cap.', type: 'Billing', time: '2 hours ago', read: false },
      { id: 'n3', title: 'Yotta NM1 sovereign cluster capacity added', detail: 'New NVIDIA H100 nodes provisioned in Mumbai region.', type: 'Marketplace', time: 'Yesterday', read: true },
    ]
  })

  useEffect(() => {
    const syncNotifs = () => {
      try {
        const raw = localStorage.getItem('inferxe_demo_notifications_v3')
        if (raw) setLiveNotifs(JSON.parse(raw))
      } catch {}
    }
    syncNotifs()
    window.addEventListener('inferxe_notifications_change', syncNotifs)
    window.addEventListener('storage', syncNotifs)
    return () => {
      window.removeEventListener('inferxe_notifications_change', syncNotifs)
      window.removeEventListener('storage', syncNotifs)
    }
  }, [location.pathname])

  const unreadNotifCount = liveNotifs.filter((n) => !n.read).length

  // Mobile responsiveness (matches @media (max-width: 900px))
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 900
    return false
  })

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 900
      setIsMobile(mobile)
      if (!mobile && mobileMenuOpen) setMobileMenuOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [mobileMenuOpen])

  // Toggle main sidebar collapse
  const toggleSidebarCollapse = () => {
    if (isMobile) {
      setMobileMenuOpen((prev) => !prev)
    } else {
      setIsSidebarCollapsed((prev) => {
        const next = !prev
        try {
          localStorage.setItem('inferxe_dash_sidebar_collapsed', String(next))
        } catch {
          /* ignore */
        }
        return next
      })
    }
  }

  // Ctrl+B / Cmd+B hotkey to toggle sidebar
  useEffect(() => {
    const handleSidebarHotkey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
        e.preventDefault()
        toggleSidebarCollapse()
      }
    }
    window.addEventListener('keydown', handleSidebarHotkey)
    return () => window.removeEventListener('keydown', handleSidebarHotkey)
  }, [isMobile, mobileMenuOpen])

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false)
      const inProfileMenu = profileMenuRef.current?.contains(target)
      const inTopbarProfile = topbarProfileRef.current?.contains(target)
      if (!inProfileMenu && !inTopbarProfile) {
        setAdminMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false)
        setAdminMenuOpen(false)
      }
    }
    if (notifOpen || adminMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [notifOpen, adminMenuOpen])

  // Light / dark theme
  const [dashTheme, setDashTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('inferxe_dash_theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dashTheme)
    document.documentElement.classList.toggle('light', dashTheme === 'light')
    document.documentElement.classList.toggle('dark', dashTheme === 'dark')
  }, [dashTheme])

  const toggleTheme = (e?: React.MouseEvent) => {
    const next = dashTheme === 'light' ? 'dark' : 'light'
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    if (e && (typeof e.clientX === 'number' || typeof e.pageX === 'number')) {
      x = e.clientX ?? e.pageX ?? x
      y = e.clientY ?? e.pageY ?? y
    }
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    const applyThemeChange = () => {
      setDashTheme(next)
      document.documentElement.setAttribute('data-theme', next)
      document.documentElement.classList.toggle('light', next === 'light')
      document.documentElement.classList.toggle('dark', next === 'dark')
      try {
        localStorage.setItem('inferxe_dash_theme', next)
      } catch {}
    }

    const doc = document as any
    if (typeof doc.startViewTransition === 'function') {
      try {
        const transition = doc.startViewTransition(() => {
          applyThemeChange()
        })
        if (transition && transition.ready) {
          transition.ready.then(() => {
            document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 500,
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                pseudoElement: '::view-transition-new(root)',
              }
            )
          }).catch(() => {})
        }
        return
      } catch {}
    }

    const ripple = document.createElement('div')
    ripple.className = 'dash-theme-ripple-wave'
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    ripple.style.width = `${endRadius * 2.2}px`
    ripple.style.height = `${endRadius * 2.2}px`
    ripple.style.background = next === 'dark' ? '#07090E' : '#f4f6f1'
    document.body.appendChild(ripple)

    const anim = ripple.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0)', opacity: 0.95 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      ],
      {
        duration: 500,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      }
    )
    applyThemeChange()
    anim.onfinish = () => {
      ripple.remove()
    }
  }

  // Auth session
  const [currentSession, setCurrentSession] = useState<AuthSession | null>(() => getSession())

  useEffect(() => {
    const handleAuth = () => setCurrentSession(getSession())
    window.addEventListener('storage', handleAuth)
    window.addEventListener('inferxe_auth_change', handleAuth)
    return () => {
      window.removeEventListener('storage', handleAuth)
      window.removeEventListener('inferxe_auth_change', handleAuth)
    }
  }, [])

  const defaultAdminUser = {
    id: 'usr_admin',
    fullName: 'Sahith',
    email: 'admin@inferxe.com',
    username: 'admin',
    role: 'admin',
    organization: 'Inferxe Global Control',
  }

  const user = currentSession?.user ?? defaultAdminUser
  const portalRole: PortalRole = getPortalRole(user.role)

  const initials = (user.fullName || 'Admin')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'IX'

  // Access control gating for Super Admin Governance modules
  const isSuperAdmin = Boolean(
    portalRole === 'superadmin' ||
    user.role === 'super_admin' ||
    (import.meta.env.DEV && (devSuperAdminMode || location.pathname.startsWith('/dashboard/super-admin') || location.pathname.startsWith('/dashboard/superadmin')))
  )

  const roleLabel = isSuperAdmin ? 'Super Admin' : 'Admin'

  // 0. Super Admin Governance Items
  const adminSuperAdminItems: NavItem[] = [
    { label: 'Super Admin Overview', to: '/dashboard/super-admin', icon: ShieldCheck },
    { label: 'Admin Accounts', to: '/dashboard/super-admin/accounts', icon: UserCheck, badge: String(adminAccountsCount), badgeType: 'count' },
    { label: 'Role Management', to: '/dashboard/super-admin/roles', icon: KeyRound, badge: String(adminRolesCount), badgeType: 'count' },
    { label: 'Permission Management', to: '/dashboard/super-admin/permissions', icon: Sliders, badge: '21', badgeType: 'count' },
    { label: 'Activity Monitoring', to: '/dashboard/super-admin/activity', icon: ActivityIcon },
    { label: 'Audit Logs', to: '/dashboard/super-admin/audit', icon: FileText },
    { label: 'Infrastructure Telemetry', to: '/dashboard/superadmin/telemetry', icon: Cpu },
    { label: 'Key Governance', to: '/dashboard/superadmin/keys', icon: KeyRound },
  ]

  // 1. Administration Console Items
  const adminAdministrationItems: NavItem[] = [
    { label: 'Admin Console', to: '/dashboard', icon: LayoutDashboard },
    { label: 'Customer Management', to: '/dashboard/customers', icon: Users },
    { label: 'Users Directory', to: '/dashboard/users', icon: Users },
    { label: 'Sovereign Nodes Map', to: '/dashboard/users/map', icon: Globe },
    { label: 'Key Monitoring', to: '/dashboard/keys', icon: KeyRound },
  ]

  // 2. Provider Management Items
  const adminProviderManagementItems: NavItem[] = [
    { label: 'Provider Overview', to: '/dashboard/provider', icon: Server },
    { label: 'GPU Listings', to: '/dashboard/provider/listings', icon: Cpu },
    { label: 'Capacity & Health', to: '/dashboard/provider/capacity', icon: ActivityIcon },
    { label: 'Workloads', to: '/dashboard/provider/workloads', icon: Wrench },
    { label: 'Provider Analytics', to: '/dashboard/provider/analytics', icon: BarChart3 },
    { label: 'Earnings & Payouts', to: '/dashboard/provider/earnings', icon: Wallet },
    { label: 'Integrations', to: '/dashboard/provider/integrations', icon: Settings },
    { label: 'Provider Profile', to: '/dashboard/provider/profile', icon: User },
  ]

  // Grouped Navigation Array
  const adminNavGroups: AdminNavGroup[] = [
    ...(isSuperAdmin
      ? [
          {
            title: 'SUPER ADMIN',
            items: adminSuperAdminItems,
          },
        ]
      : []),
    {
      title: 'ADMINISTRATION',
      items: adminAdministrationItems,
    },
    {
      title: 'PROVIDER MANAGEMENT',
      items: adminProviderManagementItems,
    },
    {
      title: 'SYSTEM_DIVIDER',
      items: [
        { label: 'Settings', to: '/dashboard/settings', icon: Settings },
        { label: 'Help & Docs', to: '/dashboard/faq', icon: HelpCircle },
      ],
    },
  ]

  const searchableSections: AdminSearchSectionItem[] = [
    ...adminAdministrationItems.map((item) => ({ label: item.label, to: item.to, group: 'Administration' })),
    ...adminProviderManagementItems.map((item) => ({ label: item.label, to: item.to, group: 'Provider Management' })),
    ...(isSuperAdmin
      ? adminSuperAdminItems.map((item) => ({ label: item.label, to: item.to, group: 'Super Admin' }))
      : []),
  ]

  const isItemActive = (item: NavItem) => {
    const path = location.pathname.replace(/\/+$/, '') || '/dashboard'
    if (item.to === '/dashboard/users') {
      return path === '/dashboard/users' || path === '/dashboard/users/add'
    }
    if (item.to === '/dashboard/provider') {
      return path === '/dashboard/provider' || path === '/dashboard/provider/onboarding'
    }
    if (item.to === '/dashboard') {
      return path === '/dashboard'
    }
    if (item.to === '/dashboard/super-admin') {
      return path === '/dashboard/super-admin' || path === '/dashboard/superadmin'
    }
    if (item.to === '/dashboard/super-admin/accounts') {
      return path === '/dashboard/super-admin/accounts' || path === '/dashboard/superadmin/admins'
    }
    if (item.to === '/dashboard/super-admin/audit') {
      return path === '/dashboard/super-admin/audit' || path === '/dashboard/superadmin/audit-logs'
    }
    if (item.to === '/dashboard/superadmin/telemetry') {
      return path === '/dashboard/superadmin/telemetry'
    }
    if (item.to === '/dashboard/superadmin/keys') {
      return path === '/dashboard/superadmin/keys'
    }
    if (item.to === '/dashboard/keys') {
      return path === '/dashboard/keys'
    }
    return path === item.to || path.startsWith(`${item.to}/`)
  }

  // Active group auto-expansion
  const activeAdminGroupTitle =
    adminNavGroups.find((grp) => grp.items.some((item) => isItemActive(item)))?.title ?? 'ADMINISTRATION'

  // Topbar breadcrumb (customer-console style): sidebar group › active page
  const activeNavGroup = adminNavGroups.find((grp) => grp.items.some((item) => isItemActive(item)))
  const crumbGroup = !activeNavGroup || activeNavGroup.title === 'SYSTEM_DIVIDER'
    ? 'Console'
    : activeNavGroup.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  const crumbPage = activeNavGroup?.items.find((item) => isItemActive(item))?.label ?? 'Overview'

  const [expandedAdminGroups, setExpandedAdminGroups] = useState<Record<string, boolean>>(() => ({
    'SUPER ADMIN': true,
    ADMINISTRATION: true,
    'PROVIDER MANAGEMENT': true,
  }))

  useEffect(() => {
    if (activeAdminGroupTitle && activeAdminGroupTitle !== 'SYSTEM_DIVIDER') {
      setExpandedAdminGroups((prev) =>
        prev[activeAdminGroupTitle] ? prev : { ...prev, [activeAdminGroupTitle]: true }
      )
    }
  }, [activeAdminGroupTitle])

  const toggleAdminGroup = (title: string) => {
    setExpandedAdminGroups((prev) => ({
      ...prev,
      [title]: !prev[title],
    }))
  }

  // Keyboard navigation hook for the sidebar
  const { sidebarPointerHandlers } = useAdminSidebarKeyboardNav({
    enabled: true,
    sidebarRef,
    sidebarNavWrapRef,
    isMobile,
    mobileMenuOpen,
    isRailMode: isSidebarCollapsed,
    hasOpenPopover: notifOpen || adminMenuOpen,
    hasOpenFlyout: Boolean(hoveredFlyout),
    currentPathname: location.pathname,
    visibleSections: {
      admin: Boolean(expandedAdminGroups['ADMINISTRATION']),
      provider: Boolean(expandedAdminGroups['PROVIDER MANAGEMENT']),
      'super-admin': Boolean(expandedAdminGroups['SUPER ADMIN']),
    },
    onNavigate: (to) => navigate(to),
    onOpenSection: (sec) => {
      const title = sec === 'super-admin' ? 'SUPER ADMIN' : sec === 'provider' ? 'PROVIDER MANAGEMENT' : 'ADMINISTRATION'
      setExpandedAdminGroups((prev) => ({ ...prev, [title]: true }))
    },
    onCloseSection: (sec) => {
      const title = sec === 'super-admin' ? 'SUPER ADMIN' : sec === 'provider' ? 'PROVIDER MANAGEMENT' : 'ADMINISTRATION'
      setExpandedAdminGroups((prev) => ({ ...prev, [title]: false }))
    },
    onCloseFlyout: () => setHoveredFlyout(null),
    onCloseMobileMenu: () => setMobileMenuOpen(false),
  })

  // 🌟 Active Nav Pill Liquid Animation Driver — Single unified pill across all sidebar items
  useLayoutEffect(() => {
    const animate = !isFirstNavPillMount.current
    const radius = isSidebarCollapsed ? 14 : 9999

    const activeItemEl = sidebarNavWrapRef.current?.querySelector<HTMLElement>('.dash-nav-item.is-active')
    animateNavPill(unifiedNavPillRef.current, activeItemEl, { animate, radius })

    isFirstNavPillMount.current = false
  }, [location.pathname, isSidebarCollapsed, expandedAdminGroups, isSuperAdmin])

  // Synchronize nav pill on resize, section toggle, or font load
  useEffect(() => {
    const syncPillPositions = () => {
      const radius = isSidebarCollapsed ? 14 : 9999
      const activeItemEl = sidebarNavWrapRef.current?.querySelector<HTMLElement>('.dash-nav-item.is-active')
      animateNavPill(unifiedNavPillRef.current, activeItemEl, { animate: false, radius })
    }

    const ro = new ResizeObserver(syncPillPositions)
    if (sidebarNavWrapRef.current) ro.observe(sidebarNavWrapRef.current)
    document.fonts?.ready.then(syncPillPositions)

    return () => ro.disconnect()
  }, [isSidebarCollapsed, expandedAdminGroups, isSuperAdmin])

  // Render an accordion group
  const renderAdminGroup = (group: AdminNavGroup) => {
    if (group.title === 'SYSTEM_DIVIDER') {
      return (
        <div key="admin-system-divider" className="dash-nav-group" style={{ margin: 0, padding: 0 }}>
          <div className="verdelo-nav-divider" />
          <nav className="dash-nav-list" aria-label="System Settings & Help">
            {group.items.map((item) => {
              const active = isItemActive(item)
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`dash-nav-item ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setHoveredFlyout(null)
                    setMobileMenuOpen(false)
                  }}
                  onMouseEnter={(e) => {
                    if (isSidebarCollapsed && !isMobile) {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setHoveredFlyout({
                        label: item.label,
                        badge: item.badge,
                        top: rect.top + rect.height / 2,
                        left: rect.right + 12,
                      })
                    }
                  }}
                  onMouseLeave={() => setHoveredFlyout(null)}
                >
                  <item.icon size={18} strokeWidth={1.8} className="dash-nav-item-icon" />
                  {!isSidebarCollapsed && <span>{item.label}</span>}
                </Link>
              )
            })}
          </nav>
        </div>
      )
    }

    const isExpanded = Boolean(expandedAdminGroups[group.title])
    const showItems = (isSidebarCollapsed && !isMobile) || isExpanded
    const isCategoryActive = group.items.some((item) => isItemActive(item))

    return (
      <div key={group.title} className="dash-nav-group">
        {!isSidebarCollapsed && (
          <button
            type="button"
            className={`dash-nav-group-title dash-nav-group-btn ${isExpanded ? 'is-expanded' : ''} ${
              isCategoryActive ? 'is-active-category' : ''
            }`}
            onClick={() => toggleAdminGroup(group.title)}
            aria-expanded={isExpanded}
            title={isExpanded ? `Collapse ${group.title}` : `Expand ${group.title}`}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {group.icon && <group.icon size={13} strokeWidth={1.8} style={{ color: dashTheme === 'light' ? '#123D2D' : '#50e396' }} />}
              <span>{group.title}</span>
            </span>
            <ChevronDown
              size={13}
              className={`dash-nav-group-chevron ${isExpanded ? 'is-expanded' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}

        <AnimatePresence initial={false}>
          {showItems && (
            <motion.nav
              className="dash-nav-list"
              aria-label={group.title}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
              style={{ overflow: 'hidden' }}
            >
              {group.items.map((item) => {
                const active = isItemActive(item)
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    className={`dash-nav-item ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      setHoveredFlyout(null)
                      setMobileMenuOpen(false)
                    }}
                    onMouseEnter={(e) => {
                      preloadRoute(item.to)
                      if (isSidebarCollapsed && !isMobile) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setHoveredFlyout({
                          label: item.label,
                          badge: item.badge,
                          top: rect.top + rect.height / 2,
                          left: rect.right + 12,
                        })
                      }
                    }}
                    onMouseLeave={() => setHoveredFlyout(null)}
                  >
                    <item.icon size={18} strokeWidth={1.8} className="dash-nav-item-icon" />
                    {!isSidebarCollapsed && <span>{item.label}</span>}
                    {!isSidebarCollapsed && item.badge && (
                      <span className={`dash-nav-badge ${item.badgeType === 'count' ? 'dash-nav-badge--count' : ''}`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <DashboardLayoutContext.Provider value={true}>
      <div className="dash-shell" data-theme={dashTheme} data-role="admin">
        <Ambient />
        <div className="dash-window-frame dash-window-frame--customer dash-window-frame--admin">
          {/* Mobile backdrop overlay */}
          {mobileMenuOpen && (
            <div
              className="dash-sidebar-overlay"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* ── Left Sidebar (Full height from top to bottom) ────────────────── */}
          <aside
            ref={sidebarRef}
            className={`dash-sidebar dash-sidebar--verdelo dash-sidebar--admin ${
              isMobile
                ? (mobileMenuOpen ? 'is-open' : '')
                : (isSidebarCollapsed ? 'is-collapsed' : '')
            }`}
            aria-label="Admin Dashboard Sidebar"
            {...sidebarPointerHandlers}
          >
            {/* Brand row matching the customer sidebar: logo + Infer<xe> + collapse toggle */}
            <div className="verdelo-sidebar-brand-row">
              <Link to="/dashboard" className="verdelo-sidebar-brand-link" title="Inferxe Admin">
                <LogoMark size={30} theme={dashTheme} />
                {!isSidebarCollapsed && (
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.22rem', letterSpacing: '-0.01em', color: 'var(--ink)' }}>
                    Infer<span style={{ color: dashTheme === 'light' ? '#137a50' : '#50e396' }}>xe</span>
                  </span>
                )}
              </Link>
              <button
                type="button"
                className="verdelo-sidebar-toggle"
                onClick={toggleSidebarCollapse}
                title={isSidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <ChevronLeft
                  size={16}
                  strokeWidth={2.2}
                  style={{
                    transition: 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    transform: isSidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                  aria-hidden="true"
                />
              </button>
            </div>

            {/* Scrollable Navigation Area */}
            <div ref={sidebarScrollRef} className="dash-sidebar__scroll">
              <div ref={sidebarNavWrapRef} className="dash-sidebar-nav-wrap dash-nav-groups" style={{ position: 'relative' }}>
                {/* 🌟 UNIFIED FLOATING NAV PILL FOR THE ENTIRE SIDEBAR */}
                <span ref={unifiedNavPillRef} className="dash-nav-pill" aria-hidden="true" />

                {/* Categorized Accordion Navigation Groups */}
                {adminNavGroups.map(renderAdminGroup)}
              </div>
            </div>

            {/* Sidebar Footer: Fleet Health Quota Card + User Card */}
            <div className={`dash-sidebar__footer ${isSidebarCollapsed ? 'is-collapsed' : ''}`}>
              {isSidebarCollapsed ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                  <div ref={profileMenuRef} style={{ position: 'relative' }}>
                    <div
                      className="verdelo-user-avatar"
                      onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                      role="button"
                      tabIndex={0}
                      title={`${user.fullName || 'Admin'} (${roleLabel})`}
                      style={{ cursor: 'pointer', margin: '0 auto', width: 34, height: 34, fontSize: '0.85rem' }}
                    >
                      {initials}
                    </div>

                    {adminMenuOpen && (
                      <div
                        className="dash-dropdown-popover"
                        style={{
                          position: 'fixed',
                          left: '80px',
                          bottom: '16px',
                          padding: '12px',
                          zIndex: 1200,
                          minWidth: '220px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                          <div className="verdelo-user-avatar" style={{ width: 32, height: 32 }}>{initials}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ink)' }}>{user.fullName || 'Admin'}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email || 'admin@inferxe.com'}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
                          <button
                            type="button"
                            className="dash-nav-item dash-nav-item--danger"
                            onClick={async () => {
                              setAdminMenuOpen(false)
                              await performSignOut('/')
                            }}
                          >
                            <LogOut size={15} /> Sign Out
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Fleet cluster quota card matching Customer .verdelo-safe-spend-card */}
                  <div className="verdelo-safe-spend-card" title="Cluster Fleet: 4 Nodes · 14 Users (64% capacity)">
                    <div className="verdelo-safe-spend-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Cluster & Fleet</span>
                      <span style={{ fontSize: '0.68rem', color: dashTheme === 'light' ? '#137a50' : '#50e396', fontWeight: 700 }}>Tier IV</span>
                    </div>
                    <div className="verdelo-safe-spend-amount" style={{ fontSize: '1.15rem' }}>4 Nodes · 14 Users</div>
                    <div className="dash-quota-progress well" style={{ margin: '6px 0 4px', height: 4 }}>
                      <div className="dash-quota-bar" style={{ width: '64%', background: dashTheme === 'light' ? 'linear-gradient(90deg, #137a50 0%, #2fb877 100%)' : 'linear-gradient(90deg, #1f6448 0%, #50e396 100%)' }} />
                    </div>
                    <div className="verdelo-safe-spend-sub">Dedicated NVLink · 64% Load</div>
                  </div>

                  {/* Account Owner Card */}
                  <div ref={profileMenuRef} style={{ position: 'relative' }}>
                    <div
                      className="verdelo-user-pill"
                      onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                      role="button"
                      tabIndex={0}
                      title={`${user.fullName} (${roleLabel})`}
                    >
                      <div className="verdelo-user-avatar">{initials}</div>
                      <div className="verdelo-user-info">
                        <span className="verdelo-user-name">{user.fullName || 'Admin'}</span>
                        <span className="verdelo-user-email">{user.email || 'admin@inferxe.com'}</span>
                      </div>
                      <span className="verdelo-user-dots">•••</span>
                    </div>

                    {adminMenuOpen && (
                      <div
                        className="dash-dropdown-popover"
                        style={{
                          position: 'absolute',
                          bottom: 'calc(100% + 8px)',
                          left: 0,
                          right: 0,
                          padding: '12px',
                          zIndex: 1200,
                        }}
                      >
                        <div className="dash-user-head">
                          <div className="dash-user-name">{user.fullName}</div>
                          <div className="dash-user-email">{user.email}</div>
                          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span
                              className="tag"
                              style={{
                                background: 'rgba(80, 227, 150, 0.18)',
                                color: '#50e396',
                                borderColor: 'rgba(80, 227, 150, 0.4)',
                                fontSize: '0.68rem',
                                fontWeight: 600,
                              }}
                            >
                              {roleLabel}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
                          {import.meta.env.DEV && (
                            <button
                              type="button"
                              className="dash-nav-item"
                              style={{ fontSize: '0.78rem', padding: '6px 8px', width: '100%' }}
                              onClick={() => {
                                const next = !devSuperAdminMode
                                setDevSuperAdminMode(next)
                                try {
                                  localStorage.setItem('inferxe_dev_super_admin_mode', String(next))
                                  window.dispatchEvent(new Event('inferxe_admin_role_toggle'))
                                } catch {}
                              }}
                            >
                              <ShieldCheck size={13} style={{ color: devSuperAdminMode ? '#50e396' : 'var(--ink-3)' }} />
                              <span>{devSuperAdminMode ? 'Switch to Normal Admin' : 'Switch to Super Admin'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="dash-nav-item dash-nav-item--danger"
                            onClick={async () => {
                              setAdminMenuOpen(false)
                              await performSignOut('/')
                            }}
                          >
                            <LogOut size={15} /> Sign Out
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Link
                to="/"
                className="dash-sidebar__public-link"
                title="Back to Public Website"
                onClick={() => {
                  setHoveredFlyout(null)
                  setMobileMenuOpen(false)
                }}
              >
                <ExternalLink size={13} />
                {!isSidebarCollapsed && <span>Back to Public Website</span>}
              </Link>
            </div>
          </aside>

          {/* ── Right Content Pane ──────────────────────────────────────────── */}
          <div className="dash-customer-content-pane">
            {/* Top action bar matching Customer Dashboard */}
            <header className="dash-customer-topbar">
              {isMobile && (
                <button
                  className="dash-mobile-burger"
                  onClick={toggleSidebarCollapse}
                  aria-label="Toggle navigation menu"
                >
                  {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              )}

              <nav className="admin-topbar-crumbs" aria-label="Breadcrumb">
                <span>{crumbGroup}</span>
                <ChevronRight size={14} aria-hidden="true" />
                <strong aria-current="page">{crumbPage}</strong>
              </nav>

              {/* Search Capsule with integrated live search */}
              <AdminHeaderSearch sections={searchableSections} isSuperAdmin={isSuperAdmin} />

              {/* Action cluster on right */}
              <div className="dash-customer-topbar__actions">
                {/* Sun / Theme icon */}
                <button
                  id="dash-header-theme-toggle"
                  className="verdelo-topbar-icon-btn"
                  onClick={(e) => toggleTheme(e)}
                  title={dashTheme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                  aria-label="Toggle light / dark mode"
                >
                  {dashTheme === "light" ? <Moon size={17} /> : <Sun size={17} />}
                </button>

                {/* Bell with mint dot & Alerts dropdown */}
                <div ref={notifRef} style={{ position: 'relative' }}>
                  <button
                    className="verdelo-topbar-icon-btn verdelo-bell-btn"
                    title="Notifications & Alerts"
                    aria-label="Notifications & Alerts"
                    onClick={() => {
                      setNotifOpen(!notifOpen)
                      setAdminMenuOpen(false)
                    }}
                  >
                    <Bell size={18} />
                    {unreadNotifCount > 0 && <span className="verdelo-bell-dot" />}
                  </button>

                  {notifOpen && (
                    <div className="verdelo-alerts-popup">
                      <div className="verdelo-alerts-header">
                        <h3 className="verdelo-alerts-title">Notifications</h3>
                        <button
                          type="button"
                          className="verdelo-alerts-mark-read"
                          onClick={() => {
                            const updated = liveNotifs.map((n) => ({ ...n, read: true }))
                            setLiveNotifs(updated)
                            localStorage.setItem('inferxe_demo_notifications_v3', JSON.stringify(updated))
                            window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
                          }}
                        >
                          Mark all read
                        </button>
                      </div>

                      <div className="verdelo-alerts-list">
                        {liveNotifs.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                            No notifications yet.
                          </div>
                        ) : (
                          liveNotifs.slice(0, 5).map((n) => (
                            <div
                              key={n.id}
                              className="verdelo-alert-row"
                              style={{ cursor: 'pointer' }}
                              onClick={() => {
                                const updated = liveNotifs.map((item) => (item.id === n.id ? { ...item, read: true } : item))
                                setLiveNotifs(updated)
                                localStorage.setItem('inferxe_demo_notifications_v3', JSON.stringify(updated))
                                window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
                                setNotifOpen(false)
                                navigate('/dashboard/notifications')
                              }}
                            >
                              <div className={`verdelo-alert-icon-box verdelo-alert-icon-box--${n.type === 'Billing' ? 'settled' : 'pending'}`}>
                                <ActivityIcon size={16} />
                              </div>
                              <div className="verdelo-alert-body">
                                <div className="verdelo-alert-title-line">
                                  <span className="verdelo-alert-name">{n.title}</span>
                                  {!n.read && <span className="verdelo-alert-dot" />}
                                </div>
                                <div className="verdelo-alert-desc">{n.detail}</div>
                                <div className="verdelo-alert-time">{n.time}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      <div style={{ marginTop: 8, borderTop: '1px solid rgba(80, 227, 150, 0.12)', paddingTop: 10, textAlign: 'center' }}>
                        <Link
                          to="/dashboard/notifications"
                          style={{ fontSize: '0.74rem', color: '#50e396', textDecoration: 'none', fontWeight: 600 }}
                          onClick={() => setNotifOpen(false)}
                        >
                          View All Notifications →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* User Avatar Circle */}
                <div ref={topbarProfileRef} style={{ position: 'relative' }}>
                  <div
                    className="verdelo-avatar-pill"
                    onClick={() => {
                      setAdminMenuOpen(!adminMenuOpen)
                      setNotifOpen(false)
                    }}
                    role="button"
                    tabIndex={0}
                    title={`${user.fullName} (${roleLabel})`}
                  >
                    <span className="admin-topbar-avatar">{initials}</span>
                    <span className="admin-topbar-name">{user.fullName || 'Admin'}</span>
                  </div>

                  {adminMenuOpen && (
                    <div
                      className="dash-dropdown-popover"
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 10px)',
                        right: 0,
                        width: '270px',
                        padding: '12px',
                        zIndex: 1100,
                      }}
                    >
                      <div className="dash-user-head">
                        <div className="dash-user-name">{user.fullName}</div>
                        <div className="dash-user-email">{user.email}</div>
                        <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span
                            className="tag"
                            style={{
                              background: 'rgba(80, 227, 150, 0.18)',
                              color: '#50e396',
                              borderColor: 'rgba(80, 227, 150, 0.4)',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                            }}
                          >
                            {roleLabel}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
                        {import.meta.env.DEV && (
                          <div style={{ paddingBottom: 6, marginBottom: 4, borderBottom: '1px solid var(--line)' }}>
                            <div style={{ fontSize: '0.66rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px 4px', fontFamily: 'var(--font-mono)' }}>
                              Dev Preview Role
                            </div>
                            <button
                              type="button"
                              className="dash-nav-item"
                              style={{ fontSize: '0.78rem', padding: '6px 8px', width: '100%' }}
                              onClick={() => {
                                const next = !devSuperAdminMode
                                setDevSuperAdminMode(next)
                                try {
                                  localStorage.setItem('inferxe_dev_super_admin_mode', String(next))
                                  window.dispatchEvent(new Event('inferxe_admin_role_toggle'))
                                } catch {}
                              }}
                            >
                              <ShieldCheck size={13} style={{ color: devSuperAdminMode ? '#50e396' : 'var(--ink-3)' }} />
                              <span>{devSuperAdminMode ? 'Switch to Normal Admin' : 'Switch to Super Admin'}</span>
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="dash-nav-item dash-nav-item--danger"
                          onClick={async () => {
                            setAdminMenuOpen(false)
                            await performSignOut('/')
                          }}
                        >
                          <LogOut size={15} /> Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </header>

            {/* Main Content Area */}
            <main className="dash-main" ref={mainPaneRef}>
              <AdminErrorBoundary onRetry={() => navigate(location.pathname, { replace: true })}>
                <AdminViewTransition
                  k={location.pathname}
                  order={getAdminRouteOrder(location.pathname)}
                  scrollContainerRef={mainPaneRef}
                >
                  <Suspense fallback={<AdminContentSkeleton />}>{currentOutlet}</Suspense>
                </AdminViewTransition>
              </AdminErrorBoundary>
            </main>
          </div>
        </div>

        {/* Floating flyout tooltip in collapsed rail mode */}
        {isSidebarCollapsed && !isMobile && hoveredFlyout && (
          <div
            className="dash-sidebar-flyout"
            style={{
              position: 'fixed',
              top: hoveredFlyout.top,
              left: hoveredFlyout.left,
              transform: 'translateY(-50%)',
              zIndex: 9999,
            }}
          >
            <span>{hoveredFlyout.label}</span>
            {hoveredFlyout.badge && <span className="dash-nav-badge">{hoveredFlyout.badge}</span>}
          </div>
        )}
      </div>
    </DashboardLayoutContext.Provider>
  )
}
