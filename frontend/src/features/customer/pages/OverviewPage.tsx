/**
 * Overview — the original customer-portal dashboard layout, filled ONLY from real sources:
 *  - name:                 profiles.full_name (GET /api/customer/workspace)
 *  - wallet balance:       8002 GET /api/wallet/balance
 *  - month spend:          completed wallet debits (workspace wallet_transactions)
 *  - GPUs & models:        Supabase deployments (workspace)
 *  - alerts / announcement: notifications (workspace); dismissing marks the notification read
 *  - orders:               orders (workspace)
 * Burn and hours-left use deployment rates recorded with a currency (deployments.currency); the
 * trial and tier come from customer_plans. Missing data shows an honest "not available" state.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Calculator, CircleDollarSign, Cpu, KeyRound, Plus, RefreshCw, Rocket, Server, ShoppingBag, Sparkles, Terminal, Wallet, X, Zap } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { announceNotificationsChanged, fetchWalletBalance, markNotificationRead } from '../data/serviceClients'
import { useAsyncResource } from '../data/useAsyncResource'
import { selectBurn, selectDeployments } from '../data/marketplace'
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatRelativeTime,
  humaniseCode,
  selectLedger,
  selectMonthSpend,
  selectPlan,
  selectProfileSummary,
  toFiniteNumber,
} from '../data/selectors'
import { getSection, sectionHref } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { Button, ButtonLink, Card, CardHeader, Stat, StatusPill, type PillTone } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/states'

function statusTone(status: string | null): PillTone {
  const s = (status ?? '').toLowerCase()
  if (s === 'running' || s === 'completed' || s === 'active') return 'success'
  if (s === 'provisioning' || s === 'pending' || s === 'starting') return 'warning'
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'danger'
  return 'neutral'
}

/** Broadcast notices (maintenance, platform announcements) feed the announcement strip. */
const isAnnouncement = (type: string | null | undefined) => /ANNOUNCEMENT|MAINTENANCE/i.test(type ?? '')

/** Wallet low-balance levels the wallet service reports (anything but NORMAL). */
const isLowWallet = (level: string | null) => !!level && level.toUpperCase() !== 'NORMAL'

const QUICK_ACTIONS = [
  { id: 'gpus', icon: <Cpu size={18} />, label: 'GPU marketplace', hint: 'Browse listed capacity' },
  { id: 'models', icon: <Calculator size={18} />, label: 'Compare GPUs', hint: 'Weights, KV cache and fit' },
  { id: 'api-keys', icon: <KeyRound size={18} />, label: 'API keys', hint: 'Authenticate your requests' },
  { id: 'billing', icon: <Wallet size={18} />, label: 'Billing & wallet', hint: 'Balance and transactions' },
] as const

