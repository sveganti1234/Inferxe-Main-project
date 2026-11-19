import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ShieldCheck,
  UserCheck,
  UserX,
  Clock,
  UserPlus,
  Users,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  Server,
  DollarSign,
  Headphones,
  FileText,
  Activity,
  RefreshCw,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { Tilt } from '../../components/ui/Tilt'
import { Counter } from '../../components/ui/Counter'
import { usePageMeta } from '../../lib/hooks'
import {
  getAdminSummaryStats,
  getAdminActivities,
  getAdminSecurityEvents,
  syncAdminAccountsFromBackend,
  ADMIN_ROLE_METADATA,
  type AdminRole,
  type AdminActivityLog,
  type AdminSecurityEvent,
} from '../../lib/adminAccountStore'

const ROLE_ICONS: Record<AdminRole, typeof ShieldCheck> = {
  super_admin: ShieldCheck,
  admin: Users,
  infrastructure_admin: Server,
  billing_admin: DollarSign,
  support_admin: Headphones,
  security_auditor: Lock,
}

export default function SuperAdminOverview() {
  usePageMeta('Super Admin Console · Inferxe Dashboard', 'Centralized RBAC management and platform administrator governance.')

  const [stats, setStats] = useState(() => getAdminSummaryStats())
  const [activities, setActivities] = useState<AdminActivityLog[]>(() => getAdminActivities())
  const [securityEvents, setSecurityEvents] = useState<AdminSecurityEvent[]>(() => getAdminSecurityEvents())

  const refreshData = () => {
    void syncAdminAccountsFromBackend().then(() => {
      setStats(getAdminSummaryStats())
    })
    setStats(getAdminSummaryStats())
    setActivities(getAdminActivities())
    setSecurityEvents(getAdminSecurityEvents())
  }

  // Cross-component and cross-tab synchronization
  useEffect(() => {
    void syncAdminAccountsFromBackend().then(() => {
      setStats(getAdminSummaryStats())
    })
    const handleSync = () => {
      setStats(getAdminSummaryStats())
      setActivities(getAdminActivities())
      setSecurityEvents(getAdminSecurityEvents())
    }
    window.addEventListener('inferxe_admin_accounts_change', handleSync)
    window.addEventListener('inferxe_admin_activities_change', handleSync)
    window.addEventListener('storage', handleSync)
    return () => {
      window.removeEventListener('inferxe_admin_accounts_change', handleSync)
      window.removeEventListener('inferxe_admin_activities_change', handleSync)
      window.removeEventListener('storage', handleSync)
    }
  }, [])

  return (
    <DashboardLayout
      pageTitle="Super Admin Overview"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Super Admin', to: '/dashboard/super-admin' },
        { label: 'Overview' },
      ]}
      heading="Super Admin Console"
      description="Centralized governance, RBAC role distribution, and audit oversight for platform administrators."
      backButtonTo="/dashboard"
      backButtonLabel="Back to Dashboard"
    >
      {/* ── 1. Super Admin Tier Banner & Controls ─────────── */}
      <motion.div
        className="sa-header-banner"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sa-banner-title-group">
          <div className="sa-shield-icon-wrap" aria-hidden="true">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 className="sa-banner-title">Super Admin Governance Tier</h2>
              <span className="sa-scope-badge">
                <span className="sa-scope-badge__dot" />
                LIVE SUPABASE AUTH
              </span>
            </div>
            <div className="sa-banner-sub">
              Live database-backed administrator governance with Argon2id credentials and server-side sessions.
            </div>
          </div>
        </div>

        <div className="sa-banner-actions">
          <button
            type="button"
            className="dash-filter-btn"
            onClick={refreshData}
            title="Refresh live administration metrics from Supabase"
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>

          <Link
            to="/dashboard/super-admin/accounts"
            className="dash-primary-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Users size={14} />
            <span>Manage Admins ({stats.total})</span>
          </Link>
        </div>
      </motion.div>

      {/* ── 2. Top KPI Cards: Admin Account Overview ───────── */}
      <motion.div
        className="sa-kpi-grid"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* KPI 1: Total Admin Accounts */}
        <Tilt max={6} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift sa-kpi-card">
            <div className="sa-kpi-header">
              <span className="sa-kpi-label">Total Admin Accounts</span>
              <div className="sa-kpi-icon-wrap" style={{ color: '#50e396', background: 'rgba(80, 227, 150, 0.12)' }}>
                <Users size={16} />
              </div>
            </div>
            <div className="sa-kpi-val readout">
              <Counter to={stats.total} />
            </div>
            <div className="sa-kpi-sub">
              <span>Configured @inferxe.com admins</span>
            </div>
          </div>
        </Tilt>

        {/* KPI 2: Active Admins */}
        <Tilt max={6} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift sa-kpi-card">
            <div className="sa-kpi-header">
              <span className="sa-kpi-label">Active Administrators</span>
              <div className="sa-kpi-icon-wrap" style={{ color: '#50e396', background: 'rgba(80, 227, 150, 0.12)' }}>
                <UserCheck size={16} />
              </div>
            </div>
            <div className="sa-kpi-val readout" style={{ color: '#50e396' }}>
              <Counter to={stats.active} />
            </div>
            <div className="sa-kpi-sub">
              <span style={{ color: '#50e396', fontWeight: 600 }}>
                {Math.round((stats.active / (stats.total || 1)) * 100)}% active platform coverage
              </span>
            </div>
          </div>
        </Tilt>

        {/* KPI 3: Inactive Accounts */}
        <Tilt max={6} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift sa-kpi-card">
            <div className="sa-kpi-header">
              <span className="sa-kpi-label">Inactive Accounts</span>
              <div className="sa-kpi-icon-wrap" style={{ color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)' }}>
                <UserX size={16} />
              </div>
            </div>
            <div className="sa-kpi-val readout" style={{ color: stats.inactive > 0 ? '#fbbf24' : 'var(--ink)' }}>
              <Counter to={stats.inactive} />
            </div>
            <div className="sa-kpi-sub">
              <span>Access paused or revoked</span>
            </div>
          </div>
        </Tilt>

        {/* KPI 4: Pending Invitations */}
        <Tilt max={6} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift sa-kpi-card">
            <div className="sa-kpi-header">
              <span className="sa-kpi-label">Pending Invitations</span>
              <div className="sa-kpi-icon-wrap" style={{ color: '#38bdf8', background: 'rgba(14, 165, 233, 0.12)' }}>
                <Clock size={16} />
              </div>
            </div>
            <div className="sa-kpi-val readout" style={{ color: '#38bdf8' }}>
              <Counter to={stats.pending} />
            </div>
            <div className="sa-kpi-sub">
              <span>Demo invitations awaiting activation</span>
            </div>
          </div>
        </Tilt>
      </motion.div>

      {/* ── 4. Admin Role Distribution Section ────────────── */}
      <motion.section
        className="sa-section-container"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.44, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        style={{ marginBottom: 24 }}
      >
        <div className="sa-section-header">
          <div>
            <h3 className="sa-section-title">Platform Role Distribution</h3>
            <p className="sa-section-desc">
              Granular Role-Based Access Control (RBAC) calculated dynamically from the administrator roster ({stats.total} total).
            </p>
          </div>
          <Link
            to="/dashboard/super-admin/roles"
            className="sa-link-action"
            title="Configure RBAC Roles & Policy Boundaries"
          >
            <span>Role Matrix</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        <div className="sa-role-dist-grid">
          {(Object.keys(ADMIN_ROLE_METADATA) as AdminRole[]).map((roleKey) => {
            const meta = ADMIN_ROLE_METADATA[roleKey]
            const count = stats.roleDistribution[roleKey] || 0
            const percentage = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
            const Icon = ROLE_ICONS[roleKey]

            return (
              <div key={roleKey} className="sa-role-card">
                <div className="sa-role-card__top">
                  <div className={`sa-role-card__icon-box sa-role-card__icon-box--${roleKey}`}>
                    <Icon size={16} />
                  </div>
                  <span className={`sa-role-pill sa-role-pill--${roleKey}`}>
                    {count} {count === 1 ? 'Admin' : 'Admins'}
                  </span>
                </div>

                <div className="sa-role-card__title">{meta.title}</div>
                <div className="sa-role-card__desc">{meta.description}</div>

                <div className="sa-role-card__progress-wrap">
                  <div className="sa-role-card__progress-bar">
                    <div
                      className={`sa-role-card__progress-fill sa-role-card__progress-fill--${roleKey}`}
                      style={{ width: `${Math.max(percentage, count > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                  <div className="sa-role-card__percentage">{percentage}%</div>
                </div>

                <div className="sa-role-card__perm-preview">
                  <strong>Scope:</strong> {meta.permissionsSummary.slice(0, 2).join(', ')}
                  {meta.permissionsSummary.length > 2 && ` +${meta.permissionsSummary.length - 2} more`}
                </div>
              </div>
            )
          })}
        </div>
      </motion.section>

      {/* ── 5. Two-Column Activity & Security Overview ─────── */}
      <div className="sa-two-col-grid" style={{ marginBottom: 24 }}>
        {/* Left Column: Recent Admin Activity */}
        <motion.section
          className="sa-section-container"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.44, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="sa-section-header">
            <div>
              <h3 className="sa-section-title">
                <Activity size={16} style={{ color: '#50e396' }} />
                <span>Sample Admin Activity Ledger</span>
                <span className="sa-demo-chip" style={{ fontSize: '0.62rem', padding: '1px 6px' }}>Simulated</span>
              </h3>
              <p className="sa-section-desc">Sample audit records for design evaluation. Real-time streaming connects to backend audit logs in Phase 2.</p>
            </div>
            <Link
              to="/dashboard/super-admin/activity"
              className="sa-link-action"
            >
              <span>View All</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="sa-activity-timeline">
            {activities.slice(0, 6).map((act) => (
              <div key={act.id} className="sa-activity-item">
                <div className={`sa-activity-bullet sa-activity-bullet--${act.severity}`} />
                <div className="sa-activity-content">
                  <div className="sa-activity-header">
                    <span className="sa-activity-admin">{act.adminName}</span>
                    <span className="sa-activity-time">{act.timestamp}</span>
                  </div>
                  <div className="sa-activity-action">{act.action}</div>
                  <div className="sa-activity-target">
                    <code>{act.targetResource}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Right Column: Recent Security & Auth Events */}
        <motion.section
          className="sa-section-container"
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.44, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="sa-section-header">
            <div>
              <h3 className="sa-section-title">
                <Lock size={16} style={{ color: '#38bdf8' }} />
                <span>Sample Platform Security Events</span>
                <span className="sa-demo-chip" style={{ fontSize: '0.62rem', padding: '1px 6px' }}>Simulated</span>
              </h3>
              <p className="sa-section-desc">Sample authentication and boundary telemetry for design evaluation.</p>
            </div>
            <Link
              to="/dashboard/super-admin/audit"
              className="sa-link-action"
            >
              <span>Audit Logs</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="sa-security-list">
            {securityEvents.slice(0, 5).map((evt) => (
              <div key={evt.id} className="sa-security-item">
                <div className="sa-security-item__head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {evt.status === 'allowed' && <CheckCircle2 size={15} style={{ color: '#50e396' }} />}
                    {evt.status === 'blocked' && <AlertTriangle size={15} style={{ color: '#f87171' }} />}
                    {evt.status === 'flagged' && <AlertTriangle size={15} style={{ color: '#fbbf24' }} />}
                    <span className="sa-security-item__type">{evt.eventType}</span>
                  </div>
                  <span className={`sa-sec-badge sa-sec-badge--${evt.status}`}>
                    {evt.status}
                  </span>
                </div>

                <div className="sa-security-item__details">{evt.details}</div>

                <div className="sa-security-item__meta">
                  <span>Actor: <strong>{evt.actor}</strong></span>
                  <span>IP: <code>{evt.ipAddress}</code></span>
                  <span>{evt.location}</span>
                  <span>{evt.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      </div>

      {/* ── 6. Quick Governance Actions Rack ──────────────── */}
      <motion.div
        className="sa-quick-actions-bar"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.44, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sa-quick-actions-info">
          <strong>Super Admin Actions</strong>
          <span>Manage administrative access, enforce RBAC constraints, and review audit trail.</span>
        </div>

        <div className="sa-quick-actions-btns">
          <Link
            to="/dashboard/super-admin/accounts"
            className="dash-primary-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <UserPlus size={14} />
            <span>Add Administrator</span>
          </Link>

          <Link
            to="/dashboard/super-admin/accounts"
            className="dash-filter-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Users size={14} />
            <span>Admin Directory ({stats.total})</span>
          </Link>

          <Link
            to="/dashboard/super-admin/roles"
            className="dash-filter-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <FileText size={14} />
            <span>RBAC Policies</span>
          </Link>
        </div>
      </motion.div>
    </DashboardLayout>
  )
}
