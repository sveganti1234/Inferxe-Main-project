import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Footer } from './components/layout/Footer'
import { Navbar } from './components/layout/Navbar'
import { Ambient, ScrollProgress } from './components/layout/Ambient'
import { CommandPalette } from './components/layout/CommandPalette'
// Loaded after first paint: the assistant (and its avatar library) is not needed to render a page.
const GlobalBotCompanion = lazy(() =>
  import('./components/bot/GlobalBotCompanion').then((m) => ({ default: m.GlobalBotCompanion })),
)

const Home = lazy(() => import('./pages/Home'))
const Platform = lazy(() => import('./pages/Platform'))
const HowItWorks = lazy(() => import('./pages/HowItWorks'))
const Gpus = lazy(() => import('./pages/Gpus'))
const Solutions = lazy(() => import('./pages/Solutions'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Security = lazy(() => import('./pages/Security'))
const Company = lazy(() => import('./pages/Company'))
const Contact = lazy(() => import('./pages/Contact'))
const Legal = lazy(() => import('./pages/Legal'))
const Developers = lazy(() => import('./pages/Developers'))
const Roadmap = lazy(() => import('./pages/Roadmap'))
const NotFound = lazy(() => import('./pages/NotFound'))

// Dashboard pages — statically imported for instantaneous 0ms tab switching without suspension or skeleton flicker
import AddUser from './pages/dashboard/AddUser'
import UsersList from './pages/dashboard/UsersList'
import DashboardOverview from './pages/dashboard/DashboardOverview'
import MarketplaceWorkspace from './pages/dashboard/MarketplaceWorkspace'
import CustomerManagement from './pages/dashboard/CustomerManagement'
import AdminKeyMonitoring from './pages/dashboard/AdminKeyMonitoring'
import AdminNotificationsPage from './pages/dashboard/AdminNotificationsPage'
const CustomerVerdeloWorkspace = lazy(() => import('./components/dashboard/CustomerVerdeloWorkspace'))
const CustomerApp = lazy(() => import('./features/customer/CustomerApp'))
const CustomerEntryRedirect = lazy(() => import('./features/customer/CustomerEntryRedirect'))
const LegacyWorkspaceRedirect = lazy(() => import('./features/customer/LegacyWorkspaceRedirect'))
import SuperadminOverview from './pages/dashboard/superadmin/SuperadminOverview'
import AdminManagement from './pages/dashboard/superadmin/AdminManagement'
import AuditLogs from './pages/dashboard/superadmin/AuditLogs'
import InfrastructureTelemetry from './pages/dashboard/superadmin/InfrastructureTelemetry'
import KeyManagement from './pages/dashboard/superadmin/KeyManagement'
import SuperAdminOverview from './pages/dashboard/SuperAdminOverview'
import AdminAccounts from './pages/dashboard/AdminAccounts'
import AdminRoles from './pages/dashboard/AdminRoles'
import AdminPermissions from './pages/dashboard/AdminPermissions'
import AdminActivity from './pages/dashboard/AdminActivity'
import AdminAudit from './pages/dashboard/AdminAudit'
import SuperAdminFutureModule from './pages/dashboard/SuperAdminFutureModule'
import { CustomerHeartbeat } from './components/dashboard/CustomerHeartbeat'
// Admin-only chrome: kept out of the public entry bundle (rendered inside the route Suspense boundary).
const AdminShell = lazy(() => import('./components/dashboard/AdminShell').then((m) => ({ default: m.AdminShell })))
const Login = lazy(() => import('./pages/Login'))
import { AdminGuard } from './components/auth/AdminGuard'
import { SuperadminGuard } from './components/auth/SuperadminGuard'
import { CustomerGuard } from './components/auth/CustomerGuard'

/** Scroll to top on route change, or to the #hash target when present. */
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1))
      let tries = 0
      const tick = () => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        else if (tries++ < 20) window.setTimeout(tick, 80)
      }
      window.setTimeout(tick, 380)
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [pathname, hash])
  return null
}

