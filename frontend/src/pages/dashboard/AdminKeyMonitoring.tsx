import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Eye,
  FileText,
  KeyRound,
  Lock,
  LogIn,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  clearSession,
  fetchAdminKeyMonitoring,
  getAuthenticatedPortalRole,
  getPortalRole,
  getSession,
  type AdminKeyAuditRecord,
  type AdminKeyMonitoringData,
  type AdminKeySecurityAlert,
  type AuthSession,
  type PortalRole,
  type SuperadminKeyRecord,
} from '../../lib/authStore'

type ActiveTab = 'keys' | 'alerts' | 'audit'
type KeyFilter = 'all' | 'api' | 'ssh' | 'active' | 'inactive'

function formatTimestamp(iso?: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminKeyMonitoring() {
  usePageMeta(
    'Key Monitoring · Inferxe Admin',
    'Read-only monitoring of customer API keys, SSH public key metadata, usage telemetry, security alerts, and key audit trails.',
  )

  const navigate = useNavigate()
  const [data, setData] = useState<AdminKeyMonitoringData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('keys')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<KeyFilter>('all')

  const [session, setSession] = useState<AuthSession | null>(() => getSession())

  useEffect(() => {
    const syncSession = () => setSession(getSession())
    window.addEventListener('inferxe_auth_change', syncSession)
    window.addEventListener('storage', syncSession)
    return () => {
      window.removeEventListener('inferxe_auth_change', syncSession)
      window.removeEventListener('storage', syncSession)
    }
  }, [])

  // Prefer the cryptographically verified role returned by GET /api/admin/keys;
  // fall back to the authenticated role from authStore/signed JWT while loading.
  const authenticatedRole: PortalRole = data?.actor_role
    ? getPortalRole(data.actor_role)
    : getAuthenticatedPortalRole(session)
  const isSuperadminSession = authenticatedRole === 'superadmin'

  const loadMonitoring = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAuthError(false)
    const res = await fetchAdminKeyMonitoring()
    if (res.ok && res.data) {
      setData(res.data)
    } else {
      setData(null)
      setAuthError(Boolean(res.unauthorized || res.forbidden || res.status === 401 || res.status === 403))
      setError(res.error || 'Failed to load key monitoring telemetry from backend.')
    }
    setLoading(false)
  }, [])

  const handleSignInAgain = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    void loadMonitoring()
  }, [loadMonitoring, session?.token])

  const keys: SuperadminKeyRecord[] = data?.keys ?? []
  const alerts: AdminKeySecurityAlert[] = data?.alerts ?? []
  const auditRecords: AdminKeyAuditRecord[] = data?.audit_records ?? []
  const summary = data?.summary

  const filteredKeys = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return keys.filter((k) => {
      const matchesSearch =
        !q ||
        k.name.toLowerCase().includes(q) ||
        k.owner_email.toLowerCase().includes(q) ||
        k.owner_name.toLowerCase().includes(q) ||
        k.id.toLowerCase().includes(q) ||
        k.prefix.toLowerCase().includes(q) ||
        (k.fingerprint || '').toLowerCase().includes(q)

      if (!matchesSearch) return false
      if (filterType === 'api') return k.type === 'API Key'
      if (filterType === 'ssh') return k.type === 'SSH Key'
      if (filterType === 'active') return k.status === 'active'
      if (filterType === 'inactive') return k.status !== 'active'
      return true
    })
  }, [keys, searchQuery, filterType])

  return (
    <DashboardLayout
      pageTitle="Key Monitoring"
      breadcrumb={[
        { label: 'Admin Portal', to: '/dashboard' },
        { label: 'Key Monitoring' },
      ]}
      heading="API & SSH Key Monitoring"
      description="Read-only metadata, inference usage telemetry, security alerts, and key audit history across platform credentials."
      backButtonTo="/dashboard"
      backButtonLabel="Back to overview"
    >
      {/* Role Responsibility & Scope Separation */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* Current View: Admin Key Monitoring (Read-Only) */}
        <div
          className="dash-panel-card"
          style={{
            padding: '16px 18px',
            borderColor: 'rgba(16, 185, 129, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: 'rgba(16, 185, 129, 0.14)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.32)',
                }}
              >
                <Eye size={12} /> Admin Key Monitoring · Active View
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--ink-3)',
                }}
              >
                <Lock size={12} /> Read-Only Access
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Global API &amp; SSH key metadata, usage telemetry, security alerts, and key audit history. Raw API secrets, secret hashes, and private SSH keys are never exposed, and no credential mutations are permitted here.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.73rem', color: 'var(--ink-3)' }}>
              Source: Live Supabase credential &amp; audit tables
            </span>
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => void loadMonitoring()}
              disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.76rem' }}
            >
              <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
              <span>{loading ? 'Syncing...' : 'Refresh Telemetry'}</span>
            </button>
          </div>
        </div>

        {/* Privileged Tier: Super Admin Key Management */}
        <div
          className="dash-panel-card"
          style={{
            padding: '16px 18px',
            borderColor: isSuperadminSession ? 'rgba(251, 191, 36, 0.35)' : undefined,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: 'rgba(251, 191, 36, 0.14)',
                  color: '#f59e0b',
                  border: '1px solid rgba(251, 191, 36, 0.32)',
                }}
              >
                <ShieldCheck size={12} /> Super Admin Key Management
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-3)' }}>
                Privileged Control
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Global credential oversight with emergency API key revocation, permanent SSH public-key deletion (with GPU session detachment), and mandatory audited reasons.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
            {isSuperadminSession ? (
              <Link
                to="/dashboard/superadmin/keys"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 14px',
                  borderRadius: 9,
                  textDecoration: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: 'rgba(251, 191, 36, 0.16)',
                  color: '#f59e0b',
                  border: '1px solid rgba(251, 191, 36, 0.38)',
                }}
              >
                <ShieldAlert size={14} />
                <span>Open Super Admin Key Management</span>
                <ArrowRight size={13} />
              </Link>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.74rem',
                  color: 'var(--ink-3)',
                  padding: '5px 10px',
                  borderRadius: 8,
                  background: 'rgba(148, 163, 184, 0.08)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                }}
              >
                <Lock size={12} /> Super Admin role required for emergency revocation
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fail-Closed Authentication / Backend Error State (Never show misleading 0 counts) */}
      {error && !data && (
        <div
          role="alert"
          className="dash-panel-card"
          style={{
            background: authError ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            border: `1px solid ${authError ? 'rgba(245, 158, 11, 0.38)' : 'rgba(239, 68, 68, 0.38)'}`,
            padding: '24px',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle
              size={22}
              style={{
                color: authError ? '#f59e0b' : '#ef4444',
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--ink)' }}>
                {authError ? 'Administrator Authentication Required' : 'Key Monitoring Backend Unavailable'}
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                {error}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                {authError
                  ? 'Sign in with a valid Admin or Super Admin account so the portal can issue a verified HS256 session token for live Supabase key telemetry.'
                  : 'Telemetry counters and tables are hidden while the backend is unreachable so zero values are never mistaken for empty production data.'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {authError && (
              <button
                type="button"
                onClick={handleSignInAgain}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 9,
                  border: 'none',
                  background: '#10b981',
                  color: '#04120b',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <LogIn size={14} />
                <span>Sign In Again</span>
              </button>
            )}
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => void loadMonitoring()}
              disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
            >
              <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Initial Loading State (Never show placeholder 0 counts) */}
      {loading && !data && !error && (
        <div
          className="dash-panel-card"
          style={{
            padding: '44px 24px',
            textAlign: 'center',
            color: 'var(--ink-3)',
          }}
        >
          <RefreshCw size={22} className="spin-icon" style={{ color: '#10b981', margin: '0 auto 10px' }} />
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '0.92rem' }}>
            Loading live key monitoring telemetry...
          </div>
          <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
            Verifying administrator session and querying Supabase API &amp; SSH key metadata.
          </div>
        </div>
      )}

      {/* Live Verified Telemetry Content */}
      {data && summary && (
        <>
          {/* KPI Metrics Row */}
          <div
            className="dash-stats-row"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              marginBottom: 20,
            }}
          >
            <div className="dash-stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dash-stat-label">Active API Keys</span>
                <KeyRound size={16} style={{ color: '#10b981' }} />
              </div>
              <div className="dash-stat-value">{summary.active_api_keys}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                {summary.revoked_api_keys} revoked · {summary.expired_api_keys} expired
              </div>
            </div>

            <div className="dash-stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dash-stat-label">Registered SSH Keys</span>
                <Terminal size={16} style={{ color: '#0ea5e9' }} />
              </div>
              <div className="dash-stat-value">{summary.ssh_keys}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                Public-key fingerprints only
              </div>
            </div>

            <div className="dash-stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dash-stat-label">API Requests Tracked</span>
                <Activity size={16} style={{ color: '#50e396' }} />
              </div>
              <div className="dash-stat-value">{summary.total_requests}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                {summary.failed_requests} failed ({summary.error_rate_pct}%) · {summary.active_keys_used_24h} active in 24h
              </div>
            </div>

            <div className="dash-stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dash-stat-label">Security Alerts</span>
                <ShieldAlert
                  size={16}
                  style={{ color: summary.high_severity_alerts > 0 ? '#ef4444' : '#f59e0b' }}
                />
              </div>
              <div className="dash-stat-value">{summary.security_alerts_count}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                {summary.high_severity_alerts} high severity · {auditRecords.length} audit events
              </div>
            </div>
          </div>

          {/* Section Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`dash-filter-btn ${activeTab === 'keys' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('keys')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <KeyRound size={14} />
              <span>Keys &amp; Usage ({keys.length})</span>
            </button>
            <button
              type="button"
              className={`dash-filter-btn ${activeTab === 'alerts' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('alerts')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <AlertTriangle size={14} />
              <span>Security Alerts ({alerts.length})</span>
            </button>
            <button
              type="button"
              className={`dash-filter-btn ${activeTab === 'audit' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('audit')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FileText size={14} />
              <span>Audit Records ({auditRecords.length})</span>
            </button>
          </div>

          {/* Tab 1: Keys & Usage Metadata Table */}
          {activeTab === 'keys' && (
            <div className="dash-panel-card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div style={{ position: 'relative', width: 340, maxWidth: '100%' }}>
                  <Search
                    size={15}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--ink-3)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Search by key name, owner, ID, or fingerprint..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 36px',
                      fontSize: '0.82rem',
                      borderRadius: 10,
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(
                    [
                      { id: 'all', label: `All (${keys.length})` },
                      { id: 'api', label: `API Keys (${keys.filter((k) => k.type === 'API Key').length})` },
                      { id: 'ssh', label: `SSH Keys (${keys.filter((k) => k.type === 'SSH Key').length})` },
                      { id: 'active', label: `Active (${keys.filter((k) => k.status === 'active').length})` },
                      { id: 'inactive', label: `Revoked / Expired (${keys.filter((k) => k.status !== 'active').length})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`dash-filter-btn ${filterType === tab.id ? 'is-active' : ''}`}
                      onClick={() => setFilterType(tab.id)}
                      style={{ fontSize: '0.75rem', padding: '5px 11px' }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dash-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th>Credential</th>
                      <th>Type</th>
                      <th>Owner</th>
                      <th>Prefix / Fingerprint</th>
                      <th>Usage &amp; Activity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKeys.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)' }}>
                          No credentials match the selected filter.
                        </td>
                      </tr>
                    ) : (
                      filteredKeys.map((key) => (
                        <tr key={key.id}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: '0.84rem' }}>{key.name}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ink-3)' }}>
                              {key.id}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                background:
                                  key.type === 'API Key' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(14, 165, 233, 0.14)',
                                color: key.type === 'API Key' ? '#f59e0b' : '#0ea5e9',
                                border: `1px solid ${
                                  key.type === 'API Key' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(14, 165, 233, 0.3)'
                                }`,
                              }}
                            >
                              {key.type === 'API Key'
                                ? `API · ${(key.environment || 'live').toUpperCase()}`
                                : `SSH · ${key.ssh_algorithm || 'public'}`}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, fontSize: '0.82rem' }}>{key.owner_name}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                              {key.owner_email} ({key.role})
                            </div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                            {key.fingerprint || key.prefix}
                          </td>
                          <td style={{ fontSize: '0.76rem' }}>
                            {key.type === 'API Key' ? (
                              <>
                                <div>
                                  <strong>{key.usage_count ?? 0}</strong> reqs
                                  {(key.failed_count ?? 0) > 0 && (
                                    <span style={{ color: '#ef4444', marginLeft: 6 }}>
                                      ({key.failed_count} failed)
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)' }}>
                                  Last used: {formatTimestamp(key.last_used)}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                                Added: {formatTimestamp(key.created_at)}
                              </div>
                            )}
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 9px',
                                borderRadius: 999,
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                textTransform: 'capitalize',
                                background:
                                  key.status === 'active'
                                    ? 'rgba(16, 185, 129, 0.14)'
                                    : key.status === 'expired'
                                      ? 'rgba(245, 158, 11, 0.14)'
                                      : 'rgba(239, 68, 68, 0.14)',
                                color:
                                  key.status === 'active'
                                    ? '#10b981'
                                    : key.status === 'expired'
                                      ? '#f59e0b'
                                      : '#ef4444',
                              }}
                            >
                              {key.status}
                            </span>
                            {key.revoked_at && (
                              <div style={{ fontSize: '0.68rem', color: 'var(--ink-3)', marginTop: 2 }}>
                                {formatTimestamp(key.revoked_at)}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2: Security Alerts */}
          {activeTab === 'alerts' && (
            <div className="dash-panel-card">
              {alerts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)' }}>
                  <ShieldCheck size={28} style={{ color: '#10b981', margin: '0 auto 8px' }} />
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No active key security alerts</div>
                  <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                    All monitored API keys are within normal failure-rate, expiration, and rotation thresholds.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: `1px solid ${
                          alert.severity === 'high'
                            ? 'rgba(239, 68, 68, 0.35)'
                            : 'rgba(245, 158, 11, 0.35)'
                        }`,
                        background:
                          alert.severity === 'high'
                            ? 'rgba(239, 68, 68, 0.08)'
                            : 'rgba(245, 158, 11, 0.08)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 14,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              padding: '2px 7px',
                              borderRadius: 999,
                              background: alert.severity === 'high' ? '#ef4444' : '#f59e0b',
                              color: '#ffffff',
                            }}
                          >
                            {alert.severity}
                          </span>
                          <strong style={{ fontSize: '0.86rem' }}>{alert.title}</strong>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-2)' }}>{alert.detail}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                          Key ID: {alert.key_id} · Owner: {alert.owner_email}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                        {formatTimestamp(alert.detected_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Key Audit Records */}
          {activeTab === 'audit' && (
            <div className="dash-panel-card">
              <div className="dash-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Target Credential</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRecords.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)' }}>
                          No key governance audit records recorded yet.
                        </td>
                      </tr>
                    ) : (
                      auditRecords.map((rec) => (
                        <tr key={rec.id}>
                          <td style={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
                            {formatTimestamp(rec.created_at)}
                          </td>
                          <td>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.72rem',
                                padding: '2px 7px',
                                borderRadius: 6,
                                background: 'rgba(16, 185, 129, 0.12)',
                                color: '#10b981',
                              }}
                            >
                              {rec.action}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.78rem' }}>{rec.actor_email}</td>
                          <td>
                            <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                              {rec.key_name || rec.target_id}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.69rem', color: 'var(--ink-3)' }}>
                              {rec.target_type} · {rec.target_id}
                            </div>
                          </td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--ink-2)' }}>
                            {rec.reason || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  )
}

