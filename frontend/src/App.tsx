import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Footer } from './components/layout/Footer'
import { Navbar } from './components/layout/Navbar'
import { Ambient, ScrollProgress } from './components/layout/Ambient'
import { CommandPalette } from './components/layout/CommandPalette'
import { GlobalBotCompanion } from './components/bot/GlobalBotCompanion'

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

// Dashboard pages
const AddUser = lazy(() => import('./pages/dashboard/AddUser'))
const UsersList = lazy(() => import('./pages/dashboard/UsersList'))
const DashboardOverview = lazy(() => import('./pages/dashboard/DashboardOverview'))
const MarketplaceWorkspace = lazy(() => import('./pages/dashboard/MarketplaceWorkspace'))
const Login = lazy(() => import('./pages/Login'))
import { AdminGuard } from './components/auth/AdminGuard'
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
            <Route
              path="/dashboard"
              element={
                <AdminGuard>
                  <DashboardOverview />
                </AdminGuard>
              }
            />
            <Route
              path="/dashboard/users"
              element={
                <AdminGuard>
                  <UsersList />
                </AdminGuard>
              }
            />
            <Route
              path="/dashboard/users/add"
              element={
                <AdminGuard>
                  <AddUser />
                </AdminGuard>
              }
            />
            <Route
              path="/dashboard/users/map"
              element={
                <AdminGuard>
                  <MarketplaceWorkspace />
                </AdminGuard>
              }
            />
            <Route
              path="/dashboard/provider"
              element={
                <AdminGuard>
                  <MarketplaceWorkspace />
                </AdminGuard>
              }
            />
            <Route
              path="/dashboard/provider/*"
              element={
                <AdminGuard>
                  <MarketplaceWorkspace />
                </AdminGuard>
              }
            />
            <Route
              path="/dashboard/*"
              element={
                <CustomerGuard>
                  <MarketplaceWorkspace />
                </CustomerGuard>
              }
            />
          </Routes>
        </Suspense>
        <GlobalBotCompanion />
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
        <GlobalBotCompanion />
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
      <GlobalBotCompanion />
    </MotionConfig>
  )
}
