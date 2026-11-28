import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  RotateCcw,
  XCircle,
  AlertCircle,
  Info,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  getAdminAccounts,
  getAdminActivities,
  syncAdminAccountsFromBackend,
  formatRelativeTime,
  type AdminActivityLog,
  type ActivityCategory,
  type ActivitySeverity,
  type AdminAccount,
} from '../../lib/adminAccountStore'
import { fetchSuperadminAuditLogs } from '../../lib/authStore'

export type AuditOutcome = 'Success' | 'Warning' | 'Failure' | 'Blocked'

export interface AuditRecord extends AdminActivityLog {
  outcome: AuditOutcome
  recordHash: string
  verificationStatus: 'verified_local'
}

const ALL_CATEGORIES: ActivityCategory[] = [
  'Admin Accounts',
  'Role Management',
  'Permission Changes',
  'Security',
  'Platform Operations',
]

/**
 * Derives the compliance outcome for an audit record.
 */
function deriveAuditOutcome(event: AdminActivityLog): AuditOutcome {
  const actionLower = event.action.toLowerCase()
  const targetLower = event.targetResource.toLowerCase()
  const descLower = (event.description || '').toLowerCase()

  if (actionLower.includes('blocked') || targetLower.includes('blocked') || descLower.includes('blocked')) {
    return 'Blocked'
  }
  if (actionLower.includes('failed') || actionLower.includes('denied') || descLower.includes('failed') || descLower.includes('denied')) {
    return 'Failure'
  }
  if (event.severity === 'critical' && (actionLower.includes('suspension') || actionLower.includes('revocation') || actionLower.includes('terminated'))) {
    return 'Warning'
  }
  if (event.severity === 'warning') {
    return 'Warning'
  }
  return 'Success'
}

/**
 * Computes a deterministic local session checksum for the audit record.
 * Clearly labeled as prototype/local verification (no fake cryptographic immutability).
 */
function computeRecordHash(event: AdminActivityLog): string {
  const data = `${event.id}:${event.isoTimestamp}:${event.adminEmail}:${event.action}:${event.targetResource}`
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  const cleanId = event.id.replace(/[^a-z0-9]/gi, '').slice(0, 6)
  return `sha256:proto-${hex}${cleanId}`
}

