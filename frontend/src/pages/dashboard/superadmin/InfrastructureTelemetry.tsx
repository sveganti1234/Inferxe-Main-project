import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Cpu,
  Server,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Zap,
  Thermometer,
  Layers,
  Percent,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  fetchSuperadminTelemetry,
  type SuperadminTelemetryData,
} from '../../../lib/authStore'

export default function InfrastructureTelemetry() {
  usePageMeta(
    'GPU Infrastructure & Pricing Telemetry · Inferxe Superadmin',
    'Real-time sovereign cluster monitoring, VRAM allocations, node thermals, and dynamic spot vs on-demand pricing analytics.',
  )

  const [telemetry, setTelemetry] = useState<SuperadminTelemetryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all')

  const loadTelemetry = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchSuperadminTelemetry()
      if (res.ok && res.telemetry) {
        setTelemetry(res.telemetry)
      } else {
        setError(res.error || 'Failed to retrieve GPU cluster telemetry.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading cluster telemetry.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTelemetry()
  }, [])

  const clusters = telemetry?.clusters || []
  const filteredClusters =
    selectedClusterId === 'all'
      ? clusters
      : clusters.filter((c) => c.id === selectedClusterId)

  return (
    <DashboardLayout
      pageTitle="Global GPU Infrastructure & Pricing Telemetry"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/superadmin' },
        { label: 'GPU Infrastructure' },
      ]}
    >
      <div style={{ maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {/* ── Top Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Link
                to="/dashboard/superadmin"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#9CA3AF',
                  fontSize: '0.78rem',
                  textDecoration: 'none',
                }}
              >
                <ArrowLeft size={13} /> Back to Overview
              </Link>
            </div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: '#FFFFFF',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              GPU Cluster Telemetry & Pricing Analytics
            </h1>
            <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.84rem' }}>
              Real-time hardware utilization, multi-datacenter VRAM status, temperature thresholds, and arbitrage margins.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadTelemetry()}
              disabled={loading}
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
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>Refresh Telemetry</span>
            </button>
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
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Top Metric Highlights ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Total VRAM Capacity
              </span>
              <Layers size={16} style={{ color: '#00FF88' }} />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#FFFFFF' }}>
              {(telemetry?.summary.totalVramGb ?? 12608).toLocaleString()} GB
            </div>
            <div style={{ fontSize: '0.76rem', color: '#6EE7B7', marginTop: '4px' }}>
              {(telemetry?.summary.usedVramGb ?? 10702).toLocaleString()} GB Allocated ({telemetry?.summary.utilizationPct ?? 86.6}%)
            </div>
          </div>

          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Online Datacenter Nodes
              </span>
              <Server size={16} style={{ color: '#38BDF8' }} />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#FFFFFF' }}>
              52 Nodes Active
            </div>
            <div style={{ fontSize: '0.76rem', color: '#38BDF8', marginTop: '4px' }}>
              3 Indian Datacenters (KA, MH, IN-Central)
            </div>
          </div>

          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Average Gross Margin
              </span>
              <Percent size={16} style={{ color: '#10B981' }} />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#FFFFFF' }}>
              23.6%
            </div>
            <div style={{ fontSize: '0.76rem', color: '#10B981', marginTop: '4px' }}>
              Spot routing arbitrage optimization
            </div>
          </div>

          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Inter-Cluster Latency
              </span>
              <Zap size={16} style={{ color: '#FBBF24' }} />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#FFFFFF' }}>
              {telemetry?.summary.averageLatencyMs ?? 14.2} ms
            </div>
            <div style={{ fontSize: '0.76rem', color: '#FBBF24', marginTop: '4px' }}>
              NIXI sovereign peering backbone
            </div>
          </div>
        </div>

        {/* ── Filter Cluster Tabs ── */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSelectedClusterId('all')}
            style={{
              background: selectedClusterId === 'all' ? '#10B981' : '#0F1612',
              color: selectedClusterId === 'all' ? '#040D08' : '#D1D5DB',
              border: '1px solid #1B2E24',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            All Clusters ({clusters.length})
          </button>
          {clusters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedClusterId(c.id)}
              style={{
                background: selectedClusterId === c.id ? '#10B981' : '#0F1612',
                color: selectedClusterId === c.id ? '#040D08' : '#D1D5DB',
                border: '1px solid #1B2E24',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* ── Clusters Detailed Cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '24px' }}>
          {filteredClusters.map((cluster) => (
            <div
              key={cluster.id}
              style={{
                background: '#0F1612',
                border: '1px solid #1B2E24',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '18px',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Server size={18} style={{ color: '#10B981' }} />
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                      {cluster.name}
                    </h2>
                    <span
                      style={{
                        background: 'rgba(16, 185, 129, 0.12)',
                        color: '#10B981',
                        border: '1px solid rgba(16, 185, 129, 0.25)',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      {cluster.uptime} SLA
                    </span>
                  </div>
                  <div style={{ color: '#9CA3AF', fontSize: '0.8rem', marginTop: '4px' }}>
                    Provider: <strong style={{ color: '#E5E7EB' }}>{cluster.provider}</strong> • Region: <strong style={{ color: '#E5E7EB' }}>{cluster.region}</strong> • {cluster.activeNodes}/{cluster.totalNodes} Nodes Active
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#121C16', padding: '8px 16px', borderRadius: '8px', border: '1px solid #1B2E24' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Spot Pricing</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10B981' }}>₹{cluster.spotRateHour}/hr</div>
                  </div>
                  <div style={{ width: '1px', height: '24px', background: '#23382C' }} />
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase' }}>On-Demand</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF' }}>₹{cluster.onDemandRateHour}/hr</div>
                  </div>
                  <div style={{ width: '1px', height: '24px', background: '#23382C' }} />
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Margin</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#00FF88' }}>{cluster.marginPct}%</div>
                  </div>
                </div>
              </div>

              {/* Hardware Units Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#0B130F', borderBottom: '1px solid #1B2E24' }}>
                      <th style={{ padding: '10px 14px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>GPU Model</th>
                      <th style={{ padding: '10px 14px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>Allocation</th>
                      <th style={{ padding: '10px 14px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>VRAM Utilization</th>
                      <th style={{ padding: '10px 14px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>Avg Temperature</th>
                      <th style={{ padding: '10px 14px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>Power Draw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cluster.gpus.map((gpu, idx) => {
                      const vramPct = Math.round((gpu.vramUsedGb / gpu.vramTotalGb) * 100)
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #152219' }}>
                          <td style={{ padding: '12px 14px', color: '#FFFFFF', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Cpu size={15} style={{ color: '#00FF88' }} />
                              <span>{gpu.type}</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', color: '#E5E7EB' }}>
                            {gpu.allocated} / {gpu.total} units ({Math.round((gpu.allocated / gpu.total) * 100)}%)
                          </td>
                          <td style={{ padding: '12px 14px', minWidth: '180px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '4px' }}>
                              <span style={{ color: '#E5E7EB' }}>{gpu.vramUsedGb} GB</span>
                              <span style={{ color: '#9CA3AF' }}>{gpu.vramTotalGb} GB ({vramPct}%)</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: '#121C16', borderRadius: '3px', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${vramPct}%`,
                                  height: '100%',
                                  background: vramPct > 90 ? '#EF4444' : vramPct > 75 ? '#10B981' : '#38BDF8',
                                  borderRadius: '3px',
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', color: '#D1D5DB' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Thermometer size={14} style={{ color: gpu.avgTempC > 70 ? '#EF4444' : '#10B981' }} />
                              <span>{gpu.avgTempC}°C</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', color: '#D1D5DB' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Zap size={14} style={{ color: '#FBBF24' }} />
                              <span>{gpu.powerW} W/unit</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}