function PageFallback() {
  return (
    <div className="page-loading" aria-label="Loading">
      <span className="page-loading__spinner" />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const isDashboard = location.pathname.startsWith('/dashboard')
  const isAuth = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password'

  if (isDashboard) {
    return (
      <MotionConfig reducedMotion="user">
        <ScrollManager />
        <CommandPalette />
        <Suspense fallback={<PageFallback />}>
          <Routes location={location}>
            {/* ── Admin & Super Admin Portal Routes (Integrated inside persistent AdminShell) ── */}
            <Route
              element={
                <AdminGuard>
                  <AdminShell />
                </AdminGuard>
              }
            >
              {/* Super Admin Governance Modules (Strictly protected by SuperadminGuard inside persistent AdminShell) */}
              <Route element={<SuperadminGuard />}>
                <Route path="/dashboard/super-admin" element={<SuperAdminOverview />} />
                <Route path="/dashboard/super-admin/accounts" element={<AdminAccounts />} />
                <Route path="/dashboard/super-admin/roles" element={<AdminRoles />} />
                <Route path="/dashboard/super-admin/permissions" element={<AdminPermissions />} />
                <Route path="/dashboard/super-admin/activity" element={<AdminActivity />} />
                <Route path="/dashboard/super-admin/audit" element={<AdminAudit />} />
                <Route path="/dashboard/super-admin/:module" element={<SuperAdminFutureModule />} />
              </Route>

              {/* Superadmin direct routes (Protected by SuperadminGuard inside persistent AdminShell) */}
              <Route
                path="/dashboard/superadmin"
                element={
                  <SuperadminGuard>
                    <SuperadminOverview />
                  </SuperadminGuard>
                }
              />
              <Route
                path="/dashboard/superadmin/admins"
                element={
                  <SuperadminGuard>
                    <AdminManagement />
                  </SuperadminGuard>
                }
              />
              <Route
                path="/dashboard/superadmin/audit-logs"
                element={
                  <SuperadminGuard>
                    <AuditLogs />
                  </SuperadminGuard>
                }
              />
              <Route
                path="/dashboard/superadmin/telemetry"
                element={
                  <SuperadminGuard>
                    <InfrastructureTelemetry />
                  </SuperadminGuard>
                }
              />
              <Route
                path="/dashboard/superadmin/keys"
                element={
                  <SuperadminGuard>
                    <KeyManagement />
                  </SuperadminGuard>
                }
              />

              <Route path="/dashboard" element={<DashboardOverview />} />
              <Route path="/dashboard/notifications" element={<AdminNotificationsPage />} />
              <Route path="/dashboard/customers" element={<CustomerManagement />} />
              <Route path="/dashboard/users" element={<UsersList />} />
              <Route path="/dashboard/users/add" element={<AddUser />} />
              <Route path="/dashboard/users/map" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/keys" element={<AdminKeyMonitoring />} />
              <Route path="/dashboard/provider" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/listings" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/capacity" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/workloads" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/analytics" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/earnings" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/integrations" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/profile" element={<MarketplaceWorkspace />} />
              <Route path="/dashboard/provider/*" element={<MarketplaceWorkspace />} />
            </Route>
            <Route
              path="/dashboard/customer"
              element={
                <CustomerGuard>
                  <CustomerEntryRedirect />
                </CustomerGuard>
              }
            />
            <Route
              path="/dashboard/customer/*"
              element={
                <CustomerGuard>
                  <CustomerEntryRedirect />
                </CustomerGuard>
              }
            />
            {/* Explicit, guarded legacy/rollback route: the previous Verdelo iframe dashboard, unchanged. Never a login destination. */}
            <Route
              path="/dashboard/legacy"
              element={
                <CustomerGuard>
                  <CustomerVerdeloWorkspace />
                </CustomerGuard>
              }
            />
            <Route
              path="/dashboard/legacy/*"
              element={
                <CustomerGuard>
                  <CustomerVerdeloWorkspace />
                </CustomerGuard>
              }
            />
            {/* Inferxe Console: the native customer dashboard. */}
            <Route
              path="/dashboard/app/*"
              element={
                <CustomerGuard>
                  <CustomerApp />
                </CustomerGuard>
              }
            />
            {/* Customer catch-all: old /dashboard/<page> workspace pages go to their native console equivalent. */}
            <Route
              path="/dashboard/*"
              element={
                <CustomerGuard>
                  <LegacyWorkspaceRedirect />
                </CustomerGuard>
              }
            />
          </Routes>
        </Suspense>
        <CustomerHeartbeat />
        <Suspense fallback={null}>
          <GlobalBotCompanion />
        </Suspense>
      </MotionConfig>
    )
  }

  if (isAuth) {
    return (
      <MotionConfig reducedMotion="user">
        <ScrollManager />
        <Suspense fallback={<PageFallback />}>
          <Routes location={location}>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Login initialMode="signup" />} />
            <Route path="/forgot-password" element={<Login initialMode="forgot" />} />
          </Routes>
        </Suspense>
        <CustomerHeartbeat />
        <Suspense fallback={null}>
          <GlobalBotCompanion />
        </Suspense>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Ambient />
      <ScrollProgress />
      <Navbar />
      <CommandPalette />
      <ScrollManager />
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          id="main"
          key={location.pathname}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          <Suspense fallback={<PageFallback />}>
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/platform" element={<Platform />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/gpus" element={<Gpus />} />
              <Route path="/solutions" element={<Solutions />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/security" element={<Security />} />
              <Route path="/company" element={<Company />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy" element={<Legal kind="privacy" />} />
              <Route path="/terms" element={<Legal kind="terms" />} />
              <Route path="/developers" element={<Developers />} />
              <Route path="/roadmap" element={<Roadmap />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Login initialMode="signup" />} />
              <Route path="/forgot-password" element={<Login initialMode="forgot" />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </motion.main>
      </AnimatePresence>
      <Footer />
      <CustomerHeartbeat />
        <Suspense fallback={null}>
          <GlobalBotCompanion />
        </Suspense>
    </MotionConfig>
  )
}
