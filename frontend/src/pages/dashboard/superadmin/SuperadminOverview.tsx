import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck,
  Users,
  FileText,
  Cpu,
  Key,
  Activity,
  Server,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  fetchSuperadminAdmins,
  fetchSuperadminAuditLogs,
  fetchSuperadminTelemetry,
  type SuperadminAdminRecord,
  type SuperadminAuditLog,
  type SuperadminTelemetryData,
} from '../../../lib/authStore'

export default function SuperadminOverview() {
  usePageMeta(
    'Superadmin Console · Inferxe Platform Governance',
    'Global infrastructure oversight, admin activity monitoring, GPU telemetry, and platform security control plane.',
  )

  const navigate = useNavigate()
  const [admins, setAdmins] = useState<SuperadminAdminRecord[]>([])
  const [auditLogs, setAuditLogs] = useState<SuperadminAuditLog[]>([])
  const [telemetry, setTelemetry] = useState<SuperadminTelemetryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAllData = async (isManual = false) => {
    if (isManual) setRefreshing(true)
    setError(null)

    try {
      const [adminsRes, logsRes, telemRes] = await Promise.all([
        fetchSuperadminAdmins(),
        fetchSuperadminAuditLogs({ limit: 10 }),
        fetchSuperadminTelemetry(),
      ])

      if (adminsRes.ok && adminsRes.admins) {
        setAdmins(adminsRes.admins)
      }
      if (logsRes.ok && logsRes.logs) {
        setAuditLogs(logsRes.logs)
      }
      if (telemRes.ok && telemRes.telemetry) {
        setTelemetry(telemRes.telemetry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Superadmin console data.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadAllData()
  }, [])

  const activeAdminsCount = admins.filter((a) => a.status === 'active').length
  const suspendedAdminsCount = admins.filter((a) => a.status === 'suspended').length

  return (
    <DashboardLayout
      pageTitle="Superadmin Console"
      breadcrumb={[{ label: 'Platform Governance' }, { label: 'Superadmin Overview' }]}
    >
      <div style={{ maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {/* ── Top Header Banner ── */}
        <div
          style={{
            background: 'linear-gradient(135deg, #0D1612 0%, #122018 100%)',
            border: '1px solid #1B2E24',
            borderRadius: '14px',
            padding: '24px 28px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(0, 255, 136, 0.14)',
                  color: '#00FF88',
                  border: '1px solid rgba(0, 255, 136, 0.35)',
                  borderRadius: '20px',
                  padding: '3px 10px',
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                <ShieldCheck size={13} /> Platform Master Governance
              </span>
              <span style={{ color: '#6EE7B7', fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>
                Role: Superadmin
              </span>
            </div>
            <h1
              style={{
                fontSize: '1.65rem',
                fontWeight: 700,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              Superadmin Command Center
            </h1>
            <p style={{ margin: '6px 0 0', color: '#9CA3AF', fontSize: '0.88rem' }}>
              Full authority oversight of registered administrators, audit trails, sovereign GPU telemetry, and platform security keys.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadAllData(true)}
              disabled={refreshing}
              style={{
                background: '#121C16',
                border: '1px solid #1B2E24',
                color: '#E5E7EB',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh Telemetry'}</span>
            </button>
            <Link
              to="/dashboard"
              style={{
                background: '#10B981',
                color: '#040D08',
                fontWeight: 600,
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>Switch to Admin Portal</span>
              <ExternalLink size={13} />
            </Link>
          </div>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div
            style={{
              background: '#2B1214',
              border: '1px solid #7F1D1D',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#FCA5A5',
              fontSize: '0.85rem',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Top 4 KPI Metrics Row ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          {/* KPI 1: Admins */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Registered Admins
              </span>
              <Users size={18} style={{ color: '#10B981' }} />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1, marginBottom: '6px' }}>
              {admins.length}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
              <span style={{ color: '#10B981', fontWeight: 600 }}>{activeAdminsCount} Active</span>
              <span style={{ color: '#4B5563' }}>•</span>
              <span style={{ color: suspendedAdminsCount > 0 ? '#EF4444' : '#9CA3AF' }}>
                {suspendedAdminsCount} Suspended
              </span>
              <Link
                to="/dashboard/superadmin/admins"
                style={{ marginLeft: 'auto', color: '#10B981', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                Manage <ArrowRight size={12} />
              </Link>
            </div>
          </div>

          {/* KPI 2: GPU Clusters */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Monitored GPU Nodes
              </span>
              <Cpu size={18} style={{ color: '#00FF88' }} />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1, marginBottom: '6px' }}>
              {telemetry?.summary.totalGpuCount ?? 216} GPUs
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
              <span style={{ color: '#00FF88', fontWeight: 600 }}>
                {telemetry?.summary.allocatedGpuCount ?? 187} Allocated ({telemetry?.summary.utilizationPct ?? 86.6}%)
              </span>
              <Link
                to="/dashboard/superadmin/telemetry"
                style={{ marginLeft: 'auto', color: '#00FF88', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                Telemetry <ArrowRight size={12} />
              </Link>
            </div>
          </div>

          {/* KPI 3: Audit Events */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Audit Events
              </span>
              <FileText size={18} style={{ color: '#38BDF8' }} />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1, marginBottom: '6px' }}>
              {auditLogs.length > 0 ? `${auditLogs.length}+` : '0'} Logged
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
              <span style={{ color: '#38BDF8', fontWeight: 600 }}>Immutable SQLite WAL</span>
              <Link
                to="/dashboard/superadmin/audit-logs"
                style={{ marginLeft: 'auto', color: '#38BDF8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                Audit Trail <ArrowRight size={12} />
              </Link>
            </div>
          </div>

          {/* KPI 4: Infrastructure Health */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Platform Availability
              </span>
              <Activity size={18} style={{ color: '#10B981' }} />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1, marginBottom: '6px' }}>
              {telemetry?.summary.globalHealthScore ?? 99.98}%
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem' }}>
              <span style={{ color: '#10B981', fontWeight: 600 }}>
                Avg Latency: {telemetry?.summary.averageLatencyMs ?? 14.2}ms
              </span>
              <span style={{ color: '#4B5563' }}>•</span>
              <span style={{ color: '#9CA3AF' }}>Zero degraded</span>
            </div>
          </div>
        </div>

        {/* ── Main Two Column Grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: '20px', marginBottom: '24px' }}>
          {/* Left Column: Admin Oversight & GPU Clusters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Registered Admins Summary Table */}
            <div
              style={{
                background: '#0F1612',
                border: '1px solid #1B2E24',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                    Registered Administrators
                  </h2>
                  <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.78rem' }}>
                    Track admin activity status, roles, and privileges.
                  </p>
                </div>
                <Link
                  to="/dashboard/superadmin/admins"
                  style={{
                    background: '#121C16',
                    border: '1px solid #23382C',
                    color: '#E5E7EB',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>View All Admins</span>
                  <ArrowRight size={12} />
                </Link>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1B2E24' }}>
                      <th style={{ padding: '10px 12px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Admin
                      </th>
                      <th style={{ padding: '10px 12px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Role
                      </th>
                      <th style={{ padding: '10px 12px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Status
                      </th>
                      <th style={{ padding: '10px 12px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Actions Count
                      </th>
                      <th style={{ padding: '10px 12px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && admins.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF' }}>
                          Loading administrator telemetry...
                        </td>
                      </tr>
                    ) : (
                      admins.map((adm) => (
                        <tr key={adm.id} style={{ borderBottom: '1px solid #152219' }}>
                        <td style={{ padding: '12px', color: '#FFFFFF' }}>
                          <div style={{ fontWeight: 600 }}>{adm.full_name}</div>
                          <div style={{ color: '#9CA3AF', fontSize: '0.76rem' }}>{adm.email}</div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              background: adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                              color: adm.role === 'superadmin' ? '#00FF88' : '#38BDF8',
                              border: `1px solid ${adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
                              borderRadius: '4px',
                              padding: '2px 8px',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            {adm.role === 'superadmin' ? 'Superadmin' : 'Admin'}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: adm.status === 'active' ? '#10B981' : adm.status === 'suspended' ? '#EF4444' : '#F59E0B',
                              fontSize: '0.78rem',
                              fontWeight: 600,
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: adm.status === 'active' ? '#10B981' : adm.status === 'suspended' ? '#EF4444' : '#F59E0B',
                              }}
                            />
                            {adm.status.charAt(0).toUpperCase() + adm.status.slice(1)}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#E5E7EB', fontFamily: 'var(--font-mono)' }}>
                          {adm.activity_count ?? 0} actions
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => navigate('/dashboard/superadmin/admins')}
                            style={{
                              background: '#121C16',
                              border: '1px solid #1B2E24',
                              color: '#E5E7EB',
                              borderRadius: '6px',
                              padding: '4px 10px',
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            Configure
                          </button>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* GPU Infrastructure Telemetry Overview */}
            <div
              style={{
                background: '#0F1612',
                border: '1px solid #1B2E24',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                    Global Cloud & GPU Infrastructure
                  </h2>
                  <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.78rem' }}>
                    Live status of sovereign Indian datacenter clusters.
                  </p>
                </div>
                <Link
                  to="/dashboard/superadmin/telemetry"
                  style={{
                    background: '#121C16',
                    border: '1px solid #23382C',
                    color: '#E5E7EB',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>Detailed Telemetry</span>
                  <ArrowRight size={12} />
                </Link>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(telemetry?.clusters || []).map((cluster) => (
                  <div
                    key={cluster.id}
                    style={{
                      background: '#121C16',
                      border: '1px solid #1B2E24',
                      borderRadius: '8px',
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Server size={15} style={{ color: '#10B981' }} />
                        <span style={{ fontWeight: 600, color: '#FFFFFF', fontSize: '0.88rem' }}>
                          {cluster.name}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)' }}>
                          ({cluster.provider})
                        </span>
                      </div>
                      <span
                        style={{
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#10B981',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}
                      >
                        {cluster.uptime} Uptime
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.78rem', color: '#D1D5DB' }}>
                      {cluster.gpus.map((gpu, idx) => (
                        <div key={idx} style={{ background: '#0B120E', padding: '6px 10px', borderRadius: '6px', border: '1px solid #152219' }}>
                          <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{gpu.type}</span>: {gpu.allocated}/{gpu.total} allocated • {gpu.vramUsedGb}GB / {gpu.vramTotalGb}GB VRAM • {gpu.avgTempC}°C
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Recent Audit Trail Feed & Fast Governance Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Quick Governance Links */}
            <div
              style={{
                background: '#0F1612',
                border: '1px solid #1B2E24',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 14px' }}>
                Superadmin Control Actions
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Link
                  to="/dashboard/superadmin/admins"
                  style={{
                    background: '#121C16',
                    border: '1px solid #1B2E24',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#FFFFFF',
                    textDecoration: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <Users size={16} style={{ color: '#10B981' }} />
                  <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>Manage Admins</span>
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Approve or suspend accounts</span>
                </Link>

                <Link
                  to="/dashboard/superadmin/audit-logs"
                  style={{
                    background: '#121C16',
                    border: '1px solid #1B2E24',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#FFFFFF',
                    textDecoration: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <FileText size={16} style={{ color: '#38BDF8' }} />
                  <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>Audit Logs</span>
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Complete tamper-proof trail</span>
                </Link>

                <Link
                  to="/dashboard/superadmin/telemetry"
                  style={{
                    background: '#121C16',
                    border: '1px solid #1B2E24',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#FFFFFF',
                    textDecoration: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <Cpu size={16} style={{ color: '#00FF88' }} />
                  <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>GPU Clusters</span>
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Telemetry & dynamic pricing</span>
                </Link>

                <Link
                  to="/dashboard/superadmin/keys"
                  style={{
                    background: '#121C16',
                    border: '1px solid #1B2E24',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#FFFFFF',
                    textDecoration: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <Key size={16} style={{ color: '#FBBF24' }} />
                  <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>API & SSH Keys</span>
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Audit & emergency revoke</span>
                </Link>
              </div>
            </div>

            {/* Recent Audit Logs Feed */}
            <div
              style={{
                background: '#0F1612',
                border: '1px solid #1B2E24',
                borderRadius: '12px',
                padding: '20px',
                flex: 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                  Recent Audit Trail
                </h2>
                <Link
                  to="/dashboard/superadmin/audit-logs"
                  style={{ color: '#38BDF8', fontSize: '0.76rem', textDecoration: 'none' }}
                >
                  View full logs →
                </Link>
              </div>

              {auditLogs.length === 0 ? (
                <div style={{ color: '#9CA3AF', fontSize: '0.82rem', padding: '24px 0', textAlign: 'center' }}>
                  No audit logs recorded yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {auditLogs.slice(0, 7).map((log) => (
                    <div
                      key={log.id}
                      style={{
                        background: '#121C16',
                        border: '1px solid #18281E',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        fontSize: '0.8rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: log.category === 'auth' ? '#38BDF8' : log.category === 'customer' ? '#10B981' : '#FBBF24',
                            textTransform: 'uppercase',
                          }}
                        >
                          {log.action}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: '#6B7280' }}>
                          {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ color: '#FFFFFF', fontWeight: 500, fontSize: '0.8rem' }}>
                        {log.admin_email}
                      </div>
                      <div style={{ color: '#9CA3AF', fontSize: '0.72rem', marginTop: '2px' }}>
                        {log.details && typeof log.details === 'object'
                          ? JSON.stringify(log.details)
                          : String(log.details || 'No details')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