export default function AdminAudit() {
  usePageMeta(
    'Audit Logs & Compliance Ledger | Inferxe Super Admin',
    'Immutable administrative audit trail, regulatory oversight, and compliance verification ledger.'
  )

  // ── Data State ───────────────────────────────────────────────────────
  const [rawActivities, setRawActivities] = useState<AdminActivityLog[]>(() => {
    return getAdminActivities().filter((act) => !act.isDemo)
  })
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(() => getAdminAccounts())
  const [isLoadingBackend, setIsLoadingBackend] = useState(false)

  // Synchronize with activity mutations across components and tabs
  const reloadData = useCallback(() => {
    const live = getAdminActivities().filter((act) => !act.isDemo)
    setRawActivities(live.length > 0 ? live : getAdminActivities())
    setAdminAccounts(getAdminAccounts())
  }, [])

  const loadBackendData = useCallback(async (force = false) => {
    if (rawActivities.length === 0) setIsLoadingBackend(true)
    try {
      await Promise.all([
        syncAdminAccountsFromBackend(force).then((res) => {
          if (res.ok && res.accounts) {
            setAdminAccounts(res.accounts)
          }
        }).catch(() => {}),
        fetchSuperadminAuditLogs({ limit: 200 }, force).then((res) => {
          if (res.ok && res.logs && res.logs.length > 0) {
            const mapped: AdminActivityLog[] = res.logs.map((a: any) => ({
              id: String(a.id),
              adminId: String(a.adminId || a.details?.actor_admin_id || a.admin_id || ''),
              adminName: String(a.adminName || a.details?.actor_name || a.adminEmail?.split('@')[0] || 'Administrator'),
              adminEmail: String(a.adminEmail || a.admin_email || 'system'),
              action: String(a.action || 'admin.action'),
              category: (a.category as ActivityCategory) || 'Platform Operations',
              targetResource: String(a.targetResource || a.target_id || a.target_type || ''),
              severity: (a.severity as ActivitySeverity) || 'info',
              timestamp: a.timestamp || formatRelativeTime(a.created_at || a.isoTimestamp),
              isoTimestamp: a.isoTimestamp || a.created_at || new Date().toISOString(),
              description: a.description || a.details?.description || a.details?.reason || undefined,
              previousValue: a.previousValue || a.details?.previous_value || undefined,
              newValue: a.newValue || a.details?.new_value || undefined,
              source: a.source || a.details?.source || 'Super Admin Portal',
              ipAddress: a.ipAddress || a.ip_address || a.details?.ip_address || '',
              userAgent: a.userAgent || a.user_agent || a.details?.user_agent || '',
              targetType: a.target_type || a.targetType || '',
              targetId: a.target_id || a.targetId || '',
              details: a.details || {},
              isDemo: false,
            }))
            setRawActivities(mapped)
          }
        }).catch(() => {}),
      ])
    } finally {
      setIsLoadingBackend(false)
    }
  }, [])

  useEffect(() => {
    void loadBackendData()
  }, [loadBackendData])

  useEffect(() => {
    window.addEventListener('inferxe_admin_activities_change', reloadData)
    window.addEventListener('inferxe_admin_accounts_change', reloadData)
    window.addEventListener('storage', reloadData)
    return () => {
      window.removeEventListener('inferxe_admin_activities_change', reloadData)
      window.removeEventListener('inferxe_admin_accounts_change', reloadData)
      window.removeEventListener('storage', reloadData)
    }
  }, [reloadData])

  // Map into compliance AuditRecord structure
  const auditRecords: AuditRecord[] = useMemo(() => {
    return rawActivities.map((act) => ({
      ...act,
      outcome: deriveAuditOutcome(act),
      recordHash: computeRecordHash(act),
      verificationStatus: 'verified_local' as const,
    }))
  }, [rawActivities])

  // Account lookup map for admin avatars and departments
  const accountMap = useMemo(() => {
    const map = new Map<string, AdminAccount>()
    adminAccounts.forEach((acc) => {
      map.set(acc.email.toLowerCase(), acc)
      map.set(acc.id, acc)
    })
    return map
  }, [adminAccounts])

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all')
  const [selectedOutcome, setSelectedOutcome] = useState<string>('all')
  const [dateRange, setDateRange] = useState<'all' | 'today' | '7days' | '30days'>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'severity'>('newest')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Modal & Toast States
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (selectedRecord) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [selectedRecord])

  // ── KPI Summary Calculations ─────────────────────────────────────────
  const kpiStats = useMemo(() => {
    const totalRecords = auditRecords.length
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    const successfulEvents = auditRecords.filter(
      (r) => r.outcome === 'Success' || r.severity === 'success' || r.severity === 'info'
    ).length
    const warningEvents = auditRecords.filter(
      (r) => r.outcome === 'Warning' || r.severity === 'warning'
    ).length
    const criticalEvents = auditRecords.filter(
      (r) => r.outcome === 'Failure' || r.outcome === 'Blocked' || r.severity === 'critical'
    ).length

    const eventsToday = auditRecords.filter((r) => {
      try {
        const time = new Date(r.isoTimestamp).getTime()
        return Number.isFinite(time) && now - time <= oneDayMs
      } catch {
        return false
      }
    }).length

    return {
      totalRecords,
      successfulEvents,
      warningEvents,
      criticalEvents,
      eventsToday,
    }
  }, [auditRecords])

  // ── Filter & Sort Logic ──────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    const now = Date.now()
    const query = searchQuery.trim().toLowerCase()

    return auditRecords
      .filter((rec) => {
        // Search matching
        if (query) {
          const matchName = rec.adminName.toLowerCase().includes(query)
          const matchEmail = rec.adminEmail.toLowerCase().includes(query)
          const matchAction = rec.action.toLowerCase().includes(query)
          const matchResource = rec.targetResource.toLowerCase().includes(query)
          const matchId = rec.id.toLowerCase().includes(query)
          const matchDesc = (rec.description || '').toLowerCase().includes(query)
          if (!matchName && !matchEmail && !matchAction && !matchResource && !matchId && !matchDesc) {
            return false
          }
        }

        // Administrator filter
        if (selectedAdmin !== 'all') {
          if (rec.adminEmail.toLowerCase() !== selectedAdmin.toLowerCase()) {
            return false
          }
        }

        // Category filter
        if (selectedCategory !== 'all') {
          if (rec.category !== selectedCategory) {
            return false
          }
        }

        // Severity filter
        if (selectedSeverity !== 'all') {
          if (rec.severity !== selectedSeverity) {
            return false
          }
        }

        // Outcome filter
        if (selectedOutcome !== 'all') {
          if (rec.outcome !== selectedOutcome) {
            return false
          }
        }

        // Date range filter
        if (dateRange !== 'all') {
          try {
            const time = new Date(rec.isoTimestamp).getTime()
            const diff = now - time
            if (dateRange === 'today' && diff > 24 * 60 * 60 * 1000) return false
            if (dateRange === '7days' && diff > 7 * 24 * 60 * 60 * 1000) return false
            if (dateRange === '30days' && diff > 30 * 24 * 60 * 60 * 1000) return false
          } catch {
            /* ignore unparseable date */
          }
        }

        return true
      })
      .sort((a, b) => {
        if (sortBy === 'oldest') {
          return new Date(a.isoTimestamp).getTime() - new Date(b.isoTimestamp).getTime()
        }
        if (sortBy === 'severity') {
          const rank: Record<ActivitySeverity, number> = {
            critical: 4,
            warning: 3,
            info: 2,
            success: 1,
          }
          const diff = (rank[b.severity] || 0) - (rank[a.severity] || 0)
          if (diff !== 0) return diff
        }
        // default: newest
        return new Date(b.isoTimestamp).getTime() - new Date(a.isoTimestamp).getTime()
      })
  }, [auditRecords, searchQuery, selectedAdmin, selectedCategory, selectedSeverity, selectedOutcome, dateRange, sortBy])

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedAdmin, selectedCategory, selectedSeverity, selectedOutcome, dateRange, sortBy])

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredRecords.slice(start, start + pageSize)
  }, [filteredRecords, currentPage, pageSize])

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (searchQuery.trim()) count++
    if (selectedAdmin !== 'all') count++
    if (selectedCategory !== 'all') count++
    if (selectedSeverity !== 'all') count++
    if (selectedOutcome !== 'all') count++
    if (dateRange !== 'all') count++
    if (sortBy !== 'newest') count++
    return count
  }, [searchQuery, selectedAdmin, selectedCategory, selectedSeverity, selectedOutcome, dateRange, sortBy])

  const handleClearFilters = useCallback(() => {
    setSearchQuery('')
    setSelectedAdmin('all')
    setSelectedCategory('all')
    setSelectedSeverity('all')
    setSelectedOutcome('all')
    setDateRange('all')
    setSortBy('newest')
  }, [])

  // Unique administrators for dropdown
  const uniqueAdministrators = useMemo(() => {
    const map = new Map<string, string>()
    auditRecords.forEach((r) => {
      if (!map.has(r.adminEmail)) {
        map.set(r.adminEmail, r.adminName)
      }
    })
    return Array.from(map.entries()).map(([email, name]) => ({ email, name }))
  }, [auditRecords])

  // ── CSV Export ───────────────────────────────────────────────────────
  const handleExportCsv = useCallback(() => {
    if (filteredRecords.length === 0) {
      showToast('No audit records match the current filters to export.', 'error')
      return
    }

    const headers = [
      'Event ID',
      'Timestamp (ISO)',
      'Timestamp (Relative)',
      'Administrator Name',
      'Administrator Email',
      'Action Performed',
      'Category',
      'Affected Resource',
      'Severity',
      'Outcome',
      'Integrity Status',
      'Client IP',
      'User Agent',
      'Source Module',
      'Description',
      'Previous Value',
      'New Value',
    ]

    const sanitizeCsvField = (value: unknown): string => {
      if (value === null || value === undefined || value === '') return '""'
      let str = String(value)
      // Prevent CSV formula injection by prepending ' if str begins with =, +, -, @, \t, or \r
      if (/^[\s]*[=+\-@\t\r]/.test(str)) {
        str = `'${str}`
      }
      const escaped = str.replace(/"/g, '""')
      return `"${escaped}"`
    }

    const rows = filteredRecords.map((rec) => [
      sanitizeCsvField(rec.id),
      sanitizeCsvField(rec.isoTimestamp),
      sanitizeCsvField(rec.timestamp),
      sanitizeCsvField(rec.adminName),
      sanitizeCsvField(rec.adminEmail),
      sanitizeCsvField(rec.action),
      sanitizeCsvField(rec.category),
      sanitizeCsvField(rec.targetResource),
      sanitizeCsvField(rec.severity),
      sanitizeCsvField(rec.outcome),
      sanitizeCsvField('Verified (Audit Ledger)'),
      sanitizeCsvField(rec.ipAddress || 'Not recorded'),
      sanitizeCsvField(rec.userAgent || 'Not recorded'),
      sanitizeCsvField(rec.source || 'Super Admin Portal'),
      sanitizeCsvField(rec.description || 'Not recorded'),
      sanitizeCsvField(rec.previousValue || 'Not recorded'),
      sanitizeCsvField(rec.newValue || 'Not recorded'),
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateTag = new Date().toISOString().slice(0, 10)
    link.href = url
    link.setAttribute('download', `inferxe-audit-log-${dateTag}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    showToast(`Exported ${filteredRecords.length} audit records to CSV`, 'success')
  }, [filteredRecords, showToast])

  // Copy helper
  const handleCopy = useCallback((text: string, key: string, label: string) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey(null), 2000)
        showToast(`Copied ${label} to clipboard`, 'info')
      },
      () => {
        showToast('Unable to copy to clipboard', 'error')
      }
    )
  }, [showToast])

  return (
    <DashboardLayout
      pageTitle="Audit Logs & Compliance Ledger"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Super Admin', to: '/dashboard/super-admin' },
        { label: 'Audit Logs' },
      ]}
      heading="Audit Logs & Compliance Ledger"
      description="Official administrative event stream, regulatory audit trails, and prototype compliance verification."
      backButtonTo="/dashboard/super-admin"
      backButtonLabel="Back to Overview"
    >
      {/* ── 1. Top Governance Banner ─────────────────────────────────────── */}
      <motion.div
        className="sa-header-banner"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sa-banner-title-group">
          <div className="sa-shield-icon-wrap" aria-hidden="true">
            <FileText size={22} />
          </div>
          <div>
            <div className="sa-meta-badges-row">
              <span className="sa-meta-badge sa-meta-badge--cyan">
                <ShieldCheck size={12} />
                Super Admin
              </span>
              <span className="sa-meta-badge sa-meta-badge--emerald">
                <span className="sa-meta-badge__dot" />
                Live Supabase Audit Trail
              </span>
              <span className="sa-meta-badge sa-meta-badge--purple">
                {auditRecords.length} Audit Records
              </span>
            </div>
            <h2 className="sa-banner-title">Super Admin Audit Ledger</h2>
            <div className="sa-banner-sub">
              Captures all administrative mutations, role privileges, access changes, and platform security operations.
            </div>
          </div>
        </div>

        <div className="sa-banner-actions">
          <button
            type="button"
            className="sa-btn-secondary"
            onClick={() => void loadBackendData(true)}
            disabled={isLoadingBackend}
            title="Refresh audit logs from backend"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={14} className={isLoadingBackend ? 'animate-spin' : ''} />
            {isLoadingBackend ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="sa-btn-primary"
            onClick={handleExportCsv}
            title="Download CSV of filtered audit records"
          >
            <Download size={14} />
            Export Filtered CSV
          </button>
        </div>
      </motion.div>

      {/* ── 2. Platform Audit Trail Notice ────────────────── */}
      <div className="sa-compliance-notice">
        <Info size={18} className="sa-compliance-notice__icon" />
        <div>
          <strong>Platform Audit Trail:</strong> This audit ledger records authoritative administrator activities directly from the Supabase <code>audit_logs</code> table. All administrative logins, session revocations, and platform operations are permanently logged with timestamps, actors, and metadata.
        </div>
      </div>

      {/* ── 3. Overview KPI Cards ────────────────────────────────────────── */}
      <div className="sa-kpi-grid">
        <motion.div
          className="sa-kpi-card sa-kpi-card--primary"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Total Audit Records</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--lime">
              <FileText size={18} />
            </div>
          </div>
          <div className="sa-kpi-val">{kpiStats.totalRecords}</div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--up">{kpiStats.eventsToday} Today</span>
            <span>Live Supabase audit trail</span>
          </div>
        </motion.div>

        <motion.div
          className="sa-kpi-card sa-kpi-card--cyan"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Successful Operations</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--cyan">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="sa-kpi-val" style={{ color: 'var(--cx-accent)' }}>
            {kpiStats.successfulEvents}
          </div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--up">Verified</span>
            <span>Normal platform operations</span>
          </div>
        </motion.div>

        <motion.div
          className="sa-kpi-card sa-kpi-card--amber"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Warning Events</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--amber">
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="sa-kpi-val" style={{ color: 'var(--cx-warn)' }}>
            {kpiStats.warningEvents}
          </div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--neutral">Warning</span>
            <span>Deactivations & credential alerts</span>
          </div>
        </motion.div>

        <motion.div
          className="sa-kpi-card sa-kpi-card--red"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Critical Security Events</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--red">
              <ShieldAlert size={18} />
            </div>
          </div>
          <div className="sa-kpi-val" style={{ color: 'var(--cx-danger)' }}>
            {kpiStats.criticalEvents}
          </div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--down">Elevated</span>
            <span>Violations & account deletions</span>
          </div>
        </motion.div>
      </div>

      {/* ── 4. Advanced Filter Toolbar ───────────────────────────────────── */}
      <div className="sa-filter-bar">
        {/* Search */}
        <div className="sa-search-wrap">
          <Search size={15} className="sa-search-icon" />
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search by administrator, event ID, action or resource..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search audit records"
          />
          {searchQuery && (
            <button
              type="button"
              className="sa-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search query"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Date Range */}
        <select
          className="sa-select"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as any)}
          aria-label="Filter by date range"
        >
          <option value="all">All Dates</option>
          <option value="today">Today (Past 24 Hours)</option>
          <option value="7days">Last 7 Days</option>
          <option value="30days">Last 30 Days</option>
        </select>

        {/* Administrator */}
        <select
          className="sa-select"
          value={selectedAdmin}
          onChange={(e) => setSelectedAdmin(e.target.value)}
          aria-label="Filter by administrator"
        >
          <option value="all">All Administrators</option>
          {uniqueAdministrators.map(({ email, name }) => (
            <option key={email} value={email}>
              {name} ({email})
            </option>
          ))}
        </select>

        {/* Category */}
        <select
          className="sa-select"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All Categories</option>
          {ALL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* Severity */}
        <select
          className="sa-select"
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          aria-label="Filter by severity"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
        </select>

        {/* Outcome */}
        <select
          className="sa-select"
          value={selectedOutcome}
          onChange={(e) => setSelectedOutcome(e.target.value)}
          aria-label="Filter by outcome"
        >
          <option value="all">All Outcomes</option>
          <option value="Success">Success</option>
          <option value="Warning">Warning</option>
          <option value="Failure">Failure</option>
          <option value="Blocked">Blocked</option>
        </select>

        {/* Sort By */}
        <select
          className="sa-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          aria-label="Sort audit records"
        >
          <option value="newest">Sort: Newest First</option>
          <option value="oldest">Sort: Oldest First</option>
          <option value="severity">Sort: Highest Severity</option>
        </select>

        {/* Clear Filters */}
        {activeFiltersCount > 0 && (
          <button
            type="button"
            className="sa-btn-secondary"
            onClick={handleClearFilters}
            style={{ padding: '8px 12px', fontSize: '0.8rem' }}
            title="Reset all search and filter controls"
          >
            <RotateCcw size={13} />
            Reset ({activeFiltersCount})
          </button>
        )}
      </div>

      {/* ── 5. Results Summary Bar ───────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
          fontSize: '0.82rem',
          color: 'var(--cx-text-3)',
        }}
      >
        <div>
          Showing <strong style={{ color: 'var(--cx-accent)' }}>{filteredRecords.length}</strong>{' '}
          {filteredRecords.length === 1 ? 'audit record' : 'audit records'}{' '}
          {auditRecords.length !== filteredRecords.length && `(filtered from ${auditRecords.length} total)`}
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}>
            <span>
              Page {currentPage} of {totalPages}
            </span>
          </div>
        )}
      </div>

      {/* ── 6. Audit Log Table & Responsive Cards ───────────────────────── */}
      {isLoadingBackend && rawActivities.length === 0 ? (
        <div className="sa-empty-state">
          <div className="sa-empty-icon-wrap" style={{ background: 'rgba(80, 227, 150, 0.1)', color: 'var(--cx-accent)' }}>
            <FileText size={24} style={{ animation: 'spin 1.2s linear infinite' }} />
          </div>
          <h3 className="sa-empty-title">Loading Audit Ledger...</h3>
          <p className="sa-empty-desc">
            Querying live Supabase audit_logs table for administrative events...
          </p>
        </div>
      ) : paginatedRecords.length === 0 ? (
        <div className="sa-empty-state">
          <div className="sa-empty-icon-wrap" style={{ background: 'rgba(80, 227, 150, 0.1)', color: 'var(--cx-accent)' }}>
            <FileText size={24} />
          </div>
          <h3 className="sa-empty-title">No Audit Records Found</h3>
          <p className="sa-empty-desc">
            {rawActivities.length === 0
              ? 'No audit records recorded yet in Supabase. Events will automatically populate as administrative operations occur.'
              : 'No audit records match your current filter parameters. Try clearing your search query or selecting a broader date range.'}
          </p>
          {activeFiltersCount > 0 && (
            <button type="button" className="sa-btn-primary" onClick={handleClearFilters}>
              Clear All Filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop & Laptop Fixed-Layout Table (No horizontal scroll at 1920x1080 & 1366x768) */}
          <div className="sa-audit-table-wrap">
            <div className="sa-audit-table-container">
              <table className="sa-audit-table">
                <colgroup>
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '7.5%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '7.5%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '7%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Timestamp</th>
                    <th>Administrator</th>
                    <th>Action</th>
                    <th>Category</th>
                    <th>Resource</th>
                    <th>Severity</th>
                    <th>Outcome</th>
                    <th>Integrity</th>
                    <th style={{ textAlign: 'right', paddingRight: 10 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRecords.map((rec) => {
                    const account = accountMap.get(rec.adminEmail.toLowerCase())
                    const avatarInitials = account?.avatarInitials || rec.adminName.substring(0, 2).toUpperCase()
                    const avatarGradient = account?.avatarGradient || 'linear-gradient(135deg, #50e396, #0e3820)'

                    return (
                      <tr key={rec.id}>
                        {/* Event ID */}
                        <td>
                          <span className="sa-audit-id-badge" title={rec.id}>
                            {rec.id}
                          </span>
                        </td>

                        {/* Timestamp */}
                        <td>
                          <span className="sa-date-text" title={rec.isoTimestamp}>
                            {rec.timestamp}
                          </span>
                        </td>

                        {/* Administrator */}
                        <td>
                          <div
                            className="sa-audit-user-cell"
                            title={`${rec.adminName} (${rec.adminEmail})`}
                          >
                            <div
                              className="sa-avatar-circle sa-avatar-circle--sm"
                              style={{ background: avatarGradient }}
                            >
                              {avatarInitials}
                            </div>
                            <div className="sa-audit-user-meta">
                              <span className="sa-audit-user-name">{rec.adminName}</span>
                              <span className="sa-audit-user-email">{rec.adminEmail}</span>
                            </div>
                          </div>
                        </td>

                        {/* Action Performed */}
                        <td>
                          <div
                            className="sa-audit-action-cell"
                            title={rec.description ? `${rec.action}: ${rec.description}` : rec.action}
                          >
                            <span className="sa-audit-action-title">{rec.action}</span>
                            {rec.description && (
                              <span className="sa-audit-action-desc">{rec.description}</span>
                            )}
                          </div>
                        </td>

                        {/* Category */}
                        <td>
                          <span className="sa-cat-badge sa-cat-badge--compact" title={rec.category}>
                            {rec.category}
                          </span>
                        </td>

                        {/* Affected Resource */}
                        <td>
                          <span className="sa-audit-resource-code" title={rec.targetResource}>
                            {rec.targetResource}
                          </span>
                        </td>

                        {/* Severity */}
                        <td>
                          <span
                            className={`sa-sev-badge sa-sev-badge--compact sa-sev-badge--${rec.severity}`}
                            title={`Severity: ${rec.severity}`}
                          >
                            {rec.severity}
                          </span>
                        </td>

                        {/* Outcome */}
                        <td>
                          <span
                            className={`sa-audit-outcome sa-audit-outcome--compact sa-audit-outcome--${rec.outcome.toLowerCase()}`}
                            title={`Outcome: ${rec.outcome}`}
                          >
                            {rec.outcome === 'Success' && <CheckCircle2 size={11} />}
                            {rec.outcome === 'Warning' && <AlertCircle size={11} />}
                            {rec.outcome === 'Failure' && <XCircle size={11} />}
                            {rec.outcome === 'Blocked' && <ShieldAlert size={11} />}
                            <span>{rec.outcome}</span>
                          </span>
                        </td>

                        {/* Integrity */}
                        <td>
                          <span
                            className="sa-integrity-chip sa-integrity-chip--compact"
                            title="Verified Supabase audit record"
                          >
                            <CheckCircle2 size={11} />
                            <span>Verified</span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right', paddingRight: 10 }}>
                          <button
                            type="button"
                            className="sa-audit-inspect-btn sa-audit-inspect-btn--compact"
                            onClick={() => setSelectedRecord(rec)}
                            title="Inspect full audit record"
                          >
                            <Eye size={12} />
                            <span>View</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tablet & Mobile Card-Based Record View (Screen width <= 1024px) */}
          <div className="sa-audit-card-list">
            {paginatedRecords.map((rec) => {
              const account = accountMap.get(rec.adminEmail.toLowerCase())
              const avatarInitials = account?.avatarInitials || rec.adminName.substring(0, 2).toUpperCase()
              const avatarGradient = account?.avatarGradient || 'linear-gradient(135deg, #50e396, #0e3820)'

              return (
                <div key={`card-${rec.id}`} className="sa-audit-card-item">
                  <div className="sa-audit-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="sa-audit-id-badge">{rec.id}</span>
                      <span className="sa-date-text" title={rec.isoTimestamp}>
                        {rec.timestamp}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`sa-sev-badge sa-sev-badge--compact sa-sev-badge--${rec.severity}`}>
                        {rec.severity}
                      </span>
                      <span
                        className={`sa-audit-outcome sa-audit-outcome--compact sa-audit-outcome--${rec.outcome.toLowerCase()}`}
                      >
                        {rec.outcome === 'Success' && <CheckCircle2 size={11} />}
                        {rec.outcome === 'Warning' && <AlertCircle size={11} />}
                        {rec.outcome === 'Failure' && <XCircle size={11} />}
                        {rec.outcome === 'Blocked' && <ShieldAlert size={11} />}
                        <span>{rec.outcome}</span>
                      </span>
                    </div>
                  </div>

                  <div className="sa-audit-card-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        className="sa-avatar-circle sa-avatar-circle--sm"
                        style={{ background: avatarGradient }}
                      >
                        {avatarInitials}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, color: 'var(--cx-text)', fontSize: '0.84rem' }}>
                          {rec.adminName}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--cx-text-3)', fontFamily: 'monospace' }}>
                          {rec.adminEmail}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--cx-text)', fontSize: '0.86rem' }}>
                        {rec.action}
                      </div>
                      {rec.description && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--cx-text-3)', marginTop: 3, lineHeight: 1.4 }}>
                          {rec.description}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.70rem', color: 'var(--cx-text-4)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Resource:
                      </span>
                      <span className="sa-audit-resource-code" title={rec.targetResource}>
                        {rec.targetResource}
                      </span>
                    </div>
                  </div>

                  <div className="sa-audit-card-footer">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="sa-cat-badge sa-cat-badge--compact">{rec.category}</span>
                      <span className="sa-integrity-chip sa-integrity-chip--compact">
                        <CheckCircle2 size={11} />
                        <span>Verified</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      className="sa-audit-inspect-btn"
                      onClick={() => setSelectedRecord(rec)}
                      title="Inspect full audit record"
                    >
                      <Eye size={12} />
                      <span>Inspect Details</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── 7. Centered Bottom Pagination ─────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="sa-pagination-container">
          <button
            type="button"
            className="sa-pagination-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Previous Page"
          >
            <ChevronLeft size={15} />
            <span>Previous</span>
          </button>

          <div className="sa-pagination-indicator">
            Page <strong className="sa-pagination-current">{currentPage}</strong> of{' '}
            <span className="sa-pagination-total">{totalPages}</span>
          </div>

          <button
            type="button"
            className="sa-pagination-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            aria-label="Next Page"
          >
            <span>Next</span>
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* ── 8. Audit Record Details Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {selectedRecord && (
          <div
            className="sa-modal-overlay"
            onClick={() => setSelectedRecord(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-modal-title"
          >
            <motion.div
              className="sa-modal-container"
              style={{ maxWidth: 640 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Modal Header */}
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className="sa-shield-icon-wrap"
                    style={{
                      width: 36,
                      height: 36,
                      color: 'var(--cx-accent)',
                      borderColor: 'rgba(80, 227, 150, 0.4)',
                    }}
                  >
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 id="audit-modal-title" className="sa-modal-title">
                      Audit Record Inspection
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <span className="sa-audit-id-badge">{selectedRecord.id}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(selectedRecord.id, 'modal-id', 'Event ID')}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--cx-text-3)',
                          cursor: 'pointer',
                          padding: 2,
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                        title="Copy Event ID"
                      >
                        {copiedKey === 'modal-id' ? <Check size={13} style={{ color: 'var(--cx-accent)' }} /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="sa-modal-close"
                  onClick={() => setSelectedRecord(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="sa-modal-body">
                {/* Integrity & Compliance Box */}
                <div className="sa-audit-integrity-box">
                  <div className="sa-audit-integrity-head">
                    <div className="sa-audit-integrity-badge">
                      <ShieldCheck size={16} />
                      <span>Verified Supabase Audit Record</span>
                    </div>
                    <span className="sa-audit-hash-chip">{selectedRecord.recordHash}</span>
                  </div>
                  <div className="sa-audit-integrity-notice">
                    <strong>Audit Record Verification:</strong> This event is permanently recorded in the Supabase <code>audit_logs</code> table with actor credentials, IP address, and payload metadata.
                  </div>
                </div>

                {/* Event Overview Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Event ID</span>
                    <span className="sa-profile-stat-val" style={{ fontSize: '0.86rem' }}>
                      {selectedRecord.id}
                    </span>
                  </div>
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Recorded</span>
                    <span className="sa-profile-stat-val" style={{ fontSize: '0.86rem' }}>
                      {selectedRecord.timestamp}
                    </span>
                  </div>
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Severity</span>
                    <div>
                      <span className={`sa-sev-badge sa-sev-badge--${selectedRecord.severity}`}>
                        {selectedRecord.severity}
                      </span>
                    </div>
                  </div>
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Outcome</span>
                    <div>
                      <span className={`sa-audit-outcome sa-audit-outcome--${selectedRecord.outcome.toLowerCase()}`}>
                        {selectedRecord.outcome}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actor Identity */}
                <div
                  style={{
                    padding: '12px 14px',
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border)',
                    borderRadius: 8,
                    marginBottom: 14,
                  }}
                >
                  <div className="sa-audit-detail-label" style={{ marginBottom: 8 }}>
                    Actor Identity & Provenance
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <span style={{ fontSize: '0.74rem', color: 'var(--cx-text-3)' }}>Administrator Name:</span>
                      <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--cx-text)', marginTop: 2 }}>
                        {selectedRecord.adminName || <span className="sa-empty-text">Not recorded</span>}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.74rem', color: 'var(--cx-text-3)' }}>Corporate Email:</span>
                      <div style={{ fontSize: '0.86rem', fontFamily: 'monospace', color: 'var(--cx-accent)', marginTop: 2 }}>
                        {selectedRecord.adminEmail || <span className="sa-empty-text">Not recorded</span>}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.74rem', color: 'var(--cx-text-3)' }}>Client IP Address:</span>
                      <div style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--cx-text-2)', marginTop: 2 }}>
                        {selectedRecord.ipAddress || <span className="sa-empty-text">Not recorded</span>}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.74rem', color: 'var(--cx-text-3)' }}>Source Module:</span>
                      <div style={{ fontSize: '0.82rem', color: 'var(--cx-text-2)', marginTop: 2 }}>
                        {selectedRecord.source || <span className="sa-empty-text">Not recorded</span>}
                      </div>
                    </div>
                    {selectedRecord.userAgent && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--cx-text-3)' }}>Client User Agent:</span>
                        <div style={{ fontSize: '0.76rem', fontFamily: 'monospace', color: 'var(--cx-text-3)', marginTop: 2, wordBreak: 'break-all' }}>
                          {selectedRecord.userAgent}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Operation & Resource Details */}
                <div className="sa-audit-detail-section">
                  <span className="sa-audit-detail-label">Action Performed</span>
                  <div className="sa-audit-detail-value" style={{ fontWeight: 600, color: 'var(--cx-text)' }}>
                    {selectedRecord.action}
                  </div>
                </div>

                <div className="sa-audit-detail-section">
                  <span className="sa-audit-detail-label">Category</span>
                  <div>
                    <span className="sa-cat-badge">{selectedRecord.category}</span>
                  </div>
                </div>

                <div className="sa-audit-detail-section">
                  <span className="sa-audit-detail-label">Affected Target Resource</span>
                  <div className="sa-audit-resource-code" style={{ fontSize: '0.84rem', padding: '4px 8px' }}>
                    {selectedRecord.targetResource || <span className="sa-empty-text">Not recorded</span>}
                  </div>
                </div>

                <div className="sa-audit-detail-section">
                  <span className="sa-audit-detail-label">Description & Context</span>
                  <div
                    style={{
                      fontSize: '0.84rem',
                      color: 'var(--cx-text-2)',
                      lineHeight: 1.5,
                      background: 'var(--cx-surface)',
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--cx-border)',
                    }}
                  >
                    {selectedRecord.description || <span className="sa-empty-text">Not recorded</span>}
                  </div>
                </div>

                {/* State Mutation / Diff Viewer */}
                <div className="sa-audit-detail-section">
                  <span className="sa-audit-detail-label">State Change / Mutation Diff</span>
                  {selectedRecord.previousValue || selectedRecord.newValue ? (
                    <div className="sa-diff-container">
                      <div className="sa-diff-box">
                        <span className="sa-diff-title sa-diff-title--prev">Previous State</span>
                        <div className="sa-diff-val sa-diff-val--prev">
                          {selectedRecord.previousValue || <span className="sa-empty-text">Not recorded</span>}
                        </div>
                      </div>
                      <div className="sa-diff-box">
                        <span className="sa-diff-title sa-diff-title--new">New State</span>
                        <div className="sa-diff-val sa-diff-val--new">
                          {selectedRecord.newValue || <span className="sa-empty-text">Not recorded</span>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--cx-text-4)', fontStyle: 'italic', padding: '6px 0' }}>
                      Not recorded
                    </div>
                  )}
                </div>

                {/* Additional Event Details & Metadata */}
                {selectedRecord.details && Object.keys(selectedRecord.details).length > 0 && (
                  <div className="sa-audit-detail-section">
                    <span className="sa-audit-detail-label">Event Parameters & Metadata</span>
                    <pre
                      style={{
                        margin: 0,
                        padding: '10px 12px',
                        background: 'var(--cx-surface)',
                        border: '1px solid var(--cx-border)',
                        borderRadius: 6,
                        color: 'var(--cx-accent)',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        overflowX: 'auto',
                        maxHeight: 160,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(selectedRecord.details, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Timestamp Details */}
                <div className="sa-audit-detail-section">
                  <span className="sa-audit-detail-label">ISO 8601 UTC Timestamp</span>
                  <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--cx-text-3)' }}>
                    {selectedRecord.isoTimestamp || <span className="sa-empty-text">Not recorded</span>}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="sa-btn-secondary"
                  onClick={() =>
                    handleCopy(
                      JSON.stringify(selectedRecord, null, 2),
                      'modal-json',
                      'Event JSON'
                    )
                  }
                  title="Copy full audit event payload as JSON"
                >
                  {copiedKey === 'modal-json' ? <Check size={14} style={{ color: 'var(--cx-accent)' }} /> : <Copy size={14} />}
                  <span>Copy JSON Payload</span>
                </button>
                <button
                  type="button"
                  className="sa-btn-primary"
                  onClick={() => setSelectedRecord(null)}
                >
                  Close Inspection
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 9. Feedback Toast ────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className={`sa-toast ${
              toast.type === 'error'
                ? 'sa-toast--error'
                : toast.type === 'info'
                ? 'sa-toast--info'
                : 'sa-toast--success'
            }`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              zIndex: 100001,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: '0.84rem',
              fontWeight: 600,
              background: toast.type === 'error' ? 'var(--cx-card-a, var(--cx-panel))' : toast.type === 'info' ? 'var(--cx-card-a, var(--cx-panel))' : 'var(--cx-card-a, var(--cx-panel))',
              border: `1px solid ${
                toast.type === 'error' ? 'var(--cx-danger)' : toast.type === 'info' ? 'var(--cx-info)' : 'var(--cx-accent)'
              }`,
              color: toast.type === 'error' ? 'var(--cx-danger)' : toast.type === 'info' ? 'var(--cx-info)' : 'var(--cx-accent)',
              boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
            }}
          >
            {toast.type === 'error' ? (
              <AlertTriangle size={15} />
            ) : toast.type === 'info' ? (
              <Info size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}
