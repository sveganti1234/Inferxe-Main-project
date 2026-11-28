import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  Activity as ActivityIcon,
  BarChart3,
  Bell,
  Moon,
  Sun,
  ChevronRight,
  Cpu,
  ExternalLink,
  Globe,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Server,
  Settings,
  User,
  UserPlus,
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
import { LogoMark } from '../Logo'
import { getSession, performSignOut, getPortalRole, type AuthSession, type PortalRole } from '../../lib/authStore'
import { useMediaQuery } from '../../lib/hooks'
import { getAdminAccounts, syncAdminAccountsFromBackend } from '../../lib/adminAccountStore'
import { getAllRoles } from '../../lib/adminRoleStore'
import { AdminViewTransition, getAdminRouteOrder } from './AdminViewTransition'
import { AdminContentSkeleton } from './AdminContentSkeleton'
import { HoverTip } from '../../features/customer/ui/HoverTip'
// Admin-only styles: loaded with the admin chunk, not on public pages. The shell reuses the customer
// console's design system (.cx-*) so admin and customer consoles look the same.
import '../../styles/super-admin.css'
import '../../features/customer/styles/customer.css'
import '../../styles/admin-console.css'
import { AdminErrorBoundary } from './AdminErrorBoundary'
import { DashboardLayoutContext } from './DashboardLayoutContext'
import { AdminHeaderSearch, type AdminSearchSectionItem } from './AdminHeaderSearch'
import {
  fetchAdminNotifications,
  fetchAdminUnreadCount,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  toUiNotification,
  type AdminUiNotification,
} from '../../lib/adminNotificationService'

export function preloadRoute(_path: string) {}

