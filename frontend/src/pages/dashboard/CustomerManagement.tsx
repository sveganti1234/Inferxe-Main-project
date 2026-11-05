import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  RefreshCw,
  Database,
  Users,
  Radio,
  Clock,
  UserCheck,
  UserX,
  Eye,
  X,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Building2,
  Phone,
  Calendar,
  Activity,
  Download,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { Tilt } from '../../components/ui/Tilt'
import { Counter } from '../../components/ui/Counter'
import { usePageMeta } from '../../lib/hooks'
import {
  fetchCustomers,
  fetchCustomerSummary,
  fetchCustomerDetails,
  createDatabaseBackup,
  exportCustomersCsv,
  syncCognitoCustomers,
  type CustomerRecord,
  type CustomerDetailsRecord,
  type CustomerSummary,
  type ActivityStatus,
} from '../../lib/customerService'

function formatDateTime(isoStr?: string | null): string {
  if (!isoStr) return 'Never'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return isoStr
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return isoStr || 'Never'
  }
}

function formatRelativeTime(isoStr?: string | null): string {
  if (!isoStr) return 'Never'
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime()
    if (isNaN(diffMs)) return isoStr
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 30) return 'Just now'
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    return `${diffDays} days ago`
  } catch {
    return isoStr || 'Never'
  }
}

