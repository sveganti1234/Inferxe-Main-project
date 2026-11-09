import { useEffect, useState, useRef, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity as ActivityIcon,
  BarChart3,
  Bell,
  Gift,
  Moon,
  NotebookPen,
  Star,
  Sun,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  Cpu,
  CreditCard,
  ExternalLink,
  FileText,
  Globe,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  User,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { LogoMark } from '../Logo'
import { Ambient } from '../layout/Ambient'
import { getSession, clearSession, getPortalRole, type AuthSession, type PortalRole } from '../../lib/authStore'
interface BreadcrumbItem {
  label: string
  to?: string
}

interface DashboardLayoutProps {
  pageTitle?: string
  breadcrumb?: BreadcrumbItem[]
  heading?: string
  description?: string
  backButtonTo?: string
  backButtonLabel?: string
  onBackClick?: () => void
  hideHeader?: boolean
  children: ReactNode
}

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  matchExact?: boolean
}

export function DashboardLayout({
  breadcrumb = [
    { label: 'Dashboard', to: '/dashboard' },
  ],
  heading,
  description,
  backButtonTo,
  backButtonLabel,
  onBackClick,
  hideHeader = false,
  children,
}: DashboardLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  // Sidebar collapsed state (desktop: false = expanded 256px, true = collapsed 70px rail)
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
  const [adminSectionOpen, setAdminSectionOpen] = useState(true)
  const [providerSectionOpen, setProviderSectionOpen] = useState(true)
  const [customerSectionOpen, setCustomerSectionOpen] = useState(true)

  // Floating flyout tooltip state for collapsed rail mode (matching video)
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
    window.addEventListener('inferxe_notifications_change', syncNotifs)
    window.addEventListener('storage', syncNotifs)
    return () => {
      window.removeEventListener('inferxe_notifications_change', syncNotifs)
      window.removeEventListener('storage', syncNotifs)
    }
  }, [])

  const unreadNotifCount = liveNotifs.filter((n) => !n.read).length

  // Synchronized Monthly Spend Limit & Quota state (shared with Workspace Settings)
  const [monthlyBudget, setMonthlyBudget] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('inferxe_demo_budget')
      if (raw) {
        const parsed = JSON.parse(raw)
        const num = Number(parsed)
        if (!isNaN(num) && num > 0) return num
      }
    } catch {
      /* fallback to default */
    }
    return 10000
  })

  useEffect(() => {
    const syncBudget = () => {
      try {
        const raw = localStorage.getItem('inferxe_demo_budget')
        if (raw) {
          const parsed = JSON.parse(raw)
          const num = Number(parsed)
          if (!isNaN(num) && num > 0) {
            setMonthlyBudget(num)
            return
          }
        }
      } catch {
        /* fallback to default */
      }
      setMonthlyBudget(10000)
    }

    window.addEventListener('inferxe_budget_updated', syncBudget)
    window.addEventListener('storage', syncBudget)
    return () => {
      window.removeEventListener('inferxe_budget_updated', syncBudget)
      window.removeEventListener('storage', syncBudget)
    }
  }, [])

  const currentMonthSpend = 4820
  const budgetUsedPct = Math.min(100, Math.max(0, Math.round((currentMonthSpend / (monthlyBudget || 1)) * 100)))

  // Responsive mobile screen tracking
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 840
    }
    return false
  })

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 840
      setIsMobile(mobile)
      if (!mobile && mobileMenuOpen) {
        setMobileMenuOpen(false)
      }
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

  // Global hotkey: Ctrl+B or Cmd+B to toggle sidebar collapse
  useEffect(() => {
    const handleSidebarHotkey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
          return
        }
        e.preventDefault()
        toggleSidebarCollapse()
      }
    }
    window.addEventListener('keydown', handleSidebarHotkey)
    return () => window.removeEventListener('keydown', handleSidebarHotkey)
  }, [isMobile, mobileMenuOpen])

  // Close dropdown popovers on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false)
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
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

  // Light / dark mode (persisted per browser)
  const [dashTheme, setDashTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('inferxe_dash_theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  // Synchronize document attribute for global root styling
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dashTheme)
    document.documentElement.classList.toggle('light', dashTheme === 'light')
    document.documentElement.classList.toggle('dark', dashTheme === 'dark')
  }, [dashTheme])

  const toggleTheme = (e?: React.MouseEvent) => {
    const next = dashTheme === 'light' ? 'dark' : 'light'

    // Extract click origin coordinates (fallback to viewport center)
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
      } catch {
        /* storage unavailable */
      }
    }

    // 🌊 1. View Transitions API (Chromium / Modern Browsers): smooth circular wave
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
          }).catch(() => {
            /* Handled gracefully */
          })
        }
        return
      } catch {
        /* Fall back if startViewTransition throws */
      }
    }

    // 🌊 2. Cross-Browser Ripple Fallback (expanding radial wave sweeps in 500ms)
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

  // 1-Hour Real Elapsed Time Free Trial State (Customer Portal)
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
        const remaining = Math.max(0, 3600000 - (Date.now() - start))
        setTrialTimeLeft(remaining)
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

  // Resolve active session or fallback by route
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

  const defaultCustomerUser = {
    id: 'usr_demo_customer',
    fullName: 'Priya Sharma',
    email: 'priya.s@novatech.ai',
    username: 'priya.ml',
    role: 'customer',
    organization: 'NovaTech AI Systems',
  }

  const user = currentSession?.user ?? defaultCustomerUser
  const portalRole: PortalRole = getPortalRole(user.role)

  const initials = (user.fullName || 'User')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'IX'

  const roleLabel = portalRole === 'admin' ? 'Super Admin' : 'Customer'

  // 1. Customer Portal Navigation items (Strictly Customer-facing features only)
  const customerNavItems: NavItem[] = [
    { label: 'Customer Dashboard', to: '/dashboard/customer', icon: LayoutDashboard, matchExact: true },
    { label: 'GPU Marketplace', to: '/dashboard/gpus', icon: Cpu, matchExact: true },
    { label: 'LLM Catalog', to: '/dashboard/models', icon: Sparkles, matchExact: true },
    { label: 'Orders and Purchase History', to: '/dashboard/orders', icon: FileText, matchExact: true },
    { label: 'Wallet, Payments and Billing', to: '/dashboard/wallet', icon: Wallet, matchExact: true },
    { label: 'Checkout & Payments', to: '/dashboard/checkout', icon: CreditCard, matchExact: true },
    { label: 'Usage and Analytics', to: '/dashboard/analytics', icon: BarChart3, matchExact: true },
    { label: 'Inference Playground', to: '/dashboard/playground', icon: Terminal, badge: 'Sandbox', matchExact: true },
    { label: 'API Keys', to: '/dashboard/api-keys', icon: KeyRound, matchExact: true },
    { label: 'SSH Keys', to: '/dashboard/ssh-keys', icon: ShieldCheck, matchExact: true },
    { label: 'Notebooks and SSH', to: '/dashboard/notebooks', icon: NotebookPen, matchExact: true },
    { label: 'Wishlist', to: '/dashboard/wishlist', icon: Bookmark, matchExact: true },
    { label: 'Deployments', to: '/dashboard/deployments', icon: Server, badge: '3 live', matchExact: true },
    { label: 'Spot Price History', to: '/dashboard/price-history', icon: TrendingUp, matchExact: true },
    { label: 'Notifications', to: '/dashboard/notifications', icon: Bell, matchExact: true },
    { label: 'Profile and Settings', to: '/dashboard/profile', icon: User, matchExact: true },
    { label: 'Reviews and Notes', to: '/dashboard/reviews', icon: Star, matchExact: true },
    { label: 'Rewards and Discounts', to: '/dashboard/rewards', icon: Gift, matchExact: true },
    { label: 'Chatbot and Help', to: '/dashboard/faq', icon: HelpCircle, matchExact: true },
    { label: 'Workspace Settings', to: '/dashboard/settings', icon: Settings, matchExact: true },
  ]

  // 2. Admin Portal Navigation items: Administration section (Add User accessed directly from Users Directory)
  const adminAdministrationItems: NavItem[] = [
    { label: 'Admin Console', to: '/dashboard', icon: LayoutDashboard, matchExact: true },
    { label: 'Customer Management', to: '/dashboard/customers', icon: Users, matchExact: true },
    { label: 'Users Directory', to: '/dashboard/users', icon: Users, matchExact: true },
    { label: 'Sovereign Nodes Map', to: '/dashboard/users/map', icon: Globe, matchExact: true },
  ]

  // 3. Admin Portal Navigation items: Provider Management section (Onboarding accessed directly from Provider Overview)
  const adminProviderManagementItems: NavItem[] = [
    { label: 'Provider Overview', to: '/dashboard/provider', icon: Server, matchExact: true },
    { label: 'GPU Listings', to: '/dashboard/provider/listings', icon: Cpu, matchExact: true },
    { label: 'Capacity & Health', to: '/dashboard/provider/capacity', icon: ActivityIcon, matchExact: true },
    { label: 'Workloads', to: '/dashboard/provider/workloads', icon: Wrench, matchExact: true },
    { label: 'Provider Analytics', to: '/dashboard/provider/analytics', icon: BarChart3, matchExact: true },
    { label: 'Earnings & Payouts', to: '/dashboard/provider/earnings', icon: Wallet, matchExact: true },
    { label: 'Integrations', to: '/dashboard/provider/integrations', icon: Settings, matchExact: true },
    { label: 'Provider Profile', to: '/dashboard/provider/profile', icon: User, matchExact: true },
  ]

  const isItemActive = (item: NavItem) => {
    if (item.to === '/dashboard/users') {
      return location.pathname === '/dashboard/users' || location.pathname === '/dashboard/users/add'
    }
    if (item.to === '/dashboard/provider') {
      return location.pathname === '/dashboard/provider' || location.pathname === '/dashboard/provider/onboarding'
    }
    return location.pathname === item.to
  }

  const handleBack = () => {
    if (onBackClick) {
      onBackClick()
    } else if (backButtonTo) {
      navigate(backButtonTo)
    } else {
      if (portalRole === 'admin') navigate('/dashboard')
      else navigate('/dashboard/customer')
    }
  }

  const portalHomeRoute = portalRole === 'admin' ? '/dashboard' : '/dashboard/customer'


  return (
    <div className="dash-shell" data-theme={dashTheme}>
      <Ambient />
      {/* ── Top Navigation Bar ──────────────────────────────── */}
      <header className="dash-topbar">
        <div className="dash-topbar__left">
          <Link to={portalHomeRoute} className="row" style={{ gap: 10, alignItems: 'center' }}>
            <LogoMark size={28} theme={dashTheme} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--ink)' }}>
              Infer<span style={{ color: 'var(--brand-hi)' }}>xe</span>
            </span>
          </Link>

          <span className="dash-topbar__divider" aria-hidden />

          {/* Active Portal Badge */}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.66rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 4,
              background: portalRole === 'admin'
                ? (dashTheme === 'light' ? 'rgba(118, 185, 0, 0.12)' : 'rgba(118, 185, 0, 0.15)')
                : (dashTheme === 'light' ? 'rgba(14, 116, 144, 0.12)' : 'rgba(6, 182, 212, 0.15)'),
              color: portalRole === 'admin'
                ? (dashTheme === 'light' ? '#65a300' : '#a3e635')
                : (dashTheme === 'light' ? '#0e7490' : '#06b6d4'),
              border: `1px solid ${portalRole === 'admin'
                ? (dashTheme === 'light' ? 'rgba(118, 185, 0, 0.35)' : 'rgba(118, 185, 0, 0.3)')
                : (dashTheme === 'light' ? 'rgba(14, 116, 144, 0.35)' : 'rgba(6, 182, 212, 0.3)')
                }`,
              marginLeft: 4,
              fontWeight: dashTheme === 'light' ? 700 : 500,
            }}
          >
            {portalRole === 'admin' ? 'Admin Portal' : 'Customer Portal'}
          </span>

        </div>

        {/* Center: Cluster status & Free Trial Countdown Telemetry */}
        <div className="dash-topbar__center">

          {/* 1-Hour Free Trial Countdown Widget (Only for Customer Portal) */}
          {portalRole === 'customer' && (
            trialTimeLeft !== null ? (
              trialTimeLeft > 0 ? (
                <div
                  className={`mw-trial-chip ${trialTimeLeft < 600000 ? 'mw-trial-chip--warning' : ''}`}
                  onClick={() => navigate('/dashboard/customer')}
                  title="1-Hour Free Trial active (Demo)"
                >
                  <span className="dash-pulse-dot" style={{ background: trialTimeLeft < 600000 ? '#f59e0b' : '#76b900' }} />
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
            )
          )}
        </div>

        {/* Right: Notifications & Admin Profile Section */}
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
                  color: dashTheme === 'light' ? '#FBBF24' : '#6366F1',
                }}
                animate={{
                  rotate: 0,
                  scale: 1,
                  opacity: 1,
                  color: dashTheme === 'light' ? '#6366F1' : '#FBBF24',
                }}
                exit={{
                  rotate: dashTheme === 'light' ? -90 : 90,
                  scale: 0.25,
                  opacity: 0,
                  color: dashTheme === 'light' ? '#6366F1' : '#FBBF24',
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
          {/* Notifications */}
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

          {/* User Profile & Demo Role Switcher */}
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
                        background: portalRole === 'admin' ? 'rgba(118, 185, 0, 0.18)' : 'rgba(6, 182, 212, 0.18)',
                        color: portalRole === 'admin' ? 'var(--brand-hi)' : '#06b6d4',
                        borderColor: portalRole === 'admin' ? 'var(--brand)' : '#06b6d4',
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
                    onClick={() => {
                      setAdminMenuOpen(false)
                      clearSession()
                      navigate('/')
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
        {/* Mobile backdrop overlay */}
        {mobileMenuOpen && (
          <div
            className="dash-sidebar-overlay"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Sidebar: pill / rail style matching reference video */}
        <aside
          className={`dash-sidebar ${
            isMobile
              ? (mobileMenuOpen ? 'is-open' : '')
              : (isSidebarCollapsed ? 'is-collapsed' : '')
          }`}
          aria-label="Dashboard Sidebar"
        >
          <div>
            {/* Top header row with toggle button (matching video) */}
            <div className="dash-sidebar__top">
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

            {/* ── 1. CUSTOMER PORTAL NAVIGATION (Customer Features Only) ── */}
            {portalRole === 'customer' && (
              <div>
                <button
                  type="button"
                  className="dash-nav-section-title dash-nav-section-btn"
                  onClick={() => setCustomerSectionOpen(!customerSectionOpen)}
                  aria-expanded={customerSectionOpen}
                >
                  <span>Customer Portal</span>
                  <ChevronDown
                    size={13}
                    style={{
                      transition: 'transform 0.24s cubic-bezier(0.25, 1, 0.5, 1)',
                      transform: customerSectionOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {customerSectionOpen && (
                    <motion.nav
                      className="dash-nav-list"
                      aria-label="Customer Navigation"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {customerNavItems.map((item) => {
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
                            {item.badge && <span className="dash-nav-badge">{item.badge}</span>}
                          </Link>
                        )
                      })}
                    </motion.nav>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ── 2. ADMIN PORTAL NAVIGATION (Administration & Provider Management) ── */}
            {portalRole === 'admin' && (
              <div>
                {/* Section A: Administration */}
                <button
                  type="button"
                  className="dash-nav-section-title dash-nav-section-btn"
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
                      className="dash-nav-list"
                      aria-label="Administration Navigation"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
                      style={{ overflow: 'hidden' }}
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
                            {item.badge && <span className="dash-nav-badge">{item.badge}</span>}
                          </Link>
                        )
                      })}
                    </motion.nav>
                  )}
                </AnimatePresence>

                {/* Section B: Provider Management (Moved into Admin Portal) */}
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
                      className="dash-nav-list"
                      aria-label="Provider Management Navigation"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
                      style={{ overflow: 'hidden' }}
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
                            {item.badge && <span className="dash-nav-badge">{item.badge}</span>}
                          </Link>
                        )
                      })}
                    </motion.nav>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Quota & Organization Footer */}
          <div className="dash-sidebar__footer">
            {portalRole === 'customer' ? (
              <div
                className="dash-quota-card"
                title={`Monthly Spend Limit: ₹${monthlyBudget.toLocaleString('en-IN')} (${budgetUsedPct}% used)`}
              >
                <div className="dash-quota-card__header">
                  <span className="dash-quota-card__label">Monthly Spend Limit</span>
                  <span className="dash-quota-card__val">₹{monthlyBudget.toLocaleString('en-IN')}</span>
                </div>
                <div className="dash-quota-progress">
                  <div className="dash-quota-bar" style={{ width: `${budgetUsedPct}%` }} />
                </div>
                <div className="dash-quota-card__sub">
                  NovaTech AI Systems · Sovereign Active Tier
                </div>
              </div>
            ) : (
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
            )}

            <Link
              to="/"
              className="dash-sidebar__public-link"
              title="Back to Public Website"
              onClick={() => {
                setHoveredFlyout(null)
                setMobileMenuOpen(false)
              }}
              onMouseEnter={(e) => {
                if (isSidebarCollapsed && !isMobile) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoveredFlyout({
                    label: 'Back to Public Website',
                    top: rect.top + rect.height / 2,
                    left: rect.right + 12,
                  })
                }
              }}
              onMouseLeave={() => setHoveredFlyout(null)}
            >
              <ExternalLink size={13} />
              <span>Back to Public Website</span>
            </Link>
          </div>
        </aside>

        {/* Floating flyout tooltip in collapsed rail mode (matching video) */}
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

        {/* Main Content Area */}
        <main className="dash-main">
          {/* Breadcrumb */}
          {breadcrumb && breadcrumb.length > 0 && (
            <nav className="dash-breadcrumb" aria-label="Breadcrumb">
              {breadcrumb.map((bc, idx) => (
                <span key={bc.label} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  {idx > 0 && <span className="dash-breadcrumb__sep">/</span>}
                  {bc.to ? (
                    <Link to={bc.to}>{bc.label}</Link>
                  ) : (
                    <span className="dash-breadcrumb__current">{bc.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Header Row */}
          {!hideHeader && (heading || backButtonLabel) && (
            <div className="dash-header-row">
              <div>
                <h1 className="dash-header-title">{heading}</h1>
                {description && <p className="dash-header-desc">{description}</p>}
              </div>

              {backButtonLabel && (
                <button type="button" className="dash-back-btn" onClick={handleBack} aria-label={backButtonLabel}>
                  <ChevronLeft />
                  <span>{backButtonLabel}</span>
                </button>
              )}
            </div>
          )}

          {children}
        </main>
      </div>
    </div>
  )
}
