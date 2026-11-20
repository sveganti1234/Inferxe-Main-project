import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
  UserPlus,
  Building2,
  Key,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  FileText,
  Activity,
  RefreshCw,
  AlertCircle,
  RotateCcw,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { Tilt } from '../../components/ui/Tilt'
import { Counter } from '../../components/ui/Counter'
import { usePageMeta } from '../../lib/hooks'
import {
  fetchSuperadminDashboardOverview,
  getCachedSuperadminDashboardOverview,
  type SuperadminDashboardOverview,
} from '../../lib/authStore'
import {
  ADMIN_ROLE_METADATA,
  syncAdminAccountsFromBackend,
} from '../../lib/adminAccountStore'

const DISPLAY_ROLES = ['superadmin', 'admin'] as const

const ROLE_ICONS: Record<'superadmin' | 'admin', typeof ShieldCheck> = {
  superadmin: ShieldCheck,
  admin: Users,
}

export default function SuperAdminOverview() {
  usePageMeta('Super Admin Console · Inferxe Dashboard', 'Centralized RBAC management and platform administrator governance.')

  const [overview, setOverview] = useState<SuperadminDashboardOverview | null>(() => getCachedSuperadminDashboardOverview())
  const [isLoading, setIsLoading] = useState<boolean>(() => !getCachedSuperadminDashboardOverview())
  const [error, setError] = useState<string | null>(null)

  const loadOverview = useCallback(async (force = false) => {
    // Only flag full loading state if there is no cached overview to display
    if (!getCachedSuperadminDashboardOverview()) {
      setIsLoading(true)
    }
    try {
      // Trigger background sync for accounts store as well
      void syncAdminAccountsFromBackend(force).catch(() => {})

      const res = await fetchSuperadminDashboardOverview(force)
      if (res.ok && res.overview) {
        setOverview(res.overview)
        setError(null)
      } else {
        setError(res.error || 'Failed to load Super Admin dashboard overview.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error loading overview.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load & Cross-component synchronization
  useEffect(() => {
    void loadOverview()

    const handleSync = () => {
      void loadOverview()
    }

    window.addEventListener('inferxe_admin_accounts_change', handleSync)
    window.addEventListener('inferxe_admin_activities_change', handleSync)
    window.addEventListener('storage', handleSync)
    return () => {
      window.removeEventListener('inferxe_admin_accounts_change', handleSync)
      window.removeEventListener('inferxe_admin_activities_change', handleSync)
      window.removeEventListener('storage', handleSync)
    }
  }, [loadOverview])

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
            onClick={() => void loadOverview(true)}
            disabled={isLoading}
            title="Refresh live administration metrics from Supabase"
          >
            <RefreshCw size={13} className={isLoading ? 'sa-spin' : undefined} />
            <span>{isLoading ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <Link
            to="/dashboard/super-admin/accounts"
            className="dash-primary-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Users size={14} />
            <span>Manage Admins ({overview ? overview.adminStats.total : '...'})</span>
          </Link>
        </div>
      </motion.div>

      {/* ── Error Banner (if initial load failed) ──────────── */}
      {error && !overview && (
        <div
          style={{
            padding: '24px 20px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 12,
            marginBottom: 24,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <AlertCircle size={22} style={{ color: '#f87171', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, color: '#f87171', fontSize: '0.95rem', fontWeight: 600 }}>
              Failed to load Super Admin dashboard overview
            </h4>
            <p style={{ margin: '6px 0 14px', color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5 }}>
              {error}
            </p>
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => void loadOverview()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={13} />
              <span>Retry Connection</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Soft Error Alert (if cached data present) ──────── */}
      {error && overview && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 8,
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: '0.8rem',
            color: '#fbbf24',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={15} />
            <span>Telemetry refresh failed: {error}. Showing cached platform metrics.</span>
          </div>
          <button
            type="button"
            className="dash-filter-btn"
            onClick={() => void loadOverview()}
            style={{ padding: '3px 8px', fontSize: '0.72rem' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading Skeleton Grid ─────────────────────────── */}
      {!overview && !error && (
        <>
          {/* Top KPI Cards Skeleton */}
          <div className="sa-kpi-grid">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="dash-stat-card glass sa-kpi-card sa-skeleton--card">
                <div className="sa-kpi-header">
                  <div className="sa-skeleton sa-skeleton--text" style={{ width: '58%' }} />
                  <div className="sa-skeleton sa-skeleton--icon" />
                </div>
                <div className="sa-kpi-val readout" style={{ margin: '14px 0 8px' }}>
                  <div className="sa-skeleton sa-skeleton--title" style={{ width: '38%' }} />
                </div>
                <div className="sa-kpi-sub">
                  <div className="sa-skeleton sa-skeleton--text" style={{ width: '70%', height: '12px' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Platform Telemetry Section Header & Grid Skeleton */}
          <div style={{ marginTop: 28, marginBottom: 14 }}>
            <h3 className="sa-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <div className="sa-skeleton sa-skeleton--text" style={{ width: '220px', height: '18px' }} />
            </h3>
          </div>
          <div className="sa-kpi-grid">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="dash-stat-card glass sa-kpi-card sa-skeleton--card">
                <div className="sa-kpi-header">
                  <div className="sa-skeleton sa-skeleton--text" style={{ width: '52%' }} />
                  <div className="sa-skeleton sa-skeleton--icon" />
                </div>
                <div className="sa-kpi-val readout" style={{ margin: '14px 0 8px' }}>
                  <div className="sa-skeleton sa-skeleton--title" style={{ width: '42%' }} />
                </div>
                <div className="sa-kpi-sub">
                  <div className="sa-skeleton sa-skeleton--text" style={{ width: '65%', height: '12px' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Platform Role Distribution Skeleton */}
          <div className="sa-section-container" style={{ marginTop: 24, marginBottom: 24 }}>
            <div className="sa-section-header">
              <div>
                <div className="sa-skeleton sa-skeleton--text" style={{ width: '190px', height: '18px', marginBottom: 8 }} />
                <div className="sa-skeleton sa-skeleton--text" style={{ width: '340px', height: '12px' }} />
              </div>
            </div>
            <div className="sa-role-dist-grid">
              {[1, 2].map((i) => (
                <div key={i} className="sa-role-card" style={{ pointerEvents: 'none' }}>
                  <div className="sa-role-card__top">
                    <div className="sa-skeleton sa-skeleton--icon" />
                    <div className="sa-skeleton sa-skeleton--chip" />
                  </div>
                  <div className="sa-skeleton sa-skeleton--text" style={{ width: '45%', height: '18px', margin: '14px 0 8px' }} />
                  <div className="sa-skeleton sa-skeleton--text" style={{ width: '85%', height: '12px', marginBottom: 14 }} />
                  <div className="sa-role-card__progress-wrap">
                    <div className="sa-skeleton" style={{ height: '6px', width: '100%', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Two-Column Activity & Security Overview Skeleton */}
          <div className="sa-two-col-grid" style={{ marginBottom: 24 }}>
            <div className="sa-section-container">
              <div className="sa-section-header">
                <div className="sa-skeleton sa-skeleton--text" style={{ width: '220px', height: '18px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="sa-skeleton sa-skeleton--row" style={{ height: '52px', borderRadius: '8px' }} />
                ))}
              </div>
            </div>
            <div className="sa-section-container">
              <div className="sa-section-header">
                <div className="sa-skeleton sa-skeleton--text" style={{ width: '240px', height: '18px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="sa-skeleton sa-skeleton--row" style={{ height: '52px', borderRadius: '8px' }} />
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions Rack */}
          <div className="sa-quick-actions-bar">
            <div className="sa-quick-actions-info">
              <strong>Super Admin Actions</strong>
              <span>Manage administrative access, enforce RBAC constraints, and review audit trail.</span>
            </div>
            <div className="sa-quick-actions-btns">
              <Link to="/dashboard/super-admin/accounts" className="dash-primary-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <UserPlus size={14} />
                <span>Add Administrator</span>
              </Link>
              <Link to="/dashboard/super-admin/accounts" className="dash-filter-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} />
                <span>Admin Directory</span>
              </Link>
              <Link to="/dashboard/super-admin/roles" className="dash-filter-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileText size={14} />
                <span>RBAC Policies</span>
              </Link>
              <Link to="/dashboard/super-admin/audit" className="dash-filter-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Activity size={14} />
                <span>Audit Logs</span>
              </Link>
            </div>
          </div>
        </>
      )}

      {overview && (
        <>
          {/* ── Partial Data Warning (if individual Supabase queries failed) ── */}
          {overview.unavailableMetrics && overview.unavailableMetrics.length > 0 && (
            <div
              style={{
                padding: '12px 16px',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 8,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                fontSize: '0.8rem',
                color: '#fbbf24',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={15} />
                <span>
                  Telemetry Notice: Partial Supabase data received. The following metrics are temporarily unavailable:{' '}
                  <strong>{overview.unavailableMetrics.join(', ')}</strong>. Displaying available metrics.
                </span>
              </div>
              <button
                type="button"
                className="dash-filter-btn"
                onClick={() => void loadOverview()}
                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
              >
                Retry
              </button>
            </div>
          )}

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
                  {overview.adminStats.available === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.adminStats.total} />
                  )}
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
                  {overview.adminStats.available === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.adminStats.active} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span style={{ color: '#50e396', fontWeight: 600 }}>
                    {overview.adminStats.available === false
                      ? 'Telemetry unavailable'
                      : `${Math.round((overview.adminStats.active / (overview.adminStats.total || 1)) * 100)}% active platform coverage`}
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
                <div className="sa-kpi-val readout" style={{ color: overview.adminStats.inactive > 0 ? '#fbbf24' : 'var(--ink)' }}>
                  {overview.adminStats.available === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.adminStats.inactive} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span>Access paused or revoked</span>
                </div>
              </div>
            </Tilt>

            {/* KPI 4: Registered Customers (Real profiles table) */}
            <Tilt max={6} className="dash-stat-tilt">
              <div className="dash-stat-card glass glass--lift sa-kpi-card">
                <div className="sa-kpi-header">
                  <span className="sa-kpi-label">Registered Customers</span>
                  <div className="sa-kpi-icon-wrap" style={{ color: '#38bdf8', background: 'rgba(14, 165, 233, 0.12)' }}>
                    <Users size={16} />
                  </div>
                </div>
                <div className="sa-kpi-val readout" style={{ color: '#38bdf8' }}>
                  {overview.customerStats.available === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.customerStats.total} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                    {overview.customerStats.available === false
                      ? 'Customer statistics temporarily unavailable'
                      : `${overview.customerStats.registrations.last7Days} registered this week · ${overview.customerStats.active} active`}
                  </span>
                </div>
              </div>
            </Tilt>
          </motion.div>

          {/* ── 3. Platform & Tenant Overview Strip ───────────── */}
          <motion.div
            className="sa-kpi-grid"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Organizations */}
            <Tilt max={6} className="dash-stat-tilt">
              <div className="dash-stat-card glass glass--lift sa-kpi-card">
                <div className="sa-kpi-header">
                  <span className="sa-kpi-label">Organizations</span>
                  <div className="sa-kpi-icon-wrap" style={{ color: '#a855f7', background: 'rgba(168, 85, 247, 0.12)' }}>
                    <Building2 size={16} />
                  </div>
                </div>
                <div className="sa-kpi-val readout" style={{ color: '#c084fc' }}>
                  {overview.platformStats.organizationsAvailable === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.platformStats.totalOrganizations} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span>
                    {overview.platformStats.organizationsAvailable === false
                      ? 'Organization count unavailable'
                      : 'Registered platform organizations'}
                  </span>
                </div>
              </div>
            </Tilt>

            {/* Total API Keys */}
            <Tilt max={6} className="dash-stat-tilt">
              <div className="dash-stat-card glass glass--lift sa-kpi-card">
                <div className="sa-kpi-header">
                  <span className="sa-kpi-label">Customer API Keys</span>
                  <div className="sa-kpi-icon-wrap" style={{ color: '#06b6d4', background: 'rgba(6, 182, 212, 0.12)' }}>
                    <Key size={16} />
                  </div>
                </div>
                <div className="sa-kpi-val readout" style={{ color: '#22d3ee' }}>
                  {overview.platformStats.apiKeysAvailable === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.platformStats.totalApiKeys} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span>
                    {overview.platformStats.apiKeysAvailable === false
                      ? 'API key telemetry unavailable'
                      : `${overview.platformStats.activeApiKeys} active credentials`}
                  </span>
                </div>
              </div>
            </Tilt>

            {/* New Registrations Today */}
            <Tilt max={6} className="dash-stat-tilt">
              <div className="dash-stat-card glass glass--lift sa-kpi-card">
                <div className="sa-kpi-header">
                  <span className="sa-kpi-label">Registrations (30d)</span>
                  <div className="sa-kpi-icon-wrap" style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.12)' }}>
                    <UserPlus size={16} />
                  </div>
                </div>
                <div className="sa-kpi-val readout" style={{ color: '#34d399' }}>
                  {overview.customerStats.available === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.customerStats.registrations.last30Days} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span>
                    {overview.customerStats.available === false
                      ? 'Registration trend unavailable'
                      : `${overview.customerStats.registrations.today} registered today`}
                  </span>
                </div>
              </div>
            </Tilt>

            {/* Active Sessions */}
            <Tilt max={6} className="dash-stat-tilt">
              <div className="dash-stat-card glass glass--lift sa-kpi-card">
                <div className="sa-kpi-header">
                  <span className="sa-kpi-label">Admin Sessions</span>
                  <div className="sa-kpi-icon-wrap" style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)' }}>
                    <Lock size={16} />
                  </div>
                </div>
                <div className="sa-kpi-val readout" style={{ color: '#fbbf24' }}>
                  {overview.securityStats.available === false ? (
                    <span style={{ fontSize: '1.15rem', color: '#94a3b8', fontStyle: 'italic' }}>Unavailable</span>
                  ) : (
                    <Counter to={overview.securityStats.activeSessions} />
                  )}
                </div>
                <div className="sa-kpi-sub">
                  <span>
                    {overview.securityStats.available === false
                      ? 'Session telemetry unavailable'
                      : `${overview.securityStats.revokedSessions} revoked sessions`}
                  </span>
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
                  Granular Role-Based Access Control (RBAC) calculated dynamically from the administrator roster ({overview.adminStats.total} total).
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
              {DISPLAY_ROLES.map((roleKey) => {
                const meta = ADMIN_ROLE_METADATA[roleKey]
                const count = roleKey === 'superadmin' ? overview.adminStats.superadminCount : overview.adminStats.standardAdminCount
                const percentage = overview.adminStats.total > 0 ? Math.round((count / overview.adminStats.total) * 100) : 0
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
            {/* Left Column: Live Administrator Activity Ledger */}
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
                    <span>Live Administrator Activity Ledger</span>
                    <span className="sa-meta-badge sa-meta-badge--primary" style={{ fontSize: '0.62rem', padding: '1px 8px' }}>
                      Live Audit
                    </span>
                  </h3>
                  <p className="sa-section-desc">
                    Real-time administrative operations and audit events recorded in Supabase audit_logs.
                  </p>
                </div>
                <Link
                  to="/dashboard/super-admin/activity"
                  className="sa-link-action"
                >
                  <span>View All</span>
                  <ArrowRight size={13} />
                </Link>
              </div>

              {overview.activityStats.available === false ? (
                <div style={{ padding: '36px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>
                  Activity ledger is temporarily unavailable from Supabase.
                </div>
              ) : overview.activityStats.recentActivities.length === 0 ? (
                <div style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic' }}>
                  No administrator activity recorded yet.
                </div>
              ) : (
                <div className="sa-activity-timeline">
                  {overview.activityStats.recentActivities.map((act) => (
                    <div key={act.id} className="sa-activity-item">
                      <div className={`sa-activity-bullet sa-activity-bullet--${act.severity || 'info'}`} />
                      <div className="sa-activity-content">
                        <div className="sa-activity-header">
                          <span className="sa-activity-admin">{act.adminName || act.adminEmail}</span>
                          <span className="sa-activity-time">{act.timestamp}</span>
                        </div>
                        <div className="sa-activity-action">{act.action}</div>
                        <div className="sa-activity-target">
                          <code>{act.targetResource || act.description || 'System'}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.section>

            {/* Right Column: Platform Security & Auth Events */}
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
                    <span>Platform Security & Authentication Events</span>
                    <span className="sa-meta-badge sa-meta-badge--phase" style={{ fontSize: '0.62rem', padding: '1px 8px' }}>
                      Live Telemetry
                    </span>
                  </h3>
                  <p className="sa-section-desc">
                    Authentication attempts, session events, and boundary enforcement telemetry from Supabase audit_logs.
                  </p>
                </div>
                <Link
                  to="/dashboard/super-admin/audit"
                  className="sa-link-action"
                >
                  <span>Audit Logs</span>
                  <ArrowRight size={13} />
                </Link>
              </div>

              {overview.securityStats.available === false ? (
                <div style={{ padding: '36px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>
                  Security telemetry is temporarily unavailable from Supabase.
                </div>
              ) : overview.securityStats.recentSecurityEvents.length === 0 ? (
                <div style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic' }}>
                  No platform security events recorded.
                </div>
              ) : (
                <div className="sa-security-list">
                  {overview.securityStats.recentSecurityEvents.map((evt) => {
                    const isCritical = evt.severity === 'critical' || evt.action.includes('failed') || evt.action.includes('blocked')
                    const isWarning = evt.severity === 'warning' || evt.action.includes('revoke')
                    const statusLabel = isCritical ? 'blocked' : isWarning ? 'flagged' : 'allowed'

                    return (
                      <div key={evt.id} className="sa-security-item">
                        <div className="sa-security-item__head">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isCritical ? (
                              <AlertTriangle size={15} style={{ color: '#f87171' }} />
                            ) : isWarning ? (
                              <AlertTriangle size={15} style={{ color: '#fbbf24' }} />
                            ) : (
                              <CheckCircle2 size={15} style={{ color: '#50e396' }} />
                            )}
                            <span className="sa-security-item__type">{evt.action}</span>
                          </div>
                          <span className={`sa-sec-badge sa-sec-badge--${statusLabel}`}>
                            {statusLabel}
                          </span>
                        </div>

                        <div className="sa-security-item__details">
                          {evt.description || evt.action}
                        </div>

                        <div className="sa-security-item__meta">
                          <span>Actor: <strong>{evt.adminEmail || evt.adminName || 'system'}</strong></span>
                          <span>IP: <code>{evt.ipAddress || 'Internal'}</code></span>
                          <span>{evt.timestamp}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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
                <span>Admin Directory ({overview.adminStats.total})</span>
              </Link>

              <Link
                to="/dashboard/super-admin/roles"
                className="dash-filter-btn"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FileText size={14} />
                <span>RBAC Policies</span>
              </Link>

              <Link
                to="/dashboard/super-admin/audit"
                className="dash-filter-btn"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Activity size={14} />
                <span>Audit Logs</span>
              </Link>
            </div>
          </motion.div>
        </>
      )}
    </DashboardLayout>
  )
}