export default function CustomerManagement() {
  usePageMeta('Customer Management · Inferxe Super Admin', 'Centralized customer database, live online presence tracking, and 5-day activity monitor.')

  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [summary, setSummary] = useState<CustomerSummary>({ total: 0, online: 0, active: 0, inactive: 0 })
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'active' | 'inactive'>('all')
  const [sortBy, setSortBy] = useState<'registration_date' | 'last_active' | 'full_name'>('registration_date')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [page, setPage] = useState<number>(1)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [pageSize, setPageSize] = useState<number>(20)

  // Detail Drawer State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [detailsRecord, setDetailsRecord] = useState<CustomerDetailsRecord | null>(null)
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false)

  // Backup & UI state
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)

  const loadData = useCallback(async (showLoadingSpinner = true) => {
    if (showLoadingSpinner) setLoading(true)
    setError(null)
    try {
      const [listRes, summaryRes] = await Promise.all([
        fetchCustomers({
          search: searchQuery,
          status: statusFilter,
          sortBy,
          sortOrder,
          page,
          limit: pageSize,
        }),
        fetchCustomerSummary(),
      ])

      setCustomers(listRes.customers || [])
      setTotalPages(listRes.pagination.totalPages || 1)
      setTotalCount(listRes.pagination.total || 0)
      setSummary(summaryRes)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve customer data from centralized database.')
    } finally {
      if (showLoadingSpinner) setLoading(false)
    }
  }, [searchQuery, statusFilter, sortBy, sortOrder, page, pageSize])

  useEffect(() => {
    void loadData(true)
  }, [loadData])

  // Periodic Auto-Refresh (30 seconds)
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      void loadData(false)
    }, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, loadData])

  // Fetch full details when a customer is clicked
  useEffect(() => {
    if (!selectedCustomerId) {
      setDetailsRecord(null)
      return
    }

    let isMounted = true
    setDetailsLoading(true)
    fetchCustomerDetails(selectedCustomerId)
      .then((record) => {
        if (isMounted) setDetailsRecord(record)
      })
      .catch((err) => {
        console.error('Failed to load customer details:', err)
      })
      .finally(() => {
        if (isMounted) setDetailsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [selectedCustomerId])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleTriggerBackup = async () => {
    setIsBackingUp(true)
    setBackupMessage(null)
    try {
      const res = await createDatabaseBackup()
      setBackupMessage(`Database successfully backed up: ${res.backupFile} (${(res.sizeBytes / 1024).toFixed(1)} KB)`)
      setTimeout(() => setBackupMessage(null), 6000)
    } catch (err: unknown) {
      setBackupMessage(err instanceof Error ? `Backup error: ${err.message}` : 'Backup failed')
    } finally {
      setIsBackingUp(false)
    }
  }

  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)

  const handleExportCsv = async () => {
    try {
      setIsExporting(true)
      await exportCustomersCsv()
    } catch (err: unknown) {
      setError(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  const handleSyncCognito = async () => {
    try {
      setIsSyncing(true)
      let localUsers: Array<{ email: string; full_name?: string; organization?: string }> = []
      try {
        const raw = localStorage.getItem('inferxe_registered_users')
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, { fullName?: string; name?: string; organization?: string }>
          localUsers = Object.entries(parsed).map(([em, val]) => ({
            email: em,
            full_name: val.fullName || val.name,
            organization: val.organization,
          }))
        }
      } catch {}

      const res = await syncCognitoCustomers(localUsers)
      setBackupMessage(`Cognito Sync complete: ${res.syncedCount} records evaluated (${res.newCount} new, ${res.updatedCount} refreshed).`)
      setTimeout(() => setBackupMessage(null), 6000)
      await loadData(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? `Synchronization failed: ${err.message}` : 'Synchronization failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const renderStatusBadge = (status: ActivityStatus) => {
    switch (status) {
      case 'Online':
        return (
          <span className="cust-status-badge cust-status-badge--online">
            <span className="cust-pulse-dot" />
            <span>Online</span>
          </span>
        )
      case 'Active':
        return (
          <span className="cust-status-badge cust-status-badge--active">
            <UserCheck size={12} />
            <span>Active</span>
          </span>
        )
      case 'Inactive':
        return (
          <span className="cust-status-badge cust-status-badge--inactive">
            <UserX size={12} />
            <span>Inactive (5d+)</span>
          </span>
        )
      default:
        return <span className="cust-status-badge">{status}</span>
    }
  }

  return (
    <DashboardLayout
      pageTitle="Customer Management"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Customer Management' },
      ]}
      heading="Customer Database & Activity Monitor"
      description="Centralized customer profile store, real-time presence tracking, and 5-day inactivity monitor."
      backButtonTo="/dashboard"
      backButtonLabel="Back to Dashboard"
    >
      {/* ── Top Alert Banner if Backup Message Present ── */}
      {backupMessage && (
        <div className="dash-alert dash-alert--success" style={{ marginBottom: 16 }}>
          <Database size={16} />
          <span>{backupMessage}</span>
          <button type="button" onClick={() => setBackupMessage(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Bento Metrics Row (Summary Cards) ── */}
      <div className="dash-stats-row" style={{ marginBottom: 24 }}>
        {/* Total Customers */}
        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Total Customers</span>
              <Users size={16} style={{ color: 'var(--brand-hi)', opacity: 0.8 }} />
            </div>
            <div className="dash-stat-value readout">
              <Counter to={summary.total} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.74rem', marginTop: 4, display: 'block' }}>
              Persistent SQLite Database Records
            </small>
          </div>
        </Tilt>

        {/* Online Customers */}
        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift" style={{ borderLeft: '3px solid #76b900' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="cust-pulse-dot" style={{ display: 'inline-block' }} />
                Online Now
              </span>
              <Radio size={16} style={{ color: '#76b900' }} />
            </div>
            <div className="dash-stat-value readout" style={{ color: '#a3e635' }}>
              <Counter to={summary.online} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.74rem', marginTop: 4, display: 'block' }}>
              Heartbeat within previous 2 minutes
            </small>
          </div>
        </Tilt>

        {/* Active Customers */}
        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift" style={{ borderLeft: '3px solid #06b6d4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Active Clients</span>
              <Clock size={16} style={{ color: '#06b6d4' }} />
            </div>
            <div className="dash-stat-value readout" style={{ color: '#22d3ee' }}>
              <Counter to={summary.active} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.74rem', marginTop: 4, display: 'block' }}>
              Logged in within last 5 days
            </small>
          </div>
        </Tilt>

        {/* Inactive Customers */}
        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift" style={{ borderLeft: '3px solid #f59e0b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Inactive (5d+)</span>
              <UserX size={16} style={{ color: '#f59e0b' }} />
            </div>
            <div className="dash-stat-value readout" style={{ color: '#fbbf24' }}>
              <Counter to={summary.inactive} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.74rem', marginTop: 4, display: 'block' }}>
              Never hidden · Automatically retained
            </small>
          </div>
        </Tilt>
      </div>

      {/* ── Retention Notice Pill ── */}
      <div
        className="glass"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderRadius: 8,
          marginBottom: 20,
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--ink-3)' }}>
          <ShieldCheck size={16} style={{ color: '#76b900' }} />
          <span>
            <strong style={{ color: 'var(--ink)' }}>Persistent Customer Retention Policy:</strong> Inactive customers are retained permanently and never purged from the database. Activity statuses auto-update upon return.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="dash-btn-ghost"
            style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleTriggerBackup}
            disabled={isBackingUp}
            title="Create an instantaneous snapshot backup of database"
          >
            <Download size={13} />
            <span>{isBackingUp ? 'Backing Up...' : 'Backup Database'}</span>
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--ink-4)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Auto-refresh (30s)</span>
          </label>
        </div>
      </div>

      {/* ── Toolbar: Search, Status Tabs & Sorting ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {/* Left: Search & Filter Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flex: 1 }}>
          {/* Search Box */}
          <div className="dash-input-wrap well" style={{ width: '100%', maxWidth: '320px' }}>
            <span className="dash-input-prefix">
              <Search size={15} style={{ color: 'var(--ink-4)' }} />
            </span>
            <input
              type="text"
              className="dash-input dash-input-has-prefix"
              style={{ padding: '8px 12px 8px 34px', fontSize: '0.84rem' }}
              placeholder="Search by name, email, ID, org..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(1)
              }}
            />
          </div>

          {/* Filter Chips */}
          <div className="dash-presets-row" style={{ marginTop: 0 }}>
            {[
              { key: 'all', label: `All Customers (${summary.total})` },
              { key: 'online', label: `Online (${summary.online})` },
              { key: 'active', label: `Active (${summary.active})` },
              { key: 'inactive', label: `Inactive (${summary.inactive})` },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                className={`dash-preset-chip ${statusFilter === f.key ? 'is-active' : ''}`}
                onClick={() => {
                  setStatusFilter(f.key as any)
                  setPage(1)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Sorting & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="dash-input"
            style={{ padding: '6px 12px', fontSize: '0.8rem', width: 'auto', background: 'var(--surface-well)' }}
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [sb, so] = e.target.value.split(':') as [any, any]
              setSortBy(sb)
              setSortOrder(so)
              setPage(1)
            }}
          >
            <option value="registration_date:desc">Newest Registered</option>
            <option value="registration_date:asc">Oldest Registered</option>
            <option value="last_active:desc">Recently Active</option>
            <option value="last_active:asc">Least Recently Active</option>
            <option value="full_name:asc">Name (A-Z)</option>
          </select>

          <button
            type="button"
            className="dash-btn-ghost"
            style={{ padding: '8px 12px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleSyncCognito}
            disabled={isSyncing}
            title="Synchronize registered customers with central database"
          >
            <RefreshCw size={14} className={isSyncing ? 'spin-icon' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Cognito'}</span>
          </button>

          <button
            type="button"
            className="dash-btn-ghost"
            style={{ padding: '8px 12px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleExportCsv}
            disabled={isExporting}
            title="Export all customers to CSV"
          >
            <Download size={14} className={isExporting ? 'spin-icon' : ''} />
            <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>

          <button
            type="button"
            className="dash-btn-ghost"
            style={{ padding: '8px 12px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => void loadData(true)}
            disabled={loading}
            title="Refresh customer database"
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div className="dash-alert dash-alert--danger" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" className="dash-btn-ghost" style={{ marginLeft: 'auto', padding: '4px 8px' }} onClick={() => void loadData(true)}>
            Retry
          </button>
        </div>
      )}

      {/* ── Customers Database Table ── */}
      <div className="dash-card glass glass--lift" style={{ padding: 0, position: 'relative' }}>
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Customer</th>
                <th style={{ width: '22%' }}>Customer ID</th>
                <th style={{ width: '24%' }}>Organization</th>
                <th style={{ width: '12%' }}>Activity Status</th>
                <th style={{ width: '10%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && customers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--ink-4)' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <RefreshCw size={18} className="spin-icon" style={{ color: 'var(--brand-hi)' }} />
                      <span>Loading centralized customer database...</span>
                    </div>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--ink-4)' }}>
                    <div style={{ maxWidth: 360, margin: '0 auto' }}>
                      <Users size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                      <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>No Customers Found</div>
                      <div style={{ fontSize: '0.82rem' }}>
                        {searchQuery ? `No results matching "${searchQuery}". Try broadening your search.` : 'No customer records found matching this status filter.'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const fallbackName = c.full_name || 'Name not provided'
                  const initials = fallbackName
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()

                  return (
                    <tr key={c.customer_id} style={{ cursor: 'pointer' }} onClick={() => setSelectedCustomerId(c.customer_id)}>
                      <td>
                        <div className="dash-user-cell">
                          <div className="dash-user-avatar" style={{ background: c.activity_status === 'Online' ? 'rgba(118, 185, 0, 0.15)' : undefined, color: c.activity_status === 'Online' ? '#a3e635' : undefined }}>
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{fallbackName}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                              {c.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                            {c.customer_id.length > 16 ? `${c.customer_id.slice(0, 16)}...` : c.customer_id}
                          </span>
                          <button
                            type="button"
                            className="dash-btn-ghost"
                            style={{ padding: 4, borderRadius: 4 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopy(c.customer_id, `cid-${c.customer_id}`)
                            }}
                            title="Copy Customer ID"
                          >
                            {copiedId === `cid-${c.customer_id}` ? <Check size={12} style={{ color: '#76b900' }} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>

                      <td>
                        <div style={{ fontSize: '0.84rem', color: c.organization ? 'var(--ink)' : 'var(--ink-4)', fontWeight: c.organization ? 500 : 400 }}>
                          {c.organization || '—'}
                        </div>
                      </td>

                      <td>
                        {renderStatusBadge(c.activity_status)}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="dash-btn-ghost"
                          style={{ padding: '6px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedCustomerId(c.customer_id)
                          }}
                        >
                          <Eye size={13} />
                          <span>View Details</span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Table Footer & Pagination ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.8rem',
            color: 'var(--ink-3)',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            Showing <strong style={{ color: 'var(--ink)' }}>{customers.length}</strong> of{' '}
            <strong style={{ color: 'var(--ink)' }}>{totalCount}</strong> customer records
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Per page:</span>
              <select
                className="dash-input"
                style={{ padding: '4px 8px', fontSize: '0.78rem', width: 'auto' }}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="dash-btn-ghost"
                style={{ padding: '6px 10px' }}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                Page <strong style={{ color: 'var(--ink)' }}>{page}</strong> of{' '}
                <strong style={{ color: 'var(--ink)' }}>{totalPages}</strong>
              </span>
              <button
                type="button"
                className="dash-btn-ghost"
                style={{ padding: '6px 10px' }}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Slide-Out Drawer: Customer Full Details & Activity Logs ── */}
      {selectedCustomerId && (
        <div className="cust-drawer-backdrop" onClick={() => setSelectedCustomerId(null)}>
          <div className="cust-drawer-content glass glass--lift" onClick={(e) => e.stopPropagation()}>
            <div className="cust-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Users size={20} style={{ color: 'var(--brand-hi)' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Customer Profile & Activity Ledger</h3>
              </div>
              <button
                type="button"
                className="dash-btn-ghost"
                style={{ padding: 6, borderRadius: '50%' }}
                onClick={() => setSelectedCustomerId(null)}
              >
                <X size={16} />
              </button>
            </div>

            {detailsLoading || !detailsRecord ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-4)' }}>
                <RefreshCw size={20} className="spin-icon" style={{ color: 'var(--brand-hi)', marginBottom: 8 }} />
                <div>Loading customer activity record...</div>
              </div>
            ) : (
              <div className="cust-drawer-body">
                {/* Header Profile Badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="dash-user-avatar" style={{ width: 48, height: 48, fontSize: '1rem', background: '#76b900', color: '#000', fontWeight: 700 }}>
                    {detailsRecord.full_name
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--ink)' }}>{detailsRecord.full_name || 'Name not provided'}</div>
                    <div style={{ fontSize: '0.84rem', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{detailsRecord.email}</div>
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    {renderStatusBadge(detailsRecord.activity_status)}
                  </div>
                </div>

                {/* Primary Customer Profile Overview */}
                <div style={{ marginBottom: 20 }}>
                  <span className="engrave" style={{ fontSize: '0.72rem', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
                    Customer Details Overview
                  </span>
                  <div className="well" style={{ padding: '14px 16px', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.82rem' }}>
                    {/* Customer Name */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Customer Name:</span>
                      <strong style={{ color: 'var(--ink)', fontSize: '0.86rem' }}>{detailsRecord.full_name || 'Name not provided'}</strong>
                    </div>

                    {/* Customer ID */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Customer ID:</span>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--ink)' }}>
                          {detailsRecord.customer_id}
                        </span>
                        <button
                          type="button"
                          className="dash-btn-ghost"
                          style={{ padding: '2px 5px', borderRadius: 4 }}
                          onClick={() => handleCopy(detailsRecord.customer_id, `drawer-cid-${detailsRecord.customer_id}`)}
                          title="Copy Customer ID"
                        >
                          {copiedId === `drawer-cid-${detailsRecord.customer_id}` ? <Check size={12} style={{ color: '#76b900' }} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    {/* Email Address */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Email Address:</span>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>
                          {detailsRecord.email}
                        </span>
                        <button
                          type="button"
                          className="dash-btn-ghost"
                          style={{ padding: '2px 5px', borderRadius: 4 }}
                          onClick={() => handleCopy(detailsRecord.email, `drawer-email-${detailsRecord.email}`)}
                          title="Copy Email Address"
                        >
                          {copiedId === `drawer-email-${detailsRecord.email}` ? <Check size={12} style={{ color: '#76b900' }} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    {/* Organization */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--ink-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Building2 size={13} /> Organization:
                      </span>
                      <span style={{ fontWeight: 500, color: detailsRecord.organization ? 'var(--ink)' : 'var(--ink-4)' }}>
                        {detailsRecord.organization || 'Not provided'}
                      </span>
                    </div>

                    {/* Registration Date */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--ink-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={13} /> Registration Date:
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{formatDateTime(detailsRecord.registration_date)}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--ink-4)' }}>{formatRelativeTime(detailsRecord.registration_date)}</div>
                      </div>
                    </div>

                    {/* Last Active */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Last Active:</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: detailsRecord.activity_status === 'Online' ? '#a3e635' : (detailsRecord.activity_status === 'Active' ? '#22d3ee' : '#fbbf24') }}>
                          {formatRelativeTime(detailsRecord.last_active_at)}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                          {formatDateTime(detailsRecord.last_active_at)}
                        </div>
                      </div>
                    </div>

                    {/* Activity Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Activity Status:</span>
                      <div>
                        {renderStatusBadge(detailsRecord.activity_status)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Identity & Technical Credentials */}
                <div style={{ marginBottom: 20 }}>
                  <span className="engrave" style={{ fontSize: '0.72rem', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
                    Technical & Account Credentials
                  </span>
                  <div className="well" style={{ padding: '12px 14px', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink-4)' }}>AWS Cognito Sub:</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: '#a3e635' }}>{detailsRecord.cognito_sub}</span>
                    </div>
                    {detailsRecord.phone_number && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--ink-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Phone size={13} /> Phone Number:
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{detailsRecord.phone_number}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Account Status:</span>
                      <span className="tag tag--clay" style={{ textTransform: 'capitalize' }}>{detailsRecord.account_status}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Last Heartbeat Received:</span>
                      <span style={{ color: 'var(--ink)' }}>{formatRelativeTime(detailsRecord.last_heartbeat_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Login & Authentication History */}
                <div style={{ marginBottom: 20 }}>
                  <span className="engrave" style={{ fontSize: '0.72rem', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
                    Authentication & Login Ledger
                  </span>
                  <div className="well" style={{ padding: '12px 14px', borderRadius: 8, fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Total Recorded Logins:</span>
                      <span className="tag tag--emerald" style={{ fontWeight: 600 }}>
                        {detailsRecord.login_count || 1} logins
                      </span>
                    </div>

                    {detailsRecord.previous_logins && detailsRecord.previous_logins.length > 0 && (
                      <div>
                        <span style={{ color: 'var(--ink-4)', display: 'block', marginBottom: 6, fontSize: '0.74rem' }}>
                          Recent Login Timestamps:
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 90, overflowY: 'auto' }}>
                          {detailsRecord.previous_logins.slice(0, 6).map((ts, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', fontFamily: 'var(--font-mono)' }}>
                              <span style={{ color: idx === 0 ? '#a3e635' : 'var(--ink-3)' }}>
                                {formatDateTime(ts)}
                              </span>
                              <span style={{ color: 'var(--ink-4)' }}>{formatRelativeTime(ts)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Activity Status Breakdown */}
                <div style={{ marginBottom: 20 }}>
                  <span className="engrave" style={{ fontSize: '0.72rem', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
                    Presence Telemetry
                  </span>
                  <div className="well" style={{ padding: '12px 14px', borderRadius: 8, fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Last Heartbeat Received:</span>
                      <span style={{ color: 'var(--ink)' }}>{formatRelativeTime(detailsRecord.last_heartbeat_at)} ({formatDateTime(detailsRecord.last_heartbeat_at)})</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Last Recorded Activity:</span>
                      <span style={{ color: 'var(--ink)' }}>{formatRelativeTime(detailsRecord.last_active_at)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--ink-4)' }}>Calculated Activity State:</span>
                      <span style={{ fontWeight: 600, color: detailsRecord.activity_status === 'Online' ? '#a3e635' : (detailsRecord.activity_status === 'Active' ? '#22d3ee' : '#fbbf24') }}>
                        {detailsRecord.activity_status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Activity Logs Timeline */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="engrave" style={{ fontSize: '0.72rem', letterSpacing: '0.08em' }}>
                      Activity History Ledger ({detailsRecord.activity_logs?.length || 0})
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--ink-4)' }}>Preserved in customer_activity_logs</span>
                  </div>

                  <div className="well" style={{ padding: '12px 14px', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
                    {(!detailsRecord.activity_logs || detailsRecord.activity_logs.length === 0) ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--ink-4)', fontSize: '0.8rem' }}>
                        No specific activity events recorded yet.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {detailsRecord.activity_logs.map((log) => (
                          <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.78rem', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <Activity size={14} style={{ color: log.event_type === 'login' ? '#76b900' : (log.event_type === 'registration' ? '#06b6d4' : '#f59e0b'), marginTop: 2, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <strong style={{ textTransform: 'capitalize', color: 'var(--ink)' }}>{log.event_type}</strong>
                                <span style={{ color: 'var(--ink-4)', fontSize: '0.72rem' }}>{formatRelativeTime(log.event_timestamp)}</span>
                              </div>
                              {log.metadata && Object.keys(log.metadata).length > 0 && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--ink-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                  {JSON.stringify(log.metadata)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CSS for Pulse Dots & Drawer ── */}
      <style>{`
        .cust-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 0.74rem;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .cust-status-badge--online {
          background: rgba(118, 185, 0, 0.12);
          color: #a3e635;
          border: 1px solid rgba(118, 185, 0, 0.3);
        }
        .cust-status-badge--active {
          background: rgba(6, 182, 212, 0.12);
          color: #22d3ee;
          border: 1px solid rgba(6, 182, 212, 0.3);
        }
        .cust-status-badge--inactive {
          background: rgba(245, 158, 11, 0.12);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .cust-pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #76b900;
          box-shadow: 0 0 8px #76b900;
          animation: custPulse 1.8s infinite;
        }
        @keyframes custPulse {
          0% { transform: scale(0.9); opacity: 0.8; box-shadow: 0 0 0 0 rgba(118, 185, 0, 0.7); }
          70% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 0 6px rgba(118, 185, 0, 0); }
          100% { transform: scale(0.9); opacity: 0.8; box-shadow: 0 0 0 0 rgba(118, 185, 0, 0); }
        }
        .spin-icon {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .cust-drawer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          z-index: 999;
          display: flex;
          justify-content: flex-end;
          animation: fadeIn 0.2s ease-out;
        }
        .cust-drawer-content {
          width: 100%;
          max-width: 540px;
          height: 100%;
          background: #0d1117;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          animation: slideInRight 0.25s ease-out;
        }
        .cust-drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .cust-drawer-body {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </DashboardLayout>
  )
}