const ACTIVE_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const
const HOVER_SPRING = { type: 'spring', stiffness: 500, damping: 40, opacity: { duration: 0.12 } } as const
const MENU_MOTION = {
  initial: { opacity: 0, scale: 0.96, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
} as const

/** Existing admin pages only. */
const QUICK_ACTIONS = [
  { to: '/dashboard/users/add', label: 'Add a user', hint: 'Create a platform account', icon: UserPlus },
  { to: '/dashboard/customers', label: 'Manage customers', hint: 'Accounts, plans and status', icon: Users },
  { to: '/dashboard/gpu-health', label: 'Check GPU health', hint: 'Fleet health and readiness', icon: ActivityIcon },
  { to: '/dashboard/keys', label: 'Monitor API keys', hint: 'Key usage and revocations', icon: KeyRound },
]

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
  const [quickOpen, setQuickOpen] = useState(false)
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)

  const notifRef = useRef<HTMLDivElement>(null)
  const quickRef = useRef<HTMLDivElement>(null)
  const topbarProfileRef = useRef<HTMLDivElement>(null)
  const mainPaneRef = useRef<HTMLElement>(null)

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

  // Live Notifications State (Synchronized with backend notifications API)
  const [liveNotifs, setLiveNotifs] = useState<AdminUiNotification[]>([])
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0)
  const [notifLoading, setNotifLoading] = useState<boolean>(false)
  const [isMarkingAllRead, setIsMarkingAllRead] = useState<boolean>(false)

  const syncNotifs = useCallback(async () => {
    try {
      const [notifsRes, countRes] = await Promise.all([
        fetchAdminNotifications({ limit: 10 }),
        fetchAdminUnreadCount(),
      ])
      if (notifsRes.ok && notifsRes.data) {
        setLiveNotifs(notifsRes.data.items.map(toUiNotification))
      }
      if (countRes.ok) {
        setUnreadNotifCount(countRes.unreadCount)
      } else if (notifsRes.ok && notifsRes.data) {
        setUnreadNotifCount(notifsRes.data.unread_count)
      }
    } catch {
      /* Keep existing state on transient network failures */
    } finally {
      setNotifLoading(false)
    }
  }, [])

  useEffect(() => {
    setNotifLoading(true)
    void syncNotifs()

    const onNotificationsChange = () => {
      void syncNotifs()
    }

    // 15-second background polling for live admin alerts
    const intervalId = setInterval(() => {
      void syncNotifs()
    }, 15000)

    window.addEventListener('inferxe_notifications_change', onNotificationsChange)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('inferxe_notifications_change', onNotificationsChange)
    }
  }, [syncNotifs, location.pathname])

  // Off-canvas drawer below 1024px (matches the console stylesheet breakpoint)
  const isMobile = useMediaQuery('(max-width: 1023px)')
  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false)
  }, [isMobile])
  // Navigating closes the drawer.
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

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
      if (quickRef.current && !quickRef.current.contains(target)) setQuickOpen(false)
      if (topbarProfileRef.current && !topbarProfileRef.current.contains(target)) setAdminMenuOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false)
        setAdminMenuOpen(false)
        setQuickOpen(false)
        setMobileMenuOpen(false)
      }
    }
    if (notifOpen || adminMenuOpen || quickOpen || mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [notifOpen, adminMenuOpen, quickOpen, mobileMenuOpen])

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
  // Sign-out clears the session before the server logout and page redirect finish; freeze the shell
  // meanwhile so it doesn't flash the fallback user / dev-preview Super Admin menu.
  const signingOutRef = useRef(false)
  const [signingOut, setSigningOut] = useState(false)
  const handleSignOut = async () => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    setAdminMenuOpen(false)
    await performSignOut('/login')
  }

  useEffect(() => {
    const handleAuth = () => {
      if (!signingOutRef.current) setCurrentSession(getSession())
    }
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
  // Dev preview only applies without a real session, so a logged-in admin never sees Super Admin items.
  const isDevPreview = import.meta.env.DEV && !currentSession
  const isSuperAdmin = Boolean(
    portalRole === 'superadmin' ||
    (isDevPreview && (devSuperAdminMode || location.pathname.startsWith('/dashboard/super-admin') || location.pathname.startsWith('/dashboard/superadmin')))
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
    { label: 'GPU Health Engine', to: '/dashboard/gpu-health', icon: ActivityIcon },
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

  // Topbar breadcrumb (customer-console style): sidebar group › active page
  const activeNavGroup = adminNavGroups.find((grp) => grp.items.some((item) => isItemActive(item)))
  const crumbGroup = !activeNavGroup || activeNavGroup.title === 'SYSTEM_DIVIDER'
    ? 'Console'
    : activeNavGroup.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  const crumbPage = activeNavGroup?.items.find((item) => isItemActive(item))?.label ?? 'Overview'

  // Collapsed (icon-only) rail: names appear beside each icon through the console HoverTip.
  const showRail = isSidebarCollapsed && !isMobile
  const railTip = (text: string) => (showRail ? { 'data-tip': text, 'data-tip-side': 'right' } : {})
  const closeNav = () => setMobileMenuOpen(false)

  const devRoleToggle = isDevPreview ? (
    <button
      type="button"
      className="cx-menu__item"
      role="menuitem"
      onClick={() => {
        const next = !devSuperAdminMode
        setDevSuperAdminMode(next)
        try {
          localStorage.setItem('inferxe_dev_super_admin_mode', String(next))
          window.dispatchEvent(new Event('inferxe_admin_role_toggle'))
        } catch {}
      }}
    >
      <ShieldCheck size={16} /> {devSuperAdminMode ? 'Dev preview: switch to Admin' : 'Dev preview: switch to Super Admin'}
    </button>
  ) : null

  return (
    <DashboardLayoutContext.Provider value={true}>
      <MotionConfig reducedMotion="user">
      <div className="cx-app adm-console" data-cx-theme={dashTheme === 'light' ? 'light' : 'forest'} data-role="admin">
        <a className="cx-skip" href="#cx-main">
          Skip to content
        </a>
        <div className={`cx-layout${isSidebarCollapsed ? ' is-rail' : ''}`}>
          {/* ── Sidebar ─────────────────────────────────────────────────────── */}
          <aside
            id="cx-sidebar"
            className={`cx-sidebar${mobileMenuOpen ? ' is-open' : ''}`}
            aria-label="Admin navigation"
            inert={(isMobile && !mobileMenuOpen) || undefined}
            role={isMobile && mobileMenuOpen ? 'dialog' : undefined}
            aria-modal={isMobile && mobileMenuOpen ? true : undefined}
          >
            <div className="cx-brand">
              <LogoMark size={30} theme={dashTheme} />
              <span className="cx-brand__name">
                Infer<em>xe</em>
              </span>
              <button
                type="button"
                className="cx-collapse"
                onClick={toggleSidebarCollapse}
                aria-pressed={isSidebarCollapsed}
                aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={showRail ? undefined : 'Collapse sidebar (Ctrl+B)'}
                {...railTip('Expand sidebar')}
              >
                {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                <span className="cx-collapse__text">Collapse sidebar</span>
              </button>
              <button type="button" className="cx-iconbtn cx-drawer-close" onClick={closeNav} aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>

            <nav className="cx-nav" onMouseLeave={() => setHoveredNav(null)}>
              {adminNavGroups.map((group) => (
                <div className="cx-nav__group" key={group.title}>
                  <div className="cx-nav__label">{group.title === 'SYSTEM_DIVIDER' ? 'System' : group.title}</div>
                  {group.items.map((item) => {
                    const active = isItemActive(item)
                    const key = `${group.title}:${item.label}`
                    return (
                      <Link
                        key={key}
                        to={item.to}
                        className="cx-nav__item"
                        aria-current={active ? 'page' : undefined}
                        aria-label={showRail ? item.label : undefined}
                        {...railTip(item.label)}
                        onClick={closeNav}
                        onMouseEnter={() => setHoveredNav(key)}
                      >
                        {active ? <motion.span layoutId="adm-nav-active" className="cx-nav__pill" transition={ACTIVE_SPRING} aria-hidden="true" /> : null}
                        <AnimatePresence>
                          {hoveredNav === key && !active ? (
                            <motion.span
                              layoutId="adm-nav-hover"
                              className="cx-nav__hoverpill"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={HOVER_SPRING}
                              aria-hidden="true"
                            />
                          ) : null}
                        </AnimatePresence>
                        <item.icon size={18} strokeWidth={1.9} aria-hidden="true" />
                        <span className="cx-nav__text">{item.label}</span>
                        {item.badge ? <span className="adm-nav__badge">{item.badge}</span> : null}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </nav>

            <div className="cx-sidebar__footer">
              <div className="cx-quota" title="Cluster Fleet: 4 Nodes · 14 Users (64% capacity)">
                <div className="cx-quota__head">
                  <span>Cluster &amp; fleet</span>
                  <strong>4 Nodes · 14 Users</strong>
                </div>
                <div className="cx-quota__bar" aria-hidden="true"><span style={{ width: '64%' }} /></div>
                <div className="cx-quota__meta">
                  <span>Dedicated NVLink</span>
                  <span>64% load</span>
                </div>
                <div className="cx-quota__sub">Tier IV</div>
              </div>
              <div className="cx-service" role="status" title={showRail ? undefined : `Signed in as ${roleLabel}`} {...railTip(`Signed in as ${roleLabel}`)}>
                <span className="cx-dot cx-dot--live is-pulsing" aria-hidden="true" />
                <span className="cx-service__text">Signed in as {roleLabel}</span>
              </div>
              <div className="cx-sidefoot">
                <div className="cx-sideaccount" title={showRail ? undefined : `${user.fullName || 'Admin'} (${roleLabel})`} {...railTip(user.fullName || 'Admin')}>
                  <span className="cx-avatar" aria-hidden="true">{initials}</span>
                  <span className="cx-sideaccount__text">
                    <strong>{user.fullName || 'Admin'}</strong>
                    {user.email ? <small>{user.email}</small> : null}
                  </span>
                </div>
              </div>
              <Link to="/" className="cx-backlink" title={showRail ? undefined : 'Back to Public Website'} {...railTip('Back to Public Website')} onClick={closeNav}>
                <ExternalLink size={15} aria-hidden="true" />
                <span className="cx-backlink__text">Back to Public Website</span>
              </Link>
            </div>
          </aside>
          {mobileMenuOpen ? <div className="cx-scrim" onClick={closeNav} aria-hidden="true" /> : null}
          <HoverTip />

          {/* ── Main column ─────────────────────────────────────────────────── */}
          <div className="cx-main" inert={(isMobile && mobileMenuOpen) || undefined}>
            <header className="cx-topbar">
              <button
                type="button"
                className="cx-iconbtn cx-topbar__menu"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation"
                aria-controls="cx-sidebar"
                aria-expanded={mobileMenuOpen}
              >
                <Menu size={18} />
              </button>

              <nav className="cx-crumbs" aria-label="Breadcrumb">
                <span>{crumbGroup}</span>
                <ChevronRight size={14} aria-hidden="true" />
                <strong aria-current="page">{crumbPage}</strong>
              </nav>

              <div className="cx-topbar__spacer" />

              <AdminHeaderSearch sections={searchableSections} isSuperAdmin={isSuperAdmin} />

              <div className="cx-quick" ref={quickRef}>
                <button
                  type="button"
                  className="cx-quickbtn"
                  onClick={() => {
                    setQuickOpen((v) => !v)
                    setNotifOpen(false)
                    setAdminMenuOpen(false)
                  }}
                  aria-haspopup="menu"
                  aria-expanded={quickOpen}
                  aria-label="Quick actions"
                  data-tip={quickOpen ? undefined : 'Quick actions'}
                >
                  <Plus size={18} strokeWidth={2.4} />
                </button>
                <AnimatePresence>
                  {quickOpen ? (
                    <motion.div key="quick" className="cx-menu cx-menu--quick" role="menu" aria-label="Quick actions" style={{ transformOrigin: 'top right' }} {...MENU_MOTION}>
                      {QUICK_ACTIONS.map(({ to, label, hint, icon: Icon }) => (
                        <Link key={to} to={to} className="cx-menu__item cx-menu__item--rich" role="menuitem" onClick={() => setQuickOpen(false)}>
                          <span className="cx-menu__icon" aria-hidden="true"><Icon size={16} /></span>
                          <span className="cx-menu__label">
                            <strong>{label}</strong>
                            <small>{hint}</small>
                          </span>
                        </Link>
                      ))}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <span className="cx-topbar__divider" aria-hidden="true" />

              <button
                type="button"
                className="cx-iconbtn cx-topbar__theme"
                onClick={(e) => toggleTheme(e)}
                aria-label={dashTheme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
                data-tip={dashTheme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
              >
                {dashTheme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>

              <div className="cx-account" ref={notifRef}>
                <button
                  type="button"
                  className="cx-iconbtn"
                  aria-haspopup="menu"
                  aria-expanded={notifOpen}
                  aria-label={unreadNotifCount ? `Notifications, ${unreadNotifCount} unread` : 'Notifications'}
                  data-tip={notifOpen ? undefined : 'Notifications'}
                  onClick={() => {
                    const nextOpen = !notifOpen
                    setNotifOpen(nextOpen)
                    setAdminMenuOpen(false)
                    setQuickOpen(false)
                    if (nextOpen) {
                      void syncNotifs()
                    }
                  }}
                >
                  <Bell size={18} />
                  {unreadNotifCount > 0 ? (
                    <span className="cx-iconbtn__count" aria-hidden="true">{unreadNotifCount > 99 ? '99+' : unreadNotifCount}</span>
                  ) : null}
                </button>
                <AnimatePresence>
                  {notifOpen ? (
                    <motion.div key="notifs" className="cx-menu adm-notifs" role="menu" aria-label="Notifications" style={{ transformOrigin: 'top right' }} {...MENU_MOTION}>
                      <div className="adm-notifs__head">
                        <strong>Notifications</strong>
                        <button
                          type="button"
                          className="adm-notifs__mark"
                          disabled={isMarkingAllRead || unreadNotifCount === 0}
                          onClick={async () => {
                            setIsMarkingAllRead(true)
                            setLiveNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
                            setUnreadNotifCount(0)
                            try {
                              await markAllAdminNotificationsRead()
                            } finally {
                              setIsMarkingAllRead(false)
                              void syncNotifs()
                            }
                          }}
                        >
                          {isMarkingAllRead ? 'Marking…' : 'Mark all read'}
                        </button>
                      </div>
                      {notifLoading && liveNotifs.length === 0 ? (
                        <div className="adm-notifs__empty">Loading notifications…</div>
                      ) : liveNotifs.length === 0 ? (
                        <div className="adm-notifs__empty">No notifications yet.</div>
                      ) : (
                        liveNotifs.slice(0, 5).map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            className="cx-menu__item cx-menu__item--rich"
                            role="menuitem"
                            onClick={async () => {
                              if (!n.read) {
                                setLiveNotifs((prev) => prev.map((item) => (item.id === n.id ? { ...item, read: true } : item)))
                                setUnreadNotifCount((prev) => Math.max(0, prev - 1))
                                void markAdminNotificationRead(n.id)
                              }
                              setNotifOpen(false)
                              navigate('/dashboard/notifications')
                            }}
                          >
                            <span className="cx-menu__icon" aria-hidden="true"><ActivityIcon size={16} /></span>
                            <span className="cx-menu__label">
                              <strong>
                                {n.title}
                                {!n.read ? <span className="adm-notifs__dot" aria-label="unread" /> : null}
                              </strong>
                              <small>{n.time} · {n.detail}</small>
                            </span>
                          </button>
                        ))
                      )}
                      <Link
                        to="/dashboard/notifications"
                        className="cx-menu__item"
                        role="menuitem"
                        onClick={() => setNotifOpen(false)}
                      >
                        <Bell size={16} /> View all notifications
                      </Link>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <div className="cx-account" ref={topbarProfileRef}>
                <button
                  type="button"
                  className="cx-account__trigger"
                  onClick={() => {
                    setAdminMenuOpen(!adminMenuOpen)
                    setNotifOpen(false)
                    setQuickOpen(false)
                  }}
                  aria-haspopup="menu"
                  aria-expanded={adminMenuOpen}
                  aria-label="Account menu"
                  data-tip={adminMenuOpen ? undefined : 'Account menu'}
                >
                  <span className="cx-avatar" aria-hidden="true">{initials}</span>
                  <span className="cx-account__name">{user.fullName || 'Admin'}</span>
                </button>
                <AnimatePresence>
                  {adminMenuOpen ? (
                    <motion.div key="account" className="cx-menu" role="menu" style={{ transformOrigin: 'top right' }} {...MENU_MOTION}>
                      <div className="cx-menu__head">
                        <span className="cx-avatar" aria-hidden="true">{initials}</span>
                        <div className="cx-menu__who">
                          <strong>{user.fullName || 'Admin'}</strong>
                          {user.email ? <span>{user.email}</span> : null}
                          <em className="adm-role-chip">{roleLabel}</em>
                        </div>
                      </div>
                      {devRoleToggle}
                      <button type="button" className="cx-menu__item" role="menuitem" onClick={(e) => { toggleTheme(e); setAdminMenuOpen(false) }}>
                        {dashTheme === 'light' ? <Moon size={16} /> : <Sun size={16} />} {dashTheme === 'light' ? 'Dark theme' : 'Light theme'}
                      </button>
                      <button
                        type="button"
                        className="cx-menu__item cx-menu__item--danger"
                        role="menuitem"
                        disabled={signingOut}
                        onClick={handleSignOut}
                      >
                        <LogOut size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
                      </button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </header>

            <main id="cx-main" ref={mainPaneRef} className="cx-content" tabIndex={-1}>
              {/* Admin pages keep their existing .dash-shell scoped styles (incl. light theme). */}
              <div className="dash-shell adm-console__pages" data-theme={dashTheme}>
                <AdminErrorBoundary onRetry={() => navigate(location.pathname, { replace: true })}>
                  <AdminViewTransition
                    k={location.pathname}
                    order={getAdminRouteOrder(location.pathname)}
                    scrollContainerRef={mainPaneRef}
                  >
                    <Suspense fallback={<AdminContentSkeleton />}>{currentOutlet}</Suspense>
                  </AdminViewTransition>
                </AdminErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </div>
      </MotionConfig>
    </DashboardLayoutContext.Provider>
  )
}
