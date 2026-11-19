import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { Link, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity as ActivityIcon,
  BarChart3,
  Bell,
  Moon,
  Plus,
  Search,
  Sun,
  ChevronDown,
  ChevronLeft,
  Cpu,
  ExternalLink,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Settings,
  Sparkles,
  Send,
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
import { LogoMark } from '../Logo'
import { Ambient } from '../layout/Ambient'
import { getSession, performSignOut, getPortalRole, type AuthSession, type PortalRole } from '../../lib/authStore'
import { getAdminAccounts, syncAdminAccountsFromBackend } from '../../lib/adminAccountStore'
import { getAllRoles } from '../../lib/adminRoleStore'
import { animateNavPill } from './navPillAnimation'
import { AdminViewTransition, getAdminRouteOrder } from './AdminViewTransition'
import { DashboardLayoutContext } from './DashboardLayoutContext'

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  badgeType?: 'pill' | 'count'
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
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const mainPaneRef = useRef<HTMLElement>(null)

  // Unified Floating Nav Pill & Container Refs
  const sidebarNavWrapRef = useRef<HTMLDivElement>(null)
  const unifiedNavPillRef = useRef<HTMLSpanElement>(null)
  const adminNavRef = useRef<HTMLElement>(null)
  const providerNavRef = useRef<HTMLElement>(null)

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

  // Collapsible nav sections
  const [adminSuperAdminOpen, setAdminSuperAdminOpen] = useState(true)
  const [adminSectionOpen, setAdminSectionOpen] = useState(true)
  const [providerSectionOpen, setProviderSectionOpen] = useState(true)

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

  // Mobile responsiveness
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 840
    return false
  })

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 840
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
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) setAdminMenuOpen(false)
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

  // Demo 1-Hour Trial state
  const [trialTimeLeft, setTrialTimeLeft] = useState<number | null>(() => {
    const active = localStorage.getItem('inferxe_demo_trial_active') === 'true'
    const start = Number(localStorage.getItem('inferxe_demo_trial_start') || '0')
    if (!active || !start) return null
    return Math.max(0, 3600000 - (Date.now() - start))
  })

  useEffect(() => {
    const checkTimer = () => {
      const active = localStorage.getItem('inferxe_demo_trial_active') === 'true'
      const start = Number(localStorage.getItem('inferxe_demo_trial_start') || '0')
      if (active && start) {
        setTrialTimeLeft(Math.max(0, 3600000 - (Date.now() - start)))
      } else {
        setTrialTimeLeft(null)
      }
    }
    const interval = setInterval(checkTimer, 1000)
    return () => clearInterval(interval)
  }, [])

  const startTrialNow = () => {
    localStorage.setItem('inferxe_demo_trial_active', 'true')
    localStorage.setItem('inferxe_demo_trial_start', Date.now().toString())
    setTrialTimeLeft(3600000)
    navigate('/dashboard/customer')
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

  // Strict server-verified Super Admin access gating (no dev bypasses)
  const isSuperAdmin = portalRole === 'superadmin'

  const roleLabel = isSuperAdmin ? 'Super Admin' : 'Admin'

  // Nav Items
  // 0. Super Admin Governance (RBAC, Accounts, Permissions, Activity & Audit)
  const adminSuperAdminItems: NavItem[] = [
    { label: 'Super Admin Overview', to: '/dashboard/super-admin', icon: ShieldCheck },
    { label: 'Admin Accounts', to: '/dashboard/super-admin/accounts', icon: UserCheck, badge: String(adminAccountsCount), badgeType: 'count' },
    { label: 'Role Management', to: '/dashboard/super-admin/roles', icon: KeyRound, badge: String(adminRolesCount), badgeType: 'count' },
    { label: 'Permission Management', to: '/dashboard/super-admin/permissions', icon: Sliders, badge: '25', badgeType: 'count' },
    { label: 'Activity Monitoring', to: '/dashboard/super-admin/activity', icon: ActivityIcon },
    { label: 'Audit Logs', to: '/dashboard/super-admin/audit', icon: FileText },
  ]

  const adminAdministrationItems: NavItem[] = [
    { label: 'Admin Console', to: '/dashboard', icon: LayoutDashboard },
    { label: 'Customer Management', to: '/dashboard/customers', icon: Users },
    { label: 'Users Directory', to: '/dashboard/users', icon: Users },
    { label: 'Sovereign Nodes Map', to: '/dashboard/users/map', icon: Globe },
  ]

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
      return path === '/dashboard/super-admin'
    }
    return path === item.to || path.startsWith(`${item.to}/`)
  }

  // 🌟 Active Nav Pill Liquid Animation Driver — Single unified pill across all sidebar items
  useLayoutEffect(() => {
    const animate = !isFirstNavPillMount.current
    const radius = isSidebarCollapsed ? 14 : 9999

    const activeItemEl = sidebarNavWrapRef.current?.querySelector<HTMLElement>('.dash-nav-item.is-active')
    animateNavPill(unifiedNavPillRef.current, activeItemEl, { animate, radius })

    isFirstNavPillMount.current = false
  }, [location.pathname, isSidebarCollapsed, adminSuperAdminOpen, adminSectionOpen, providerSectionOpen, isSuperAdmin])

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
  }, [isSidebarCollapsed, adminSuperAdminOpen, adminSectionOpen, providerSectionOpen, isSuperAdmin])

  return (
    <DashboardLayoutContext.Provider value={true}>
      <div className="dash-shell" data-theme={dashTheme} data-role="admin">
        <Ambient />
        <div className="dash-window-frame">
          {/* ── Top Navigation Bar ──────────────────────────────── */}
          <header className="dash-topbar">
            <div className="dash-topbar__left">
              <Link to="/dashboard" className="row" style={{ gap: 10, alignItems: 'center' }}>
                <LogoMark size={28} theme={dashTheme} />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--ink)' }}>
                  Infer<span style={{ color: 'var(--brand-hi)' }}>xe</span>
                </span>
              </Link>

              <span className="dash-topbar__divider" aria-hidden />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.66rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: dashTheme === 'light' ? 'rgba(14, 165, 233, 0.12)' : 'rgba(14, 165, 233, 0.18)',
                  color: dashTheme === 'light' ? '#0284c7' : '#38bdf8',
                  border: `1px solid ${dashTheme === 'light' ? 'rgba(14, 165, 233, 0.35)' : 'rgba(56, 189, 248, 0.3)'}`,
                  marginLeft: 4,
                  fontWeight: 600,
                }}
              >
                Admin Portal
              </span>
            </div>

            {/* Center: Search Bar & Quick Actions matching Customer Visual System */}
            <div className="dash-topbar__center" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                className="verdelo-search-pill"
                onClick={() => {
                  const searchInput = document.querySelector('input[type="text"], input[type="search"]') as HTMLInputElement | null
                  if (searchInput) searchInput.focus()
                }}
                role="button"
                tabIndex={0}
                aria-label="Search customers, GPUs, telemetry"
                style={{ cursor: 'pointer' }}
              >
                <Search size={14} className="verdelo-search-icon" />
                <span className="verdelo-search-text" style={{ fontSize: '0.8rem' }}>Search customers, GPUs, telemetry...</span>
                <kbd className="verdelo-search-kbd">⌘K</kbd>
              </div>

              {/* Quick Action Button: Add User or Deploy */}
              <button
                type="button"
                className="verdelo-btn-circle verdelo-btn-circle--mint"
                onClick={() => navigate('/dashboard/users/add')}
                title="Add User / Deploy"
                aria-label="Add User or Deploy"
              >
                <Plus size={16} strokeWidth={2.8} />
              </button>

              {/* Quick Navigation / Sovereign Nodes Telemetry */}
              <button
                type="button"
                className="verdelo-btn-circle verdelo-btn-circle--glass"
                onClick={() => navigate('/dashboard/users/map')}
                title="Sovereign Nodes Fleet Map"
                aria-label="Sovereign Nodes Fleet Map"
              >
                <Send size={14} />
              </button>

              {/* Admin Telemetry / Trial chip */}
              {trialTimeLeft !== null ? (
                trialTimeLeft > 0 ? (
                  <div
                    className={`mw-trial-chip ${trialTimeLeft < 600000 ? 'mw-trial-chip--warning' : ''}`}
                    onClick={() => navigate('/dashboard')}
                    title="1-Hour Free Trial active (Demo)"
                  >
                    <span className="dash-pulse-dot" style={{ background: trialTimeLeft < 600000 ? '#f59e0b' : '#50e396' }} />
                    <span>
                      Trial: {Math.floor(trialTimeLeft / 60000)}m {Math.floor((trialTimeLeft % 60000) / 1000).toString().padStart(2, '0')}s
                    </span>
                  </div>
                ) : (
                  <div
                    className="mw-trial-chip mw-trial-chip--expired"
                    onClick={() => navigate('/dashboard/wallet')}
                    title="1-Hour Free Trial Expired. Upgrade."
                  >
                    <span>⚠️ Trial Expired · Upgrade</span>
                  </div>
                )
              ) : (
                <button
                  className="mw-trial-chip"
                  onClick={startTrialNow}
                  title="Start your 1-hour free GPU trial (Demo)"
                >
                  <Sparkles size={12} />
                  <span>Start 1-Hr Trial</span>
                </button>
              )}
            </div>

            {/* Right: Notifications & Admin Profile */}
            <div className="dash-topbar__right">
              <button
                id="dash-header-theme-toggle"
                className={`dash-theme-toggle dash-theme-toggle--${dashTheme}`}
                onClick={(e) => toggleTheme(e)}
                title={dashTheme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                aria-label="Toggle light / dark mode"
              >
                <AnimatePresence initial={false}>
                  <motion.span
                    key={dashTheme}
                    className="dash-theme-icon-wrap"
                    initial={{
                      rotate: dashTheme === 'light' ? 90 : -90,
                      scale: 0.25,
                      opacity: 0,
                      color: dashTheme === 'light' ? '#FBBF24' : '#0284c7',
                    }}
                    animate={{
                      rotate: 0,
                      scale: 1,
                      opacity: 1,
                      color: dashTheme === 'light' ? '#0284c7' : '#FBBF24',
                    }}
                    exit={{
                      rotate: dashTheme === 'light' ? -90 : 90,
                      scale: 0.25,
                      opacity: 0,
                      color: dashTheme === 'light' ? '#0284c7' : '#FBBF24',
                    }}
                    transition={{
                      duration: 0.45,
                      ease: [0.34, 1.3, 0.64, 1],
                    }}
                  >
                    {dashTheme === "light" ? (
                      <Moon size={16} className="dash-theme-icon dash-theme-icon--moon" />
                    ) : (
                      <Sun size={16} className="dash-theme-icon dash-theme-icon--sun" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </button>

              {/* Admin Notifications */}
              <div ref={notifRef} style={{ position: 'relative' }}>
                <button
                  className="dash-topbar__btn-icon"
                  title="Notifications"
                  aria-label="Notifications"
                  onClick={() => {
                    setNotifOpen(!notifOpen)
                    setAdminMenuOpen(false)
                  }}
                  style={{ position: 'relative' }}
                >
                  <Bell size={17} />
                  {unreadNotifCount > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        background: '#ef4444',
                        color: '#fff',
                        borderRadius: '50%',
                        minWidth: 15,
                        height: 15,
                        padding: '0 3px',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1.5px solid var(--surface-1)',
                      }}
                    >
                      {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </span>
                  ) : null}
                </button>

                {notifOpen && (
                  <div
                    className="dash-dropdown-popover"
                    style={{
                      width: '350px',
                      padding: '16px',
                      maxHeight: '440px',
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--brand-hi)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em' }}>
                        Notifications & Alerts
                      </span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {unreadNotifCount > 0 && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 10,
                              background: 'rgba(239, 68, 68, 0.16)',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              color: '#ef4444',
                            }}
                          >
                            {unreadNotifCount} new
                          </span>
                        )}
                        <button
                          type="button"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--ink-muted)',
                            fontSize: '0.68rem',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
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
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {liveNotifs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                          No notifications yet.
                        </div>
                      ) : (
                        liveNotifs.slice(0, 5).map((n) => (
                          <div
                            key={n.id}
                            className={`dash-notif-card ${!n.read ? 'dash-notif-card--accent' : 'dash-notif-card--standard'}`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              const updated = liveNotifs.map((item) => item.id === n.id ? { ...item, read: true } : item)
                              setLiveNotifs(updated)
                              localStorage.setItem('inferxe_demo_notifications_v3', JSON.stringify(updated))
                              window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
                              setNotifOpen(false)
                              navigate('/dashboard/notifications')
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                              <span
                                style={{
                                  fontSize: '0.66rem',
                                  textTransform: 'uppercase',
                                  fontWeight: 700,
                                  color: n.type === 'Billing' ? '#10b981' : n.type === 'Deployment' ? '#06b6d4' : 'var(--brand-hi)',
                                }}
                              >
                                {n.type}
                              </span>
                              <span style={{ fontSize: '0.64rem', color: 'var(--ink-muted)' }}>{n.time}</span>
                            </div>
                            <div className="dash-notif-card__title" style={{ fontWeight: !n.read ? 700 : 500 }}>
                              {n.title}
                            </div>
                            <div className="dash-notif-card__desc">{n.detail}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, textAlign: 'center' }}>
                      <Link
                        to="/dashboard/notifications"
                        style={{ fontSize: '0.74rem', color: 'var(--brand-hi)', textDecoration: 'none', fontWeight: 600 }}
                        onClick={() => setNotifOpen(false)}
                      >
                        View All Notifications →
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Admin Profile */}
              <div ref={profileMenuRef} style={{ position: 'relative' }}>
                <div
                  className="dash-admin-profile"
                  onClick={() => {
                    setAdminMenuOpen(!adminMenuOpen)
                    setNotifOpen(false)
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="User Profile Menu"
                >
                  <div className="dash-admin-avatar">
                    {initials}
                    <span className="dash-admin-avatar__online" />
                  </div>
                  <div className="dash-admin-info">
                    <span className="dash-admin-name">{user.fullName}</span>
                    <span className="dash-admin-role">{roleLabel}</span>
                  </div>
                  <ChevronDown size={14} style={{ color: 'var(--ink-3)' }} />
                </div>

                {adminMenuOpen && (
                  <div
                    className="dash-dropdown-popover"
                    style={{
                      width: '270px',
                      padding: '12px',
                    }}
                  >
                    <div className="dash-user-head">
                      <div className="dash-user-name">{user.fullName}</div>
                      <div className="dash-user-email">{user.email}</div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span
                          className="tag"
                          style={{
                            background: 'rgba(118, 185, 0, 0.18)',
                            color: 'var(--brand-hi)',
                            borderColor: 'var(--brand)',
                            fontSize: '0.68rem',
                            fontWeight: 600,
                          }}
                        >
                          {roleLabel}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
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

              {/* Mobile hamburger */}
              <button
                className="dash-mobile-burger"
                onClick={toggleSidebarCollapse}
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </header>

          {/* ── Layout Body (Sidebar + Content) ─────────────────── */}
          <div className="dash-body">
            {mobileMenuOpen && (
              <div
                className="dash-sidebar-overlay"
                onClick={() => setMobileMenuOpen(false)}
                aria-hidden="true"
              />
            )}

            <aside
              className={`dash-sidebar ${
                isMobile
                  ? (mobileMenuOpen ? 'is-open' : '')
                  : (isSidebarCollapsed ? 'is-collapsed' : '')
              }`}
              aria-label="Dashboard Sidebar"
            >
              <div className="dash-sidebar__top">
                {!isSidebarCollapsed && (
                  <span className="dash-sidebar__workspace-tag">
                    Admin Control
                  </span>
                )}
                <button
                  type="button"
                  className="dash-sidebar__toggle-btn"
                  onClick={toggleSidebarCollapse}
                  title={isSidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
                  aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  <ChevronLeft
                    size={14}
                    style={{
                      transition: 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)',
                      transform: isSidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>
              </div>

              <div ref={sidebarScrollRef} className="dash-sidebar__scroll">
                <div ref={sidebarNavWrapRef} className="dash-sidebar-nav-wrap" style={{ position: 'relative' }}>
                  {/* 🌟 ONE UNIFIED FLOATING NAV PILL FOR THE ENTIRE SIDEBAR */}
                  <span ref={unifiedNavPillRef} className="dash-nav-pill" aria-hidden="true" />

                  {/* Section 0: Super Admin Governance */}
                  {isSuperAdmin && (
                    <>
                      <button
                        type="button"
                        className="dash-nav-section-title dash-nav-section-btn"
                        onClick={() => setAdminSuperAdminOpen(!adminSuperAdminOpen)}
                        aria-expanded={adminSuperAdminOpen}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ShieldCheck size={13} style={{ color: dashTheme === 'light' ? '#0e5b3c' : '#50e396' }} />
                          <span>Super Admin</span>
                        </span>
                        <ChevronDown
                          size={13}
                          style={{
                            transition: 'transform 0.24s cubic-bezier(0.25, 1, 0.5, 1)',
                            transform: adminSuperAdminOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                          }}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {adminSuperAdminOpen && (
                          <motion.nav
                            className="dash-nav-list"
                            aria-label="Super Admin Navigation"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
                            style={{ overflow: 'hidden', position: 'relative' }}
                          >
                            {adminSuperAdminItems.map((item) => {
                              const active = isItemActive(item)
                              return (
                                <Link
                                  key={item.label}
                                  to={item.to}
                                  className={`dash-nav-item ${active ? 'is-active' : ''}`}
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
                                  <item.icon />
                                  <span>{item.label}</span>
                                  {item.badge && (
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
                    </>
                  )}

                  {/* Section A: Administration */}
                  <button
                    type="button"
                    className="dash-nav-section-title dash-nav-section-btn"
                    style={isSuperAdmin ? { marginTop: 18 } : undefined}
                    onClick={() => setAdminSectionOpen(!adminSectionOpen)}
                    aria-expanded={adminSectionOpen}
                  >
                    <span>Administration</span>
                    <ChevronDown
                      size={13}
                      style={{
                        transition: 'transform 0.24s cubic-bezier(0.25, 1, 0.5, 1)',
                        transform: adminSectionOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      }}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {adminSectionOpen && (
                      <motion.nav
                        ref={adminNavRef}
                        className="dash-nav-list"
                        aria-label="Administration Navigation"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
                        style={{ overflow: 'hidden', position: 'relative' }}
                      >
                        {adminAdministrationItems.map((item) => {
                          const active = isItemActive(item)
                          return (
                            <Link
                              key={item.label}
                              to={item.to}
                              className={`dash-nav-item ${active ? 'is-active' : ''}`}
                              onClick={() => {
                                setHoveredFlyout(null)
                                setMobileMenuOpen(false)
                              }}
                            >
                              <item.icon />
                              <span>{item.label}</span>
                              {item.badge && <span className="dash-nav-badge">{item.badge}</span>}
                            </Link>
                          )
                        })}
                      </motion.nav>
                    )}
                  </AnimatePresence>

                  {/* Section B: Provider Management */}
                  <button
                    type="button"
                    className="dash-nav-section-title dash-nav-section-btn"
                    style={{ marginTop: 20 }}
                    onClick={() => setProviderSectionOpen(!providerSectionOpen)}
                    aria-expanded={providerSectionOpen}
                  >
                    <span>Provider Management</span>
                    <ChevronDown
                      size={13}
                      style={{
                        transition: 'transform 0.24s cubic-bezier(0.25, 1, 0.5, 1)',
                        transform: providerSectionOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      }}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {providerSectionOpen && (
                      <motion.nav
                        ref={providerNavRef}
                        className="dash-nav-list"
                        aria-label="Provider Management Navigation"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
                        style={{ overflow: 'hidden', position: 'relative' }}
                      >
                        {adminProviderManagementItems.map((item) => {
                          const active = isItemActive(item)
                          return (
                            <Link
                              key={item.label}
                              to={item.to}
                              className={`dash-nav-item ${active ? 'is-active' : ''}`}
                              onClick={() => {
                                setHoveredFlyout(null)
                                setMobileMenuOpen(false)
                              }}
                            >
                              <item.icon />
                              <span>{item.label}</span>
                              {item.badge && <span className="dash-nav-badge">{item.badge}</span>}
                            </Link>
                          )
                        })}
                      </motion.nav>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Quota & Organization Footer */}
              <div className="dash-sidebar__footer">
                <div className="dash-quota-card plate plate--dark" title="Cluster Fleet: 4 Nodes · 14 Users (64% capacity)">
                  <div className="dash-quota-card__header">
                    <span className="dash-quota-card__label engrave" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Cluster & Node Fleet
                    </span>
                    <span className="dash-quota-card__val readout" style={{ fontSize: '0.78rem' }}>4 Nodes · 14 Users</span>
                  </div>
                  <div className="dash-quota-progress well">
                    <div className="dash-quota-bar" style={{ width: '64%' }} />
                  </div>
                  <div className="dash-quota-card__sub">
                    Enterprise Sovereign Control · Tier IV Infrastructure
                  </div>
                </div>

                {!isSidebarCollapsed && (
                  <div
                    className="verdelo-user-pill"
                    onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                    role="button"
                    tabIndex={0}
                    style={{ marginTop: 8 }}
                  >
                    <div className="verdelo-user-avatar">{initials}</div>
                    <div className="verdelo-user-info">
                      <span className="verdelo-user-name">{user.fullName || 'Admin'}</span>
                      <span className="verdelo-user-email">{user.email || 'admin@inferxe.com'}</span>
                    </div>
                    <span className="verdelo-user-dots">•••</span>
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
                  <span>Back to Public Website</span>
                </Link>
              </div>
            </aside>

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

            {/* Main Content Area with Customer-Replicated Smooth View Transition */}
            <main className="dash-main" ref={mainPaneRef}>
              <AdminViewTransition
                k={location.pathname}
                order={getAdminRouteOrder(location.pathname)}
                scrollContainerRef={mainPaneRef}
              >
                {currentOutlet}
              </AdminViewTransition>
            </main>
          </div>
        </div>
      </div>
    </DashboardLayoutContext.Provider>
  )
}

