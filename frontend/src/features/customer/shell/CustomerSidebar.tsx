import { useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { ExternalLink, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LogoMark } from '../../../components/Logo'
import { CONSOLE_SECTIONS, NAV_GROUPS, getSection, sectionHref } from '../navigation'
import type { ConsoleSignals } from './useConsoleSignals'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { fetchWorkspaceBudget } from '../data/serviceClients'
import { useAsyncResource } from '../data/useAsyncResource'
import { formatCurrency, selectLedger, selectMonthSpend, selectPlan } from '../data/selectors'

const ACTIVE_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const
const HOVER_SPRING = { type: 'spring', stiffness: 500, damping: 40, opacity: { duration: 0.12 } } as const

/**
 * Monthly spend limit: the budget the customer saved (8002 /api/workspace/settings) against this
 * month's completed wallet debits. Budgets and debits are INR. No budget → "No spending limit set".
 */
function SpendLimitCard({ organizationName }: { organizationName: string | null }) {
  const { workspace } = useCustomerWorkspace()
  const budget = useAsyncResource(fetchWorkspaceBudget, { cacheKey: 'workspace-budget' })
  const spent = workspace ? selectMonthSpend(selectLedger(workspace), 'INR') : null
  const tier = workspace ? selectPlan(workspace).tier : null
  const sub = [organizationName, tier].filter(Boolean).join(' · ')
  const budgetData = budget.state.status !== 'error' ? budget.state.data : null
  const limit = budgetData ? budgetData.monthlyBudget : null
  const pct = limit && spent !== null ? Math.min(100, Math.round((spent / limit) * 100)) : null
  const head =
    budget.state.status === 'error' ? 'Unavailable' : !budgetData ? '…' : limit === null ? 'No spending limit set' : formatCurrency(limit, 'INR')
  return (
    <div className="cx-quota">
      <div className="cx-quota__head">
        <span>Monthly spend limit</span>
        <strong className={limit === null ? 'cx-quota__none' : undefined}>{head}</strong>
      </div>
      {pct !== null ? <div className="cx-quota__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div> : null}
      <div className="cx-quota__meta">
        <span>{spent === null ? '—' : `${formatCurrency(spent, 'INR')} spent this month`}</span>
        {pct !== null ? <span>{pct}% used</span> : null}
      </div>
      {sub ? <div className="cx-quota__sub">{sub}</div> : null}
    </div>
  )
}

export function CustomerSidebar({
  organizationName,
  account,
  signals,
  rail,
  onToggleRail,
  open,
  mobile,
  onClose,
  onNavigate,
  closeButtonRef,
}: {
  /** Shown in the spend-limit card (the organization is also on the Settings page). */
  organizationName: string | null
  account: { name: string; email: string | null; initials: string } | null
  signals: ConsoleSignals
  rail: boolean
  onToggleRail: () => void
  open: boolean
  /** True in the ≤1023px layout, where the sidebar is an off-canvas drawer. */
  mobile: boolean
  onClose: () => void
  onNavigate: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  // Off-canvas and closed: remove from the tab order and the accessibility tree.
  const hidden = mobile && !open
  const inference =
    signals.inferenceAvailable === true
      ? { dot: 'cx-dot--live is-pulsing', text: 'Inference API online' }
      : signals.inferenceAvailable === false
        ? { dot: 'cx-dot--warn', text: 'Inference API unavailable' }
        : signals.inferenceChecked
          ? { dot: '', text: 'Inference status unknown' }
          : { dot: '', text: 'Checking inference API…' }

  return (
    <aside
      id="cx-sidebar"
      className={`cx-sidebar${open ? ' is-open' : ''}`}
      aria-label="Console navigation"
      inert={hidden || undefined}
      role={mobile && open ? 'dialog' : undefined}
      aria-modal={mobile && open ? true : undefined}
    >
      <div className="cx-brand">
        <LogoMark size={30} theme="dark" />
        <span className="cx-brand__name">
          Infer<em>xe</em>
        </span>
        <button ref={closeButtonRef} type="button" className="cx-iconbtn cx-drawer-close" onClick={onClose} aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <nav className="cx-nav" onMouseLeave={() => setHovered(null)}>
        {NAV_GROUPS.map((group) => (
          <div className="cx-nav__group" key={group}>
            <div className="cx-nav__label">{group}</div>
            {CONSOLE_SECTIONS.filter((s) => s.group === group).map((section) => {
              const Icon = section.icon
              return (
                <NavLink
                  key={section.id}
                  to={sectionHref(section)}
                  end={section.path === ''}
                  className="cx-nav__item"
                  title={rail ? section.label : undefined}
                  onClick={onNavigate}
                  onMouseEnter={() => setHovered(section.id)}
                >
                  {({ isActive }) => (
                    <>
                      {/* One shared pill per kind: it slides between items instead of jumping. */}
                      {isActive ? <motion.span layoutId="cx-nav-active" className="cx-nav__pill" transition={ACTIVE_SPRING} aria-hidden="true" /> : null}
                      <AnimatePresence>
                      {hovered === section.id && !isActive ? (
                        <motion.span
                          layoutId="cx-nav-hover"
                          className="cx-nav__hoverpill"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={HOVER_SPRING}
                          aria-hidden="true"
                        />
                      ) : null}
                      </AnimatePresence>
                      <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                      <span className="cx-nav__text">{section.label}</span>
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="cx-sidebar__footer">
        <SpendLimitCard organizationName={organizationName} />
        <div className="cx-service" role="status" title={inference.text}>
          <span className={`cx-dot ${inference.dot}`} aria-hidden="true" />
          <span className="cx-service__text">{inference.text}</span>
        </div>
        <div className="cx-sidefoot">
          {account ? (
            <Link to={sectionHref(getSection('settings'))} className="cx-sideaccount" title="Account settings" onClick={onNavigate}>
              <span className="cx-avatar" aria-hidden="true">{account.initials}</span>
              <span className="cx-sideaccount__text">
                <strong>{account.name}</strong>
                {account.email ? <small>{account.email}</small> : null}
              </span>
            </Link>
          ) : <span className="cx-sidefoot__spacer" />}
          <button
            type="button"
            className="cx-collapse"
            onClick={onToggleRail}
            aria-pressed={rail}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {rail ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span className="cx-collapse__text">Collapse sidebar</span>
          </button>
        </div>
        <Link to="/" className="cx-backlink" title="Back to Public Website">
          <ExternalLink size={15} aria-hidden="true" />
          <span className="cx-backlink__text">Back to Public Website</span>
        </Link>
      </div>
    </aside>
  )
}
