import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Cpu,
  Database,
  Layers,
  LayoutGrid,
  List,
  LogIn,
  Percent,
  RefreshCw,
  Server,
  ShieldAlert,
  Thermometer,
  Zap,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { InteractiveTelemetryGraph } from '../../../components/dashboard/InteractiveTelemetryGraph'
import {
  InteractivePriceHistoryChart,
  type GpuModel,
  type PriceHistoryRange,
} from '../../../components/dashboard/InteractivePriceHistoryChart'
import {
  SovereignNodesMap,
  type NodeHealthStatus,
} from '../../../components/dashboard/SovereignNodesMap'
import { GpuNodeHealthCard } from '../../../components/dashboard/GpuNodeHealthCard'
import { GpuHourlyRateEditor } from '../../../components/dashboard/GpuHourlyRateEditor'
import { usePageMeta } from '../../../lib/hooks'
import {
  clearSession,
  getAuthenticatedPortalRole,
  getSession,
  type AuthSession,
  type PortalRole,
  type SuperadminTelemetryData,
} from '../../../lib/authStore'
import {
  GPU_PRICING_PERSISTENCE_CONFIG,
  fetchGpuInfrastructureTelemetry,
  mapClustersToMapNodes,
  mapClustersToNodeHealthCards,
  mapClustersToPricingTargets,
  resolveLiveRateForGpuModel,
  updateGpuHourlyRate,
  type InfrastructureDataSource,
} from '../../../lib/gpuInfrastructureService'

type ErrorCategory = 'unauthorized' | 'forbidden' | 'unavailable' | 'generic' | null
type NodeViewMode = 'cards' | 'table'