export default function OverviewPage() {
  usePageMeta('Overview', 'Your Inferxe account, GPUs, spend and alerts.')
  const { state, workspace, refresh } = useCustomerWorkspace()
  const wallet = useAsyncResource(fetchWalletBalance, { cacheKey: 'wallet' })
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  const profile = workspace ? selectProfileSummary(workspace) : null
  const firstName = profile?.displayName.split(/\s+/)[0]

  if (state.status === 'error' && !workspace) {
    return (
      <>
        <header className="cx-hero">
          <div className="cx-hero__text">
            <h1 className="cx-hero__title">Overview</h1>
          </div>
        </header>
        <Card>
          <ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="your workspace" />
        </Card>
      </>
    )
  }

  // Cached balance stays visible while refreshing; after a failed refresh it is not shown as current.
  const walletData = wallet.state.status !== 'error' ? wallet.state.data : null
  const deployments = workspace ? selectDeployments(workspace) : []
  const running = deployments.filter((d) => (d.recordedStatus ?? '').toLowerCase() === 'running')
  const ledger = workspace ? selectLedger(workspace) : []
  // Currency must be known (wallet or a recorded transaction); otherwise spend is unknown, not ₹0.
  const currency = walletData?.currency ?? ledger.find((e) => e.currency)?.currency ?? null
  const monthSpend = workspace && currency ? selectMonthSpend(ledger, currency) : null
  const notifications = workspace
    ? [...workspace.notifications].sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0))
    : []
  const unread = notifications.filter((n) => n.is_read !== true)
  const announcement = unread.find((n) => isAnnouncement(n.notification_type) && n.id !== dismissedId) ?? null
  const orders = workspace
    ? [...workspace.orders].sort((a, b) => (Date.parse(b.order_date ?? b.created_at ?? '') || 0) - (Date.parse(a.order_date ?? a.created_at ?? '') || 0)).slice(0, 4)
    : []
  const lowWallet = walletData ? isLowWallet(walletData.lowBalanceAlertLevel) : false
  // Burn uses only rates recorded in the wallet's currency; hours-left needs both.
  const burn = currency ? selectBurn(deployments, currency) : { perHour: null, unpriced: running.length }
  const hoursLeft = walletData && burn.perHour ? walletData.balance / burn.perHour : null
  const plan = workspace ? selectPlan(workspace) : null
  const walletHint =
    wallet.state.status === 'error'
      ? 'Wallet service unavailable'
      : !walletData
        ? 'Loading…'
        : hoursLeft !== null
          ? `≈ ${hoursLeft.toFixed(1)} hrs left at current usage`
          : running.length === 0
            ? 'Nothing billing right now'
            : 'Hourly usage not reported yet'
  const burnHint =
    deployments.length === 0
      ? 'Nothing deployed yet'
      : burn.perHour !== null && currency
        ? `${formatCurrency(burn.perHour, currency)}/hr current burn${burn.unpriced ? ` · ${burn.unpriced} without a rate` : ''}`
        : running.length === 0
          ? 'No GPUs running'
          : 'Hourly cost not reported yet'

  const dismissAnnouncement = async (id: string) => {
    setDismissedId(id)
    try {
      await markNotificationRead(id)
      announceNotificationsChanged()
      refresh()
    } catch {
      // Hidden for this visit; it stays unread on the server and reappears next time.
    }
  }

  return (
    <>
      {/* ── Greeting + primary actions ── */}
      <header className="cx-hero">
        <div className="cx-hero__text">
          <h1 className="cx-hero__title">{firstName ? `Hello, ${firstName}` : 'Overview'}</h1>
          <p className="cx-hero__sub">
            {!workspace
              ? 'Loading your workspace…'
              : running.length > 0
                ? `${formatInteger(running.length)} GPU${running.length === 1 ? '' : 's'} running${burn.perHour !== null && currency ? ` · ${formatCurrency(burn.perHour, currency)}/hr` : ''}`
                : 'No GPUs running right now. Deploy one to get started.'}
          </p>
        </div>
        <div className="cx-hero__actions">
          <Button variant="secondary" onClick={() => { refresh(); wallet.refresh() }} disabled={state.status === 'loading'} aria-label="Refresh overview">
            <RefreshCw size={15} />
          </Button>
          <ButtonLink to={sectionHref(getSection('playground'))} variant="secondary"><Terminal size={15} /> Playground</ButtonLink>
          <ButtonLink to={sectionHref(getSection('deployments'))} variant="primary"><Plus size={15} /> Deploy a GPU</ButtonLink>
        </div>
      </header>

      {/* ── Announcement strip: newest unread platform notice, if any ── */}
      {announcement && (
        <div className="cx-announce" role="status">
          <Zap size={15} aria-hidden="true" />
          <span><strong>{announcement.title?.trim() || 'Notice'}</strong>{announcement.detail ? ` ${announcement.detail}` : ''}</span>
          <Link to={sectionHref(getSection('notifications'))} className="cx-announce__link">View</Link>
          <button type="button" className="cx-announce__close" aria-label="Dismiss announcement" onClick={() => void dismissAnnouncement(announcement.id)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="cx-grid cx-grid--4 cx-section">
        <Card className="cx-panel">
          <Stat
            icon={<Wallet size={15} />}
            label="Wallet balance"
            value={walletData ? formatCurrency(walletData.balance, walletData.currency) : null}
            hint={walletHint}
          />
          <Link className="cx-kpi__link" to={`${sectionHref(getSection('billing'))}?add=money`}>Add money · History <ArrowRight size={13} /></Link>
        </Card>
        <Card className="cx-panel">
          {workspace ? (
            <Stat
              icon={<Server size={15} />}
              label="Running GPUs"
              value={<>{formatInteger(running.length)} <span className="cx-of">of {formatInteger(deployments.length)}</span></>}
              hint={burnHint}
            />
          ) : (
            <Skeleton height={64} />
          )}
          <Link className="cx-kpi__link" to={sectionHref(getSection('deployments'))}>Deployments <ArrowRight size={13} /></Link>
        </Card>
        <Card className="cx-panel">
          <Stat
            icon={<CircleDollarSign size={15} />}
            label="Spend this month"
            value={monthSpend === null || !currency ? null : formatCurrency(monthSpend, currency)}
            hint="Completed wallet charges"
          />
          <Link className="cx-kpi__link" to={sectionHref(getSection('usage'))}>View usage &amp; analytics <ArrowRight size={13} /></Link>
        </Card>
        <Card className="cx-panel">
          {!plan ? (
            <Skeleton height={64} />
          ) : plan.trial === 'active' ? (
            <Stat icon={<Sparkles size={15} />} label="Free trial" value="Active" hint={`Ends ${formatDateTime(plan.trialEndsAt)}`} />
          ) : plan.trial === 'expired' ? (
            <Stat icon={<Sparkles size={15} />} label="Free trial" value="Expired" hint={`Ended ${formatDateTime(plan.trialEndsAt)}`} />
          ) : (
            <Stat icon={<Sparkles size={15} />} label="Free trial" value="Not available" valueSize="sm" hint="No trial on this account" />
          )}
          {plan?.trial === 'expired' ? (
            <Link className="cx-kpi__link" to={sectionHref(getSection('billing'))}>Top up to continue <ArrowRight size={13} /></Link>
          ) : null}
        </Card>
      </div>

      {/* ── GPUs & models | alerts + recent orders ── */}
      <div className="cx-grid cx-ovgrid cx-section">
        <Card className="cx-panel" aria-labelledby="cx-gpus-title">
          <CardHeader
            id="cx-gpus-title"
            title="Your GPUs & models"
            action={<ButtonLink to={sectionHref(getSection('deployments'))} size="sm" variant="ghost">Manage all <ArrowRight size={14} /></ButtonLink>}
          />
          {!workspace ? (
            <LoadingBlock lines={4} label="Loading deployments" />
          ) : deployments.length === 0 ? (
            <EmptyState
              compact
              icon={<Rocket size={24} />}
              title="Nothing deployed yet"
              body="Launch a GPU from Deployments. Your deployments will appear here."
            />
          ) : (
            <ul className="cx-activity">
              {deployments.map((d) => (
                <li key={d.id} className="cx-activity__row">
                  <div className="cx-activity__text">
                    <div className="cx-activity__title">{d.name}</div>
                    <div className="cx-activity__detail">{[d.model, d.gpu, d.region].filter(Boolean).join(' · ') || 'No model, GPU or region recorded'}</div>
                  </div>
                  <div className="cx-activity__side">
                    <StatusPill tone={statusTone(d.recordedStatus)}>{d.recordedStatus ? humaniseCode(d.recordedStatus) : 'No status'}</StatusPill>
                    {d.hourlyRate !== null && d.currency ? <span className="cx-amount">{formatCurrency(d.hourlyRate, d.currency)}/hr</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="cx-stack">
          <Card className="cx-panel" aria-labelledby="cx-alerts-title">
            <CardHeader
              id="cx-alerts-title"
              title={<>Alerts {unread.length > 0 ? <StatusPill tone="success">{formatInteger(unread.length)}</StatusPill> : null}</>}
              action={<ButtonLink to={sectionHref(getSection('notifications'))} size="sm" variant="ghost">All <ArrowRight size={14} /></ButtonLink>}
            />
            {!workspace ? (
              <LoadingBlock lines={3} label="Loading alerts" />
            ) : !lowWallet && unread.length === 0 ? (
              <EmptyState compact title="You are all caught up" body="New notifications for your account appear here." />
            ) : (
              <ul className="cx-activity">
                {lowWallet && walletData ? (
                  <li className="cx-activity__row">
                    <div className="cx-activity__text">
                      <div className="cx-activity__title">Wallet running low</div>
                      <div className="cx-activity__detail">
                        {formatCurrency(walletData.balance, walletData.currency)} left. <Link to={sectionHref(getSection('billing'))}>Top up</Link>
                      </div>
                    </div>
                  </li>
                ) : null}
                {unread.slice(0, 3).map((n) => (
                  <li key={n.id} className="cx-activity__row">
                    <div className="cx-activity__text">
                      <div className="cx-activity__title">{n.title?.trim() || 'Notification'}</div>
                      {n.created_at ? <time className="cx-activity__detail" dateTime={n.created_at}>{formatRelativeTime(n.created_at)}</time> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="cx-panel" aria-labelledby="cx-orders-title">
            <CardHeader
              id="cx-orders-title"
              title="Recent orders"
              action={<ButtonLink to={sectionHref(getSection('billing'))} size="sm" variant="ghost">History <ArrowRight size={14} /></ButtonLink>}
            />
            {!workspace ? (
              <LoadingBlock lines={3} label="Loading orders" />
            ) : orders.length === 0 ? (
              <EmptyState compact icon={<ShoppingBag size={22} />} title="No orders yet" body="GPU and model orders on your account appear here." />
            ) : (
              <ul className="cx-activity">
                {orders.map((o) => {
                  const cost = toFiniteNumber(o.total_cost)
                  return (
                    <li key={o.id} className="cx-activity__row">
                      <div className="cx-activity__text">
                        <div className="cx-activity__title">{o.order_number?.trim() || 'Order'}</div>
                        <div className="cx-activity__detail">{[o.item_name, o.provider_name].filter(Boolean).join(' · ') || 'No item recorded'}</div>
                      </div>
                      <div className="cx-activity__side">
                        {cost !== null && o.currency ? <span className="cx-amount">{formatCurrency(cost, o.currency)}</span> : null}
                        {o.status ? <StatusPill tone={statusTone(o.status)}>{humaniseCode(o.status)}</StatusPill> : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div className="cx-grid cx-grid--4 cx-section">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.id} className="cx-plan" to={sectionHref(getSection(a.id))}>
            <span className="cx-plan__icon" aria-hidden="true">{a.icon}</span>
            <span className="cx-plan__text">
              <strong>{a.label}</strong>
              <small>{a.hint}</small>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </>
  )
}
