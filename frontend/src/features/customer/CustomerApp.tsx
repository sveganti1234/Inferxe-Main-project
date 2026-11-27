/**
 * Inferxe Console — native customer dashboard (preview at /dashboard/app/*).
 *
 * Mounted by App.tsx inside <CustomerGuard>, so every route here requires an authenticated
 * customer session. All data is loaded through the authenticated data layer; nothing is
 * stored in localStorage except UI preferences.
 */
import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Compass } from 'lucide-react'
import './styles/customer.css'
import { WorkspaceProvider } from './data/WorkspaceContext'
import { CONSOLE_BASE, CONSOLE_SECTIONS } from './navigation'
import { CustomerShell } from './shell/CustomerShell'
// Overview is the landing page, so it stays in the console chunk; the rest load on demand
// (CustomerShell renders them inside a Suspense boundary).
import OverviewPage from './pages/OverviewPage'
const ApiKeysPage = lazy(() => import('./pages/ApiKeysPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const UsagePage = lazy(() => import('./pages/UsagePage'))
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'))
const ModelsPage = lazy(() => import('./pages/ModelsPage'))
const GpusPage = lazy(() => import('./pages/GpusPage'))
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage'))
const DeploymentsPage = lazy(() => import('./pages/DeploymentsPage'))
const WishlistPage = lazy(() => import('./pages/WishlistPage'))
const SshKeysPage = lazy(() => import('./pages/SshKeysPage'))
const OrdersPage = lazy(() => import('./pages/OrdersPage'))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))
const RewardsPage = lazy(() => import('./pages/RewardsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const SectionPreview = lazy(() => import('./pages/SectionPreview'))
import type { SectionId } from './navigation'
import type { ReactElement } from 'react'

/** Sections implemented natively so far; the rest show an honest in-progress preview. */
const IMPLEMENTED: Partial<Record<SectionId, () => ReactElement>> = {
  'api-keys': () => <ApiKeysPage />,
  notifications: () => <NotificationsPage />,
  settings: () => <SettingsPage />,
  billing: () => <BillingPage />,
  usage: () => <UsagePage />,
  developer: () => <DeveloperPage />,
  models: () => <ModelsPage />,
  gpus: () => <GpusPage />,
  playground: () => <PlaygroundPage />,
  deployments: () => <DeploymentsPage />,
  wishlist: () => <WishlistPage />,
  'ssh-keys': () => <SshKeysPage />,
  orders: () => <OrdersPage />,
  checkout: () => <CheckoutPage />,
  rewards: () => <RewardsPage />,
  profile: () => <ProfilePage />,
  help: () => <HelpPage />,
}
import { ButtonLink, Card } from './ui/primitives'
import { EmptyState } from './ui/states'

function ConsoleNotFound() {
  return (
    <Card>
      <EmptyState
        icon={<Compass size={24} />}
        title="Page not found"
        body="This page doesn't exist in the Inferxe console."
        actions={<ButtonLink to={CONSOLE_BASE} variant="primary">Go to console</ButtonLink>}
      />
    </Card>
  )
}

export default function CustomerApp() {
  return (
    <WorkspaceProvider>
      <Routes>
        <Route element={<CustomerShell />}>
          <Route index element={<OverviewPage />} />
          {CONSOLE_SECTIONS.filter((s) => s.path !== '').map((section) => {
            const Page = IMPLEMENTED[section.id]
            return <Route key={section.id} path={section.path} element={Page ? <Page /> : <SectionPreview id={section.id} />} />
          })}
          <Route path="faq" element={<HelpPage />} />
          <Route path="chatbot" element={<HelpPage />} />
          <Route path="workspace" element={<SettingsPage />} />
          <Route path="quotas" element={<SettingsPage />} />
          <Route path="*" element={<ConsoleNotFound />} />
        </Route>
      </Routes>
    </WorkspaceProvider>
  )
}