export default function InfrastructureTelemetry() {
  usePageMeta(
    'GPU Infrastructure & Pricing Telemetry · Inferxe Superadmin',
    'Sovereign GPU cluster capacity, node health telemetry, regional topology, and Super Admin hourly rate governance.',
  )

  const navigate = useNavigate()
  const [session, setSession] = useState<AuthSession | null>(() => getSession())
  const [telemetry, setTelemetry] = useState<SuperadminTelemetryData | null>(null)
  const [dataSource, setDataSource] = useState<InfrastructureDataSource>('demo')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCategory, setErrorCategory] = useState<ErrorCategory>(null)

  // Interactive filters
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all')
  const [healthFilter, setHealthFilter] = useState<'all' | NodeHealthStatus>('all')
  const [nodeViewMode, setNodeViewMode] = useState<NodeViewMode>('cards')
  const [selectedMapClusterId, setSelectedMapClusterId] = useState<string | null>(null)
  const [priceGpu, setPriceGpu] = useState<GpuModel>('H100')
  const [priceRange, setPriceRange] = useState<PriceHistoryRange>('30d')

  useEffect(() => {
    const syncSession = () => setSession(getSession())
    window.addEventListener('inferxe_auth_change', syncSession)
    window.addEventListener('storage', syncSession)
    return () => {
      window.removeEventListener('inferxe_auth_change', syncSession)
      window.removeEventListener('storage', syncSession)
    }
  }, [])

  const authenticatedRole: PortalRole = getAuthenticatedPortalRole(session)
  const isSuperAdmin = authenticatedRole === 'superadmin'

  const loadTelemetry = useCallback(async () => {
    setLoading(true)
    setError(null)
    setErrorCategory(null)

    const res = await fetchGpuInfrastructureTelemetry()
    if (res.ok && res.telemetry) {
      setTelemetry(res.telemetry)
      setDataSource(res.dataSource ?? 'demo')
    } else {
      setTelemetry(null)
      setError(res.error || 'Failed to retrieve GPU infrastructure telemetry.')
      if (res.unauthorized || res.status === 401) {
        setErrorCategory('unauthorized')
      } else if (res.forbidden || res.status === 403) {
        setErrorCategory('forbidden')
      } else if (res.serviceUnavailable || res.status === 503) {
        setErrorCategory('unavailable')
      } else {
        setErrorCategory('generic')
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadTelemetry()
  }, [loadTelemetry, session?.token])

  const handleSignInAgain = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  const clusters = telemetry?.clusters ?? []

  // Strictly derived KPI figures from backend payload (zero hardcoded fallbacks)
  const kpiMetrics = useMemo(() => {
    if (!telemetry) return null
    const totalNodes = clusters.reduce((sum, c) => sum + c.totalNodes, 0)
    const activeNodes = clusters.reduce((sum, c) => sum + c.activeNodes, 0)
    const totalGpus = telemetry.summary.totalGpuCount
    const allocatedGpus = telemetry.summary.allocatedGpuCount
    const availableGpus = Math.max(0, totalGpus - allocatedGpus)
    const avgMarginPct =
      clusters.length > 0
        ? Number(
            (clusters.reduce((sum, c) => sum + c.marginPct, 0) / clusters.length).toFixed(1),
          )
        : null
    const uniqueRegions = Array.from(new Set(clusters.map((c) => c.region)))

    return {
      totalVramGb: telemetry.summary.totalVramGb,
      usedVramGb: telemetry.summary.usedVramGb,
      utilizationPct: telemetry.summary.utilizationPct,
      totalNodes,
      activeNodes,
      totalGpus,
      allocatedGpus,
      availableGpus,
      avgMarginPct,
      averageLatencyMs: telemetry.summary.averageLatencyMs,
      clusterCount: clusters.length,
      regionCount: uniqueRegions.length,
    }
  }, [telemetry, clusters])

  const allNodeCards = useMemo(
    () => mapClustersToNodeHealthCards(clusters, dataSource),
    [clusters, dataSource],
  )

  const filteredNodeCards = useMemo(() => {
    return allNodeCards.filter((card) => {
      if (selectedClusterId !== 'all' && card.clusterId !== selectedClusterId) return false
      if (healthFilter !== 'all' && card.status !== healthFilter) return false
      return true
    })
  }, [allNodeCards, selectedClusterId, healthFilter])

  const filteredClusters = useMemo(() => {
    return selectedClusterId === 'all'
      ? clusters
      : clusters.filter((c) => c.id === selectedClusterId)
  }, [clusters, selectedClusterId])

  const mapNodes = useMemo(
    () => mapClustersToMapNodes(clusters, telemetry?.summary.averageLatencyMs),
    [clusters, telemetry?.summary.averageLatencyMs],
  )

  const pricingTargets = useMemo(() => mapClustersToPricingTargets(clusters), [clusters])

  const liveRateForSelectedGpu = useMemo(
    () => resolveLiveRateForGpuModel(clusters, priceGpu, dataSource),
    [clusters, priceGpu, dataSource],
  )

  const handleMapSelect = (clusterId: string | null) => {
    setSelectedMapClusterId(clusterId)
    setSelectedClusterId(clusterId ?? 'all')
  }

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
            marginBottom: '20px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                GPU Infrastructure &amp; Pricing Governance
              </h1>
              {telemetry && dataSource === 'demo' && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 9px',
                    borderRadius: '999px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    background: 'rgba(245, 158, 11, 0.16)',
                    color: '#F59E0B',
                    border: '1px solid rgba(245, 158, 11, 0.38)',
                  }}
                >
                  <Database size={11} />
                  DEMO DATA
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.84rem' }}>
              Cluster capacity overview, GPU node health cards, telemetry graphs, regional topology, and Super Admin hourly rate controls.
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
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>{loading ? 'Syncing...' : 'Refresh Telemetry'}</span>
            </button>
          </div>
        </div>

        {/* ── Demo Telemetry Disclosure Banner (Only when backend returns non-live sample data) ── */}
        {telemetry && dataSource === 'demo' && (
          <div
            role="status"
            style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.32)',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              fontSize: '0.8rem',
              color: '#FDE68A',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Database size={16} style={{ color: '#F59E0B', flexShrink: 0 }} />
              <span>
                <strong>DEMO DATA:</strong> Cluster capacity, hardware metrics, and historical price charts are currently displaying illustrative sample data until Phase 3 connects live GPU inventory and hardware telemetry probes.
              </span>
            </div>
          </div>
        )}

        {/* ── Fail-Closed Auth / Service Error Panel (Never render fabricated KPI metrics) ── */}
        {error && !telemetry && (
          <div
            role="alert"
            style={{
              background:
                errorCategory === 'unauthorized' || errorCategory === 'forbidden'
                  ? 'rgba(245, 158, 11, 0.08)'
                  : '#2B1214',
              border: `1px solid ${
                errorCategory === 'unauthorized' || errorCategory === 'forbidden'
                  ? 'rgba(245, 158, 11, 0.4)'
                  : '#7F1D1D'
              }`,
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              {errorCategory === 'forbidden' ? (
                <ShieldAlert size={22} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 2 }} />
              ) : (
                <AlertCircle
                  size={22}
                  style={{
                    color: errorCategory === 'unauthorized' ? '#F59E0B' : '#EF4444',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                />
              )}
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {errorCategory === 'unauthorized'
                    ? 'Super Admin Authentication Required'
                    : errorCategory === 'forbidden'
                      ? 'Super Admin Role Required'
                      : 'GPU Infrastructure Telemetry Unavailable'}
                </h2>
                <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: '#E5E7EB', lineHeight: 1.5 }}>
                  {error}
                </p>
                <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: '#9CA3AF' }}>
                  Infrastructure KPI cards and cluster health panels are hidden while telemetry is unavailable so fabricated values are never presented as real data.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {(errorCategory === 'unauthorized' || errorCategory === 'forbidden') && (
                <button
                  type="button"
                  onClick={handleSignInAgain}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#FBBF24',
                    color: '#040D08',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 14px',
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
                onClick={() => void loadTelemetry()}
                disabled={loading}
                style={{
                  background: '#121C16',
                  border: '1px solid #23382C',
                  color: '#E5E7EB',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Initial Loading State ── */}
        {loading && !telemetry && !error && (
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '48px 24px',
              textAlign: 'center',
              color: '#9CA3AF',
              marginBottom: '24px',
            }}
          >
            <RefreshCw size={22} className="spin-icon" style={{ color: '#10B981', margin: '0 auto 10px' }} />
            <div style={{ fontWeight: 600, color: '#FFFFFF', fontSize: '0.94rem' }}>
              Loading GPU infrastructure telemetry...
            </div>
            <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
              Verifying Super Admin session and retrieving cluster capacity and pricing data.
            </div>
          </div>
        )}

        {/* ── Verified Infrastructure Content ── */}
        {telemetry && kpiMetrics && (
          <>
            {/* 1. Infrastructure KPI Cards (100% derived from backend payload) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
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
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                    Total VRAM Capacity
                  </span>
                  <Layers size={16} style={{ color: '#00FF88' }} />
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {kpiMetrics.totalVramGb.toLocaleString()} GB
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6EE7B7', marginTop: '4px' }}>
                  {kpiMetrics.usedVramGb.toLocaleString()} GB allocated ({kpiMetrics.utilizationPct}%)
                  {dataSource === 'demo' ? ' · Demo' : ''}
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
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                    Online Cluster Nodes
                  </span>
                  <Server size={16} style={{ color: '#38BDF8' }} />
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {kpiMetrics.activeNodes} / {kpiMetrics.totalNodes}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#38BDF8', marginTop: '4px' }}>
                  {kpiMetrics.clusterCount} cluster{kpiMetrics.clusterCount === 1 ? '' : 's'} · {kpiMetrics.regionCount} region{kpiMetrics.regionCount === 1 ? '' : 's'}
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
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                    GPU Fleet Availability
                  </span>
                  <Cpu size={16} style={{ color: '#10B981' }} />
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {kpiMetrics.availableGpus} / {kpiMetrics.totalGpus}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#10B981', marginTop: '4px' }}>
                  {kpiMetrics.allocatedGpus} GPUs currently allocated
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
                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                    Avg Margin &amp; Latency
                  </span>
                  <Percent size={16} style={{ color: '#FBBF24' }} />
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#FFFFFF' }}>
                  {kpiMetrics.avgMarginPct !== null ? `${kpiMetrics.avgMarginPct}%` : '—'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#FBBF24', marginTop: '4px' }}>
                  Avg inter-cluster latency: {kpiMetrics.averageLatencyMs} ms
                </div>
              </div>
            </div>

            {/* 2. Interactive Telemetry Graph (Shared Component) */}
            <div style={{ marginBottom: '24px' }}>
              <InteractiveTelemetryGraph
                dataSource="demo"
                title="Cluster Hardware Telemetry"
                subtitle="GPU Utilization · VRAM · Thermal · Power"
              />
            </div>

            {/* 3. GPU Node Health Cards Section */}
            <div style={{ marginBottom: '28px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  marginBottom: '14px',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 700, color: '#FFFFFF' }}>
                    GPU Node Health &amp; Capacity ({filteredNodeCards.length})
                  </h2>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#9CA3AF' }}>
                    Inspect per-cluster GPU models, capacity, VRAM footprint, thermal headroom, and power draw.
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {(['all', 'Healthy', 'Degraded', 'Maintenance'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setHealthFilter(status)}
                      style={{
                        background: healthFilter === status ? '#10B981' : '#0F1612',
                        color: healthFilter === status ? '#040D08' : '#D1D5DB',
                        border: `1px solid ${healthFilter === status ? '#10B981' : '#1B2E24'}`,
                        borderRadius: '6px',
                        padding: '5px 11px',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {status === 'all' ? 'All Health' : status}
                    </button>
                  ))}

                  <div style={{ display: 'inline-flex', border: '1px solid #1B2E24', borderRadius: '6px', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => setNodeViewMode('cards')}
                      aria-label="Card view"
                      style={{
                        background: nodeViewMode === 'cards' ? '#12271D' : '#0F1612',
                        color: nodeViewMode === 'cards' ? '#10B981' : '#9CA3AF',
                        border: 'none',
                        padding: '6px 10px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      <LayoutGrid size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setNodeViewMode('table')}
                      aria-label="Table view"
                      style={{
                        background: nodeViewMode === 'table' ? '#12271D' : '#0F1612',
                        color: nodeViewMode === 'table' ? '#10B981' : '#9CA3AF',
                        border: 'none',
                        padding: '6px 10px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      <List size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Cluster Filter Tabs */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClusterId('all')
                    setSelectedMapClusterId(null)
                  }}
                  style={{
                    background: selectedClusterId === 'all' ? '#10B981' : '#0F1612',
                    color: selectedClusterId === 'all' ? '#040D08' : '#D1D5DB',
                    border: '1px solid #1B2E24',
                    borderRadius: '6px',
                    padding: '6px 14px',
                    fontSize: '0.78rem',
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
                    onClick={() => {
                      setSelectedClusterId(c.id)
                      setSelectedMapClusterId(c.id)
                    }}
                    style={{
                      background: selectedClusterId === c.id ? '#10B981' : '#0F1612',
                      color: selectedClusterId === c.id ? '#040D08' : '#D1D5DB',
                      border: '1px solid #1B2E24',
                      borderRadius: '6px',
                      padding: '6px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              {nodeViewMode === 'cards' ? (
                filteredNodeCards.length === 0 ? (
                  <div
                    style={{
                      background: '#0F1612',
                      border: '1px dashed #23382C',
                      borderRadius: '12px',
                      padding: '36px 20px',
                      textAlign: 'center',
                      color: '#9CA3AF',
                      fontSize: '0.84rem',
                    }}
                  >
                    No GPU nodes match the selected cluster and health filters.
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                      gap: '16px',
                    }}
                  >
                    {filteredNodeCards.map((node) => (
                      <GpuNodeHealthCard key={node.id} node={node} />
                    ))}
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {filteredClusters.map((cluster) => (
                    <div
                      key={cluster.id}
                      style={{
                        background: '#0F1612',
                        border: '1px solid #1B2E24',
                        borderRadius: '12px',
                        padding: '20px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '10px',
                          marginBottom: '14px',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Server size={16} style={{ color: '#10B981' }} />
                            <strong style={{ color: '#FFFFFF', fontSize: '1rem' }}>{cluster.name}</strong>
                          </div>
                          <div style={{ color: '#9CA3AF', fontSize: '0.76rem', marginTop: 2 }}>
                            {cluster.provider} · {cluster.region} · {cluster.activeNodes}/{cluster.totalNodes} Nodes Active · {cluster.uptime} SLA
                          </div>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#6EE7B7', fontFamily: 'var(--font-mono)' }}>
                          Spot: ₹{cluster.spotRateHour}/hr · On-Demand: ₹{cluster.onDemandRateHour}/hr · Margin: {cluster.marginPct}%
                        </div>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                          <thead>
                            <tr style={{ background: '#0B130F', borderBottom: '1px solid #1B2E24' }}>
                              <th style={{ padding: '10px 14px', color: '#E5E7EB', fontSize: '0.72rem', textTransform: 'uppercase' }}>GPU Model</th>
                              <th style={{ padding: '10px 14px', color: '#E5E7EB', fontSize: '0.72rem', textTransform: 'uppercase' }}>Allocation</th>
                              <th style={{ padding: '10px 14px', color: '#E5E7EB', fontSize: '0.72rem', textTransform: 'uppercase' }}>VRAM Utilization</th>
                              <th style={{ padding: '10px 14px', color: '#E5E7EB', fontSize: '0.72rem', textTransform: 'uppercase' }}>Avg Temperature</th>
                              <th style={{ padding: '10px 14px', color: '#E5E7EB', fontSize: '0.72rem', textTransform: 'uppercase' }}>Power Draw</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cluster.gpus.map((gpu, idx) => {
                              const vramPct =
                                gpu.vramTotalGb > 0
                                  ? Math.round((gpu.vramUsedGb / gpu.vramTotalGb) * 100)
                                  : 0
                              return (
                                <tr key={idx} style={{ borderBottom: '1px solid #152219' }}>
                                  <td style={{ padding: '11px 14px', color: '#FFFFFF', fontWeight: 600 }}>
                                    {gpu.type}
                                  </td>
                                  <td style={{ padding: '11px 14px', color: '#E5E7EB' }}>
                                    {gpu.allocated} / {gpu.total} ({gpu.total > 0 ? Math.round((gpu.allocated / gpu.total) * 100) : 0}%)
                                  </td>
                                  <td style={{ padding: '11px 14px', color: '#E5E7EB' }}>
                                    {gpu.vramUsedGb.toLocaleString()} / {gpu.vramTotalGb.toLocaleString()} GB ({vramPct}%)
                                  </td>
                                  <td style={{ padding: '11px 14px', color: '#D1D5DB' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      <Thermometer size={13} style={{ color: gpu.avgTempC >= 75 ? '#EF4444' : '#10B981' }} />
                                      {gpu.avgTempC}°C
                                    </span>
                                  </td>
                                  <td style={{ padding: '11px 14px', color: '#D1D5DB' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      <Zap size={13} style={{ color: '#FBBF24' }} />
                                      {gpu.powerW} W/unit
                                    </span>
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
              )}
            </div>

            {/* 4. Super Admin Hourly Rate Editor */}
            <div style={{ marginBottom: '28px' }}>
              <GpuHourlyRateEditor
                targets={pricingTargets}
                isSuperAdmin={isSuperAdmin}
                persistenceAvailable={GPU_PRICING_PERSISTENCE_CONFIG.backendPersistenceAvailable}
                pendingMessage={GPU_PRICING_PERSISTENCE_CONFIG.pendingReason}
                plannedEndpoint={GPU_PRICING_PERSISTENCE_CONFIG.plannedEndpoint}
                dataSource={dataSource}
                onSubmitRateChange={updateGpuHourlyRate}
              />
            </div>

            {/* 5. Interactive Price History Chart (Shared Component) */}
            <div style={{ marginBottom: '28px' }}>
              <InteractivePriceHistoryChart
                gpu={priceGpu}
                range={priceRange}
                onGpuChange={setPriceGpu}
                onRangeChange={setPriceRange}
                currentHourlyRate={liveRateForSelectedGpu}
                dataSource="demo"
                showDeployAction={false}
              />
            </div>

            {/* 6. Sovereign Nodes Map (Shared Component) */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 700, color: '#FFFFFF' }}>
                  Cluster Regional Topology &amp; Node Health
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#9CA3AF' }}>
                  Select any datacenter marker or region row to filter the cluster health cards above.
                </p>
              </div>
              <SovereignNodesMap
                nodes={mapNodes}
                dataSource={dataSource}
                selectedCountryId={selectedMapClusterId}
                onSelectCountry={handleMapSelect}
              />
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
