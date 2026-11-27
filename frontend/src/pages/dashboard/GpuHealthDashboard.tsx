import { useState, useEffect, useMemo } from 'react'
import {
  Activity,
  Cpu,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Thermometer,
  Gauge,
  X,
  Play,
  Info,
  ShieldCheck,
  Search,
  Filter,
  Check,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  fetchFleetHealth,
  fetchGpuHealthReport,
  triggerGpuHealthCheck,
  checkGpuReadiness,
  fetchHealthAuditHistory,
  type FleetHealthSummary,
  type HealthReport,
  type HealthAuditRecord,
  type ReadinessResult,
  type GpuHealthStatus,
  type CheckStatus,
} from '../../lib/gpuHealthApi'

export default function GpuHealthDashboard() {
  usePageMeta(
    'GPU Health & Diagnostic Engine · Inferxe Admin',
    'Real-time GPU health diagnostics, 7-point capability check breakdown, fleet health telemetry, and audit history logs.',
  )

  // Top level state
  const [fleetSummary, setFleetSummary] = useState<FleetHealthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Active tab: 'fleet' | 'history' | 'readiness'
  const [activeTab, setActiveTab] = useState<'fleet' | 'history' | 'readiness'>('fleet')

  // Search & Filters for Fleet
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | GpuHealthStatus>('all')

  // Diagnostic Detail Modal
  const [selectedGpuId, setSelectedGpuId] = useState<string | null>(null)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [activeReport, setActiveReport] = useState<HealthReport | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [triggeringCheck, setTriggeringCheck] = useState(false)

  // Audit History state
  const [historyRecords, setHistoryRecords] = useState<HealthAuditRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFilterGpu, setHistoryFilterGpu] = useState<string>('all')
  const [historyFilterStatus, setHistoryFilterStatus] = useState<string>('all')

  // Readiness Sandbox State
  const [readinessGpuId, setReadinessGpuId] = useState<string>('mock-gpu-0')
  const [minVramGb, setMinVramGb] = useState<number>(24)
  const [minComputeCap, setMinComputeCap] = useState<string>('8.0')
  const [requiredCuda, setRequiredCuda] = useState<string>('12.0')
  const [maxTemp, setMaxTemp] = useState<number>(85)
  const [readinessResult, setReadinessResult] = useState<ReadinessResult | null>(null)
  const [testingReadiness, setTestingReadiness] = useState(false)

  // Load Fleet Data
  const loadFleet = async (isManual = false) => {
    if (isManual) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await fetchFleetHealth()
      setFleetSummary(data)
      if (data?.gpus && data.gpus.length > 0 && !readinessGpuId) {
        setReadinessGpuId(data.gpus[0].gpu_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch fleet health telemetry')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Load History Data
  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const data = await fetchHealthAuditHistory({
        gpu_id: historyFilterGpu !== 'all' ? historyFilterGpu : undefined,
        status: historyFilterStatus !== 'all' ? historyFilterStatus : undefined,
        limit: 50,
      })
      setHistoryRecords(data.records)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    void loadFleet()
  }, [])

  useEffect(() => {
    if (activeTab === 'history') {
      void loadHistory()
    }
  }, [activeTab, historyFilterGpu, historyFilterStatus])

  // Open Diagnostic Report Modal
  const handleOpenReport = async (gpuId: string) => {
    setSelectedGpuId(gpuId)
    setReportModalOpen(true)
    setLoadingReport(true)
    setActiveReport(null)
    try {
      const report = await fetchGpuHealthReport(gpuId)
      setActiveReport(report)
    } catch (err) {
      console.error('Failed to fetch GPU report:', err)
    } finally {
      setLoadingReport(false)
    }
  }

  // Run On-demand diagnostic check
  const handleTriggerCheck = async (gpuId: string) => {
    setTriggeringCheck(true)
    try {
      const report = await triggerGpuHealthCheck(gpuId)
      setActiveReport(report)
      // refresh fleet list in background
      void loadFleet(true)
    } catch (err) {
      console.error('Failed to trigger check:', err)
    } finally {
      setTriggeringCheck(false)
    }
  }

  // Run Readiness evaluation
  const handleTestReadiness = async () => {
    if (!readinessGpuId) return
    setTestingReadiness(true)
    try {
      const res = await checkGpuReadiness(readinessGpuId, {
        min_vram_mb: minVramGb * 1024,
        min_compute_cap: minComputeCap || undefined,
        required_cuda_ver: requiredCuda || undefined,
        max_temp_c: maxTemp,
      })
      setReadinessResult(res)
    } catch (err) {
      console.error('Failed to check readiness:', err)
    } finally {
      setTestingReadiness(false)
    }
  }

  // Filtered GPUs for Fleet Table
  const filteredGpus = useMemo(() => {
    const list = fleetSummary?.gpus || []
    return list.filter((gpu) => {
      const matchesSearch =
        gpu.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        gpu.gpu_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        gpu.vendor.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStatus = statusFilter === 'all' || gpu.health_status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [fleetSummary, searchQuery, statusFilter])

  // Helper status badge styles
  const getStatusBadge = (status: GpuHealthStatus | CheckStatus) => {
    switch (status) {
      case 'healthy':
        return {
          bg: 'rgba(16, 185, 129, 0.15)',
          text: '#10B981',
          border: 'rgba(16, 185, 129, 0.3)',
          icon: <CheckCircle2 size={13} />,
          label: 'Healthy',
        }
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          text: '#F59E0B',
          border: 'rgba(245, 158, 11, 0.3)',
          icon: <AlertTriangle size={13} />,
          label: 'Warning',
        }
      case 'critical':
      case 'unavailable':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          text: '#EF4444',
          border: 'rgba(239, 68, 68, 0.3)',
          icon: <AlertCircle size={13} />,
          label: 'Critical',
        }
      case 'unsupported':
        return {
          bg: 'rgba(156, 163, 175, 0.15)',
          text: '#9CA3AF',
          border: 'rgba(156, 163, 175, 0.3)',
          icon: <Info size={13} />,
          label: 'Unsupported',
        }
      default:
        return {
          bg: 'rgba(107, 114, 128, 0.15)',
          text: '#9CA3AF',
          border: 'rgba(107, 114, 128, 0.3)',
          icon: <Info size={13} />,
          label: String(status),
        }
    }
  }

  // Calculate Fleet Score Average
  const averageHealthScore = useMemo(() => {
    const list = fleetSummary?.gpus || []
    if (!list.length) return 0
    const sum = list.reduce((acc, g) => acc + (g.health_score || 0), 0)
    return Math.round((sum / list.length) * 10) / 10
  }, [fleetSummary])

  return (
    <DashboardLayout
      pageTitle="GPU Health & Diagnostic Engine"
      breadcrumb={[
        { label: 'Platform Administration', to: '/dashboard' },
        { label: 'GPU Health Engine' },
      ]}
    >
      <div style={{ maxWidth: '1440px', margin: '0 auto', width: '100%', paddingBottom: '48px' }}>
        {/* ── Top Header Bar ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10B981',
                }}
              >
                <Activity size={20} />
              </div>
              <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#F9FAFB', margin: 0, letterSpacing: '-0.02em' }}>
                GPU Health & Diagnostic Engine
              </h1>
            </div>
            <p style={{ fontSize: '14px', color: '#9CA3AF', margin: 0 }}>
              Autonomous 7-point capability diagnostics, deployment readiness verification, and fleet-wide telemetry.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => loadFleet(true)}
              disabled={refreshing || loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                backgroundColor: '#1B2E24',
                color: '#10B981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: refreshing ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              <span>{refreshing ? 'Scanning Fleet...' : 'Refresh Fleet'}</span>
            </button>
          </div>
        </div>

        {/* ── Error Banner if any ── */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#FCA5A5',
              fontSize: '13px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Fleet KPI Cards ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          {/* Total GPUs */}
          <div
            style={{
              backgroundColor: '#121C16',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '500', color: '#9CA3AF' }}>Total GPUs Monitored</span>
              <Cpu size={18} color="#9CA3AF" />
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#F9FAFB' }}>
              {loading ? '...' : fleetSummary?.total_gpus ?? 0}
            </div>
            <div style={{ fontSize: '12px', color: '#10B981', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={12} /> Live telemetry connected
            </div>
          </div>

          {/* Healthy GPUs */}
          <div
            style={{
              backgroundColor: '#121C16',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '500', color: '#9CA3AF' }}>Healthy Nodes</span>
              <CheckCircle2 size={18} color="#10B981" />
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#10B981' }}>
              {loading ? '...' : fleetSummary?.healthy_gpus ?? 0}
            </div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
              {fleetSummary?.total_gpus
                ? `${Math.round(((fleetSummary.healthy_gpus || 0) / fleetSummary.total_gpus) * 100)}% fleet operational`
                : '100% operational'}
            </div>
          </div>

          {/* Warning / Throttled */}
          <div
            style={{
              backgroundColor: '#121C16',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '500', color: '#9CA3AF' }}>Degraded / Warning</span>
              <AlertTriangle size={18} color="#F59E0B" />
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#F59E0B' }}>
              {loading ? '...' : fleetSummary?.warning_gpus ?? 0}
            </div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
              Thermal or memory threshold alerts
            </div>
          </div>

          {/* Critical / Offline */}
          <div
            style={{
              backgroundColor: '#121C16',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '500', color: '#9CA3AF' }}>Critical / Offline</span>
              <AlertCircle size={18} color="#EF4444" />
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#EF4444' }}>
              {loading ? '...' : (fleetSummary?.critical_gpus ?? 0) + (fleetSummary?.offline_gpus ?? 0)}
            </div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
              Require immediate hardware attention
            </div>
          </div>

          {/* Fleet Health Score */}
          <div
            style={{
              backgroundColor: '#121C16',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '500', color: '#9CA3AF' }}>Fleet Score Average</span>
              <Gauge size={18} color="#10B981" />
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#F9FAFB' }}>
              {loading ? '...' : `${averageHealthScore}%`}
            </div>
            <div
              style={{
                height: '6px',
                width: '100%',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '3px',
                marginTop: '10px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${averageHealthScore}%`,
                  backgroundColor: averageHealthScore > 90 ? '#10B981' : averageHealthScore > 75 ? '#F59E0B' : '#EF4444',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Sub-Navigation Tabs ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: '24px',
            paddingBottom: '2px',
          }}
        >
          <button
            onClick={() => setActiveTab('fleet')}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'fleet' ? '2px solid #10B981' : '2px solid transparent',
              color: activeTab === 'fleet' ? '#10B981' : '#9CA3AF',
              fontWeight: activeTab === 'fleet' ? '600' : '500',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Cpu size={16} />
            <span>Fleet Health & Diagnostics</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'history' ? '2px solid #10B981' : '2px solid transparent',
              color: activeTab === 'history' ? '#10B981' : '#9CA3AF',
              fontWeight: activeTab === 'history' ? '600' : '500',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Clock size={16} />
            <span>Health Audit History</span>
          </button>

          <button
            onClick={() => setActiveTab('readiness')}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'readiness' ? '2px solid #10B981' : '2px solid transparent',
              color: activeTab === 'readiness' ? '#10B981' : '#9CA3AF',
              fontWeight: activeTab === 'readiness' ? '600' : '500',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldCheck size={16} />
            <span>Deployment Readiness Sandbox</span>
          </button>
        </div>

        {/* ════════════════ TAB 1: FLEET OVERVIEW & DIAGNOSTICS ════════════════ */}
        {activeTab === 'fleet' && (
          <div>
            {/* Search and Filters toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1', maxWidth: '420px' }}>
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Search size={15} style={{ position: 'absolute', left: '12px', color: '#6B7280' }} />
                  <input
                    type="text"
                    placeholder="Search GPU ID, Model name, or Vendor..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 36px',
                      backgroundColor: '#121C16',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#F9FAFB',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Filter size={15} color="#9CA3AF" />
                <span style={{ fontSize: '13px', color: '#9CA3AF' }}>Filter Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#121C16',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="healthy">Healthy Only</option>
                  <option value="warning">Warning / Throttled</option>
                  <option value="critical">Critical / Offline</option>
                </select>
              </div>
            </div>

            {/* Fleet GPU Table */}
            <div
              style={{
                backgroundColor: '#121C16',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#9CA3AF', backgroundColor: '#0B130E' }}>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>GPU ID & Model</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Vendor</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Health Status</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Health Score</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Temperature</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>VRAM Utilization</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Compute Load</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: '#9CA3AF' }}>
                          <RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto 8px', display: 'block' }} />
                          Scanning GPU hardware devices...
                        </td>
                      </tr>
                    ) : filteredGpus.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: '#9CA3AF' }}>
                          No GPUs match your current search criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredGpus.map((gpu) => {
                        const badge = getStatusBadge(gpu.health_status)
                        const memPct = gpu.memory_utilization_pct ?? 0
                        const vramUsedGb = ((gpu.memory_used_mb || 0) / 1024).toFixed(1)
                        const vramTotalGb = ((gpu.memory_total_mb || 0) / 1024).toFixed(0)

                        return (
                          <tr
                            key={gpu.gpu_id}
                            style={{
                              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                              transition: 'background-color 0.15s ease',
                            }}
                            className="hover:bg-[#16231C]"
                          >
                            {/* GPU ID & Name */}
                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ fontWeight: '600', color: '#F9FAFB' }}>{gpu.name}</div>
                              <div style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: 'monospace' }}>{gpu.gpu_id}</div>
                            </td>

                            {/* Vendor */}
                            <td style={{ padding: '14px 18px' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                  color: '#D1D5DB',
                                  fontSize: '11px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  fontWeight: '600',
                                }}
                              >
                                {gpu.vendor}
                              </span>
                            </td>

                            {/* Health Status */}
                            <td style={{ padding: '14px 18px' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '4px 10px',
                                  borderRadius: '9999px',
                                  backgroundColor: badge.bg,
                                  color: badge.text,
                                  border: `1px solid ${badge.border}`,
                                  fontSize: '12px',
                                  fontWeight: '600',
                                }}
                              >
                                {badge.icon}
                                <span>{badge.label}</span>
                              </span>
                            </td>

                            {/* Health Score */}
                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: '600', color: '#F9FAFB' }}>{gpu.health_score}%</span>
                                <div
                                  style={{
                                    width: '60px',
                                    height: '5px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${gpu.health_score}%`,
                                      height: '100%',
                                      backgroundColor: gpu.health_score > 90 ? '#10B981' : gpu.health_score > 75 ? '#F59E0B' : '#EF4444',
                                    }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Temperature */}
                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Thermometer
                                  size={14}
                                  color={(gpu.temperature_c ?? 0) > 80 ? '#EF4444' : (gpu.temperature_c ?? 0) > 70 ? '#F59E0B' : '#10B981'}
                                />
                                <span style={{ color: (gpu.temperature_c ?? 0) > 80 ? '#EF4444' : '#F9FAFB' }}>
                                  {gpu.temperature_c != null ? `${gpu.temperature_c.toFixed(1)} °C` : 'N/A'}
                                </span>
                              </div>
                            </td>

                            {/* Memory */}
                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ minWidth: '70px', fontSize: '12px', color: '#D1D5DB' }}>
                                  {vramUsedGb} / {vramTotalGb} GB
                                </div>
                                <div
                                  style={{
                                    width: '70px',
                                    height: '5px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${memPct}%`,
                                      height: '100%',
                                      backgroundColor: memPct > 85 ? '#EF4444' : memPct > 70 ? '#F59E0B' : '#10B981',
                                    }}
                                  />
                                </div>
                                <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{memPct.toFixed(0)}%</span>
                              </div>
                            </td>

                            {/* GPU Utilization */}
                            <td style={{ padding: '14px 18px' }}>
                              <span style={{ color: '#F9FAFB' }}>
                                {gpu.gpu_utilization_pct != null ? `${gpu.gpu_utilization_pct.toFixed(0)}%` : 'N/A'}
                              </span>
                            </td>

                            {/* Actions */}
                            <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                                <button
                                  onClick={() => handleOpenReport(gpu.gpu_id)}
                                  style={{
                                    padding: '6px 12px',
                                    backgroundColor: '#1B2E24',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    borderRadius: '6px',
                                    color: '#10B981',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                  title="View full 7-check breakdown"
                                >
                                  <Activity size={13} />
                                  <span>Diagnostics</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════ TAB 2: HEALTH AUDIT HISTORY ════════════════ */}
        {activeTab === 'history' && (
          <div>
            {/* Filters toolbar for History */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '13px', color: '#9CA3AF' }}>Filter GPU:</span>
                <select
                  value={historyFilterGpu}
                  onChange={(e) => setHistoryFilterGpu(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#121C16',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All GPUs</option>
                  {fleetSummary?.gpus?.map((g) => (
                    <option key={g.gpu_id} value={g.gpu_id}>
                      {g.name} ({g.gpu_id})
                    </option>
                  ))}
                </select>

                <span style={{ fontSize: '13px', color: '#9CA3AF', marginLeft: '8px' }}>Status:</span>
                <select
                  value={historyFilterStatus}
                  onChange={(e) => setHistoryFilterStatus(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#121C16',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="healthy">Healthy</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <button
                onClick={() => loadHistory()}
                disabled={historyLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  backgroundColor: '#1B2E24',
                  color: '#10B981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={13} className={historyLoading ? 'animate-spin' : ''} />
                <span>Refresh Log</span>
              </button>
            </div>

            {/* Audit History Table */}
            <div
              style={{
                backgroundColor: '#121C16',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#9CA3AF', backgroundColor: '#0B130E' }}>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Timestamp</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>GPU ID</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Status</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Health Score</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Temp</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>VRAM %</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Load %</th>
                      <th style={{ padding: '14px 18px', fontWeight: '600' }}>Checks Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyLoading ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: '#9CA3AF' }}>
                          <RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto 8px', display: 'block' }} />
                          Loading audit records...
                        </td>
                      </tr>
                    ) : historyRecords.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: '#9CA3AF' }}>
                          No audit records found matching selected filter.
                        </td>
                      </tr>
                    ) : (
                      historyRecords.map((rec) => {
                        const badge = getStatusBadge(rec.health_status)
                        const dateStr = new Date(rec.timestamp * 1000).toLocaleString()

                        return (
                          <tr
                            key={rec.id}
                            style={{
                              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            }}
                            className="hover:bg-[#16231C]"
                          >
                            <td style={{ padding: '14px 18px', color: '#D1D5DB' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Clock size={13} color="#9CA3AF" />
                                <span>{dateStr}</span>
                              </div>
                            </td>

                            <td style={{ padding: '14px 18px', fontFamily: 'monospace', color: '#10B981' }}>
                              {rec.gpu_id}
                            </td>

                            <td style={{ padding: '14px 18px' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  padding: '2px 8px',
                                  borderRadius: '9999px',
                                  backgroundColor: badge.bg,
                                  color: badge.text,
                                  border: `1px solid ${badge.border}`,
                                  fontSize: '11px',
                                  fontWeight: '600',
                                }}
                              >
                                {badge.icon}
                                {badge.label}
                              </span>
                            </td>

                            <td style={{ padding: '14px 18px', fontWeight: '600', color: '#F9FAFB' }}>
                              {rec.health_score}%
                            </td>

                            <td style={{ padding: '14px 18px', color: '#D1D5DB' }}>
                              {rec.temperature_c != null ? `${rec.temperature_c.toFixed(1)} °C` : 'N/A'}
                            </td>

                            <td style={{ padding: '14px 18px', color: '#D1D5DB' }}>
                              {rec.memory_utilization_pct != null ? `${rec.memory_utilization_pct.toFixed(0)}%` : 'N/A'}
                            </td>

                            <td style={{ padding: '14px 18px', color: '#D1D5DB' }}>
                              {rec.gpu_utilization_pct != null ? `${rec.gpu_utilization_pct.toFixed(0)}%` : 'N/A'}
                            </td>

                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {rec.checks_summary ? (
                                  Object.entries(rec.checks_summary).map(([chk, res]) => (
                                    <span
                                      key={chk}
                                      style={{
                                        fontSize: '10px',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        backgroundColor: res === 'healthy' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                        color: res === 'healthy' ? '#10B981' : '#F59E0B',
                                        border: `1px solid ${res === 'healthy' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
                                      }}
                                    >
                                      {chk}
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#9CA3AF' }}>Complete</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════ TAB 3: DEPLOYMENT READINESS SANDBOX ════════════════ */}
        {activeTab === 'readiness' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
            {/* Input Form */}
            <div
              style={{
                backgroundColor: '#121C16',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '24px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <ShieldCheck size={20} color="#10B981" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#F9FAFB' }}>
                  Workload Deployment Constraints
                </h3>
              </div>
              <p style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '20px' }}>
                Evaluate whether a specific GPU meets strict operational criteria before scheduling inference or model weights.
              </p>

              {/* Target GPU */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#D1D5DB', marginBottom: '6px' }}>
                  Target GPU Instance
                </label>
                <select
                  value={readinessGpuId}
                  onChange={(e) => setReadinessGpuId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: '#0B130E',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                >
                  {fleetSummary?.gpus?.map((g) => (
                    <option key={g.gpu_id} value={g.gpu_id}>
                      {g.name} ({g.gpu_id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Min VRAM */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#D1D5DB', marginBottom: '6px' }}>
                  Minimum Free VRAM (GB)
                </label>
                <input
                  type="number"
                  value={minVramGb}
                  onChange={(e) => setMinVramGb(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: '#0B130E',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              {/* CUDA Version */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#D1D5DB', marginBottom: '6px' }}>
                  Required Minimum CUDA Version
                </label>
                <input
                  type="text"
                  value={requiredCuda}
                  onChange={(e) => setRequiredCuda(e.target.value)}
                  placeholder="e.g. 12.0"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: '#0B130E',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Compute Capability */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#D1D5DB', marginBottom: '6px' }}>
                  Minimum Compute Capability
                </label>
                <input
                  type="text"
                  value={minComputeCap}
                  onChange={(e) => setMinComputeCap(e.target.value)}
                  placeholder="e.g. 8.0"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: '#0B130E',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Max Thermal Threshold */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#D1D5DB', marginBottom: '6px' }}>
                  Maximum Allowed Temperature (°C)
                </label>
                <input
                  type="number"
                  value={maxTemp}
                  onChange={(e) => setMaxTemp(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: '#0B130E',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#F9FAFB',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                onClick={handleTestReadiness}
                disabled={testingReadiness}
                style={{
                  width: '100%',
                  padding: '11px',
                  backgroundColor: '#10B981',
                  color: '#0B130E',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: testingReadiness ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {testingReadiness ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Evaluating Readiness Engine...</span>
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    <span>Run Deployment Readiness Check</span>
                  </>
                )}
              </button>
            </div>

            {/* Results Output */}
            <div
              style={{
                backgroundColor: '#121C16',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '24px',
              }}
            >
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#F9FAFB' }}>
                Evaluation Decision
              </h3>

              {readinessResult ? (
                <div>
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '10px',
                      backgroundColor: readinessResult.is_ready ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      border: `1px solid ${readinessResult.is_ready ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                      marginBottom: '20px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      {readinessResult.is_ready ? (
                        <CheckCircle2 size={24} color="#10B981" />
                      ) : (
                        <AlertCircle size={24} color="#EF4444" />
                      )}
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: readinessResult.is_ready ? '#10B981' : '#EF4444' }}>
                          {readinessResult.is_ready ? 'READY FOR DEPLOYMENT' : 'DEPLOYMENT CONFLICT DETECTED'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Status: {readinessResult.status}</div>
                      </div>
                    </div>

                    <ul style={{ margin: '12px 0 0 0', paddingLeft: '20px', fontSize: '13px', color: '#D1D5DB' }}>
                      {readinessResult.reasons.map((r, idx) => (
                        <li key={idx} style={{ marginBottom: '4px' }}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <h4 style={{ fontSize: '13px', fontWeight: '600', color: '#9CA3AF', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Evaluated Hardware Metrics
                  </h4>
                  <pre
                    style={{
                      backgroundColor: '#0B130E',
                      padding: '14px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#10B981',
                      overflowX: 'auto',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    {JSON.stringify(readinessResult.evaluated_metrics, null, 2)}
                  </pre>
                </div>
              ) : (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9CA3AF' }}>
                  <ShieldCheck size={36} color="#4B5563" style={{ margin: '0 auto 12px', display: 'block' }} />
                  Configure workload requirements on the left and click "Run Deployment Readiness Check" to inspect feasibility.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════ DIAGNOSTIC REPORT MODAL (7 CHECKS BREAKDOWN) ════════════════ */}
        {reportModalOpen && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              zIndex: 9999,
              backdropFilter: 'blur(4px)',
            }}
          >
            <div
              style={{
                backgroundColor: '#121C16',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '850px',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: '20px 24px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  position: 'sticky',
                  top: 0,
                  backgroundColor: '#121C16',
                  zIndex: 2,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#F9FAFB' }}>
                      {activeReport?.device_info?.name || selectedGpuId}
                    </h2>
                    {activeReport && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '3px 10px',
                          borderRadius: '9999px',
                          backgroundColor: getStatusBadge(activeReport.status).bg,
                          color: getStatusBadge(activeReport.status).text,
                          border: `1px solid ${getStatusBadge(activeReport.status).border}`,
                          fontSize: '12px',
                          fontWeight: '600',
                        }}
                      >
                        {getStatusBadge(activeReport.status).icon}
                        {getStatusBadge(activeReport.status).label} ({activeReport.score}%)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px', fontFamily: 'monospace' }}>
                    ID: {selectedGpuId} • Driver: {activeReport?.device_info?.driver_version || 'N/A'} • CUDA: {activeReport?.device_info?.cuda_version || 'N/A'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedGpuId && (
                    <button
                      onClick={() => handleTriggerCheck(selectedGpuId)}
                      disabled={triggeringCheck}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 12px',
                        backgroundColor: '#1B2E24',
                        color: '#10B981',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      <RefreshCw size={13} className={triggeringCheck ? 'animate-spin' : ''} />
                      <span>{triggeringCheck ? 'Re-checking...' : 'Re-run Checks'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setReportModalOpen(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#9CA3AF',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '6px',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div style={{ padding: '24px' }}>
                {loadingReport ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>
                    <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px', display: 'block' }} />
                    Running 7-point capability diagnostics on hardware...
                  </div>
                ) : activeReport ? (
                  <div>
                    {/* Recommendations Alert if any */}
                    {activeReport.recommendations?.length > 0 && (
                      <div
                        style={{
                          padding: '14px 16px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          marginBottom: '20px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#F59E0B', fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>
                          <AlertTriangle size={15} />
                          <span>Actionable Recommendations</span>
                        </div>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', fontSize: '13px', color: '#D1D5DB' }}>
                          {activeReport.recommendations.map((rec, idx) => (
                            <li key={idx}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* The 7 Checks Breakdown Grid */}
                    <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#9CA3AF', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Diagnostic Checks Breakdown (7 Checks)
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {activeReport.checks.map((chk) => {
                        const chkBadge = getStatusBadge(chk.status)
                        return (
                          <div
                            key={chk.name}
                            style={{
                              backgroundColor: '#0B130E',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: '8px',
                              padding: '14px 16px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    padding: '2px 8px',
                                    borderRadius: '9999px',
                                    backgroundColor: chkBadge.bg,
                                    color: chkBadge.text,
                                    border: `1px solid ${chkBadge.border}`,
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {chkBadge.icon}
                                  {chk.name}
                                </span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: '#F9FAFB' }}>
                                  {chk.message}
                                </span>
                              </div>

                              <span style={{ fontSize: '11px', color: '#6B7280', fontFamily: 'monospace' }}>
                                {chk.execution_time_ms.toFixed(1)} ms
                              </span>
                            </div>

                            {/* Check details & metrics */}
                            {chk.metrics && Object.keys(chk.metrics).length > 0 && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: '12px',
                                  marginTop: '8px',
                                  paddingTop: '8px',
                                  borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                                  fontSize: '12px',
                                  color: '#9CA3AF',
                                }}
                              >
                                {Object.entries(chk.metrics).map(([k, v]) => (
                                  <div key={k}>
                                    <span style={{ color: '#6B7280' }}>{k}: </span>
                                    <span style={{ color: '#D1D5DB', fontFamily: 'monospace' }}>
                                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {chk.recommendation && (
                              <div style={{ marginTop: '6px', fontSize: '12px', color: '#F59E0B' }}>
                                💡 {chk.recommendation}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#EF4444', textAlign: 'center', padding: '24px' }}>
                    Failed to load diagnostic details for this device.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
