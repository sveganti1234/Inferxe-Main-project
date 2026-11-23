/**
 * Inferxe Console — native customer dashboard (preview at /dashboard/app/*).
 *
 * Mounted by App.tsx inside <CustomerGuard>, so every route here requires an authenticated
 * customer session. All data is loaded through the authenticated data layer; nothing is
 * stored in localStorage except UI preferences.
 */
import { Route, Routes } from 'react-router-dom'
import { Compass } from 'lucide-react'
import './styles/customer.css'
import { WorkspaceProvider } from './data/WorkspaceContext'
import { CONSOLE_BASE, CONSOLE_SECTIONS } from './navigation'
import { CustomerShell } from './shell/CustomerShell'
import OverviewPage from './pages/OverviewPage'
import ApiKeysPage from './pages/ApiKeysPage'
import NotificationsPage from './pages/NotificationsPage'
import SettingsPage from './pages/SettingsPage'
import BillingPage from './pages/BillingPage'
import UsagePage from './pages/UsagePage'
import DeveloperPage from './pages/DeveloperPage'
import ModelsPage from './pages/ModelsPage'
import GpusPage from './pages/GpusPage'
import PlaygroundPage from './pages/PlaygroundPage'
import DeploymentsPage from './pages/DeploymentsPage'
import WishlistPage from './pages/WishlistPage'
import SshKeysPage from './pages/SshKeysPage'
import OrdersPage from './pages/OrdersPage'
import CheckoutPage from './pages/CheckoutPage'
import RewardsPage from './pages/RewardsPage'
import ProfilePage from './pages/ProfilePage'
import HelpPage from './pages/HelpPage'
import SectionPreview from './pages/SectionPreview'
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
          <Route path="*" element={<ConsoleNotFound />} />
        </Route>
      </Routes>
    </WorkspaceProvider>
  )
}
