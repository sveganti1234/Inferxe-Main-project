import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity,
  ShieldCheck,
  Search,
  Eye,
  Clock,
  UserCheck,
  AlertTriangle,
  RotateCcw,
  Download,
  Calendar,
  ChevronRight,
  ChevronLeft,
  User,
  Copy,
  Check,
  CheckCircle2,
  X,
  Sliders,
  Cpu,
  Users,
  Shield,
  KeyRound,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Layers,
  Sparkles,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  getAdminAccounts,
  getAdminActivities,
  resetToDefaultActivities,
  getAdminRoleMeta,
  type AdminActivityLog,
  type ActivityCategory,
  type ActivitySeverity,
  type AdminAccount,
} from '../../lib/adminAccountStore'

const ALL_CATEGORIES: ActivityCategory[] = [
  'Admin Accounts',
  'Role Management',
  'Permission Changes',
  'Security',
  'Platform Operations',
]

function getCategoryIcon(category: ActivityCategory) {
  switch (category) {
    case 'Admin Accounts':
      return <Users size={14} style={{ color: '#22d3ee' }} />
    case 'Role Management':
      return <KeyRound size={14} style={{ color: '#34d399' }} />
    case 'Permission Changes':
      return <Sliders size={14} style={{ color: '#c084fc' }} />
    case 'Security':
      return <Shield size={14} style={{ color: '#f87171' }} />
    case 'Platform Operations':
      return <Cpu size={14} style={{ color: '#fbbf24' }} />
    default:
      return <Activity size={14} style={{ color: '#94a3b8' }} />
  }
}

function getCategoryBadgeClass(category: ActivityCategory) {
  switch (category) {
    case 'Admin Accounts':
      return 'sa-cat-badge sa-cat-badge--accounts'
    case 'Role Management':
      return 'sa-cat-badge sa-cat-badge--roles'
    case 'Permission Changes':
      return 'sa-cat-badge sa-cat-badge--permissions'
    case 'Security':
      return 'sa-cat-badge sa-cat-badge--security'
    case 'Platform Operations':
      return 'sa-cat-badge sa-cat-badge--operations'
    default:
      return 'sa-cat-badge'
  }
}

function getSeverityBadgeClass(severity: ActivitySeverity) {
  switch (severity) {
    case 'critical':
      return 'sa-sev-badge sa-sev-badge--critical'
    case 'warning':
      return 'sa-sev-badge sa-sev-badge--warning'
    case 'success':
      return 'sa-sev-badge sa-sev-badge--success'
    case 'info':
    default:
      return 'sa-sev-badge sa-sev-badge--info'
  }
}

function getSeverityDotColor(severity: ActivitySeverity) {
  switch (severity) {
    case 'critical':
      return '#ef4444'
    case 'warning':
      return '#f59e0b'
    case 'success':
      return '#50e396'
    case 'info':
    default:
      return '#38bdf8'
  }
}

export default function AdminActivity() {
  usePageMeta(
    'Activity Monitoring · Inferxe Super Admin',
    'Real-time immutable audit trail, administrative lifecycle operations, and security telemetry.'
  )

  // Data State
  const [activities, setActivities] = useState<AdminActivityLog[]>(() => getAdminActivities())
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(() => getAdminAccounts())

  // Filters State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all')
  const [dateRange, setDateRange] = useState<'all' | 'today' | '7days' | '30days'>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'severity'>('newest')

  // UI View States
  const [showAnalytics, setShowAnalytics] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 8

  // Modals & Drawers
  const [selectedEvent, setSelectedEvent] = useState<AdminActivityLog | null>(null)
  const [profileAdminEmail, setProfileAdminEmail] = useState<string | null>(null)
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(timer)
  }, [toast])

  // Cross-component and localStorage synchronization
  const reloadData = useCallback(() => {
    setActivities(getAdminActivities())
    setAdminAccounts(getAdminAccounts())
  }, [])

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

  // Prevent background scroll when modals are open
  const isAnyModalOpen = Boolean(selectedEvent || profileAdminEmail || resetModalOpen)
  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isAnyModalOpen])

  // Copy helper
  const copyToClipboard = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
      showToast('Event ID copied to clipboard', 'info')
    } catch {
      /* fallback */
    }
  }

  // Helper map for Admin Accounts
  const adminAccountMap = useMemo(() => {
    const map = new Map<string, AdminAccount>()
    adminAccounts.forEach((acc) => {
      map.set(acc.email.toLowerCase(), acc)
      map.set(acc.id, acc)
    })
    return map
  }, [adminAccounts])

  // ── KPI Calculations ────────────────────────────────────────────────
  const kpiStats = useMemo(() => {
    const totalEvents = activities.length
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    const eventsToday = activities.filter((act) => {
      try {
        const time = new Date(act.isoTimestamp).getTime()
        return now - time <= oneDayMs
      } catch {
        return false
      }
    }).length

    const uniqueActors = new Set(activities.map((a) => a.adminEmail.toLowerCase())).size
    const criticalCount = activities.filter((a) => a.severity === 'critical').length

    return {
      totalEvents,
      eventsToday,
      uniqueActors,
      criticalCount,
    }
  }, [activities])

  // ── Filtered and Sorted Activities ──────────────────────────────────
  const filteredActivities = useMemo(() => {
    const now = Date.now()
    const query = searchQuery.trim().toLowerCase()

    return activities.filter((act) => {
      // Search matching: admin name, email, action, target resource, description, ID
      if (query) {
        const matchName = act.adminName.toLowerCase().includes(query)
        const matchEmail = act.adminEmail.toLowerCase().includes(query)
        const matchAction = act.action.toLowerCase().includes(query)
        const matchResource = act.targetResource.toLowerCase().includes(query)
        const matchDesc = act.description?.toLowerCase().includes(query)
        const matchId = act.id.toLowerCase().includes(query)
        if (!matchName && !matchEmail && !matchAction && !matchResource && !matchDesc && !matchId) {
          return false
        }
      }

      // Filter by Administrator
      if (selectedAdmin !== 'all') {
        if (act.adminEmail.toLowerCase() !== selectedAdmin.toLowerCase()) {
          return false
        }
      }

      // Filter by Category
      if (selectedCategory !== 'all') {
        if (act.category !== selectedCategory) {
          return false
        }
      }

      // Filter by Severity
      if (selectedSeverity !== 'all') {
        if (act.severity !== selectedSeverity) {
          return false
        }
      }

      // Filter by Date Range
      if (dateRange !== 'all') {
        try {
          const actTime = new Date(act.isoTimestamp).getTime()
          const diffMs = now - actTime
          if (dateRange === 'today' && diffMs > 24 * 60 * 60 * 1000) return false
          if (dateRange === '7days' && diffMs > 7 * 24 * 60 * 60 * 1000) return false
          if (dateRange === '30days' && diffMs > 30 * 24 * 60 * 60 * 1000) return false
        } catch {
          /* ignore unparseable dates */
        }
      }

      return true
    }).sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.isoTimestamp).getTime() - new Date(b.isoTimestamp).getTime()
      }
      if (sortBy === 'severity') {
        const severityRank: Record<ActivitySeverity, number> = {
          critical: 4,
          warning: 3,
          info: 2,
          success: 1,
        }
        const diff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0)
        if (diff !== 0) return diff
      }
      // default: newest first
      return new Date(b.isoTimestamp).getTime() - new Date(a.isoTimestamp).getTime()
    })
  }, [activities, searchQuery, selectedAdmin, selectedCategory, selectedSeverity, dateRange, sortBy])

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedAdmin, selectedCategory, selectedSeverity, dateRange, sortBy])

  const totalPages = Math.ceil(filteredActivities.length / pageSize) || 1
  const paginatedActivities = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredActivities.slice(start, start + pageSize)
  }, [filteredActivities, currentPage, pageSize])

  // Active filter count
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (searchQuery.trim()) count++
    if (selectedAdmin !== 'all') count++
    if (selectedCategory !== 'all') count++
    if (selectedSeverity !== 'all') count++
    if (dateRange !== 'all') count++
    if (sortBy !== 'newest') count++
    return count
  }, [searchQuery, selectedAdmin, selectedCategory, selectedSeverity, dateRange, sortBy])

  const handleClearFilters = () => {
    setSearchQuery('')
    setSelectedAdmin('all')
    setSelectedCategory('all')
    setSelectedSeverity('all')
    setDateRange('all')
    setSortBy('newest')
  }

  // ── Analytics Data Aggregations ──────────────────────────────────────
  const analyticsData = useMemo(() => {
    // 1. Trends over time: daily counts for the last 7 days
    const days: { dateStr: string; label: string; count: number }[] = []
    const now = new Date()

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateKey = d.toISOString().slice(0, 10)
      const label = i === 0 ? 'Today' : i === 1 ? 'Y’day' : d.toLocaleDateString('en-US', { weekday: 'short' })
      days.push({ dateStr: dateKey, label, count: 0 })
    }

    activities.forEach((act) => {
      try {
        const actDateStr = act.isoTimestamp.slice(0, 10)
        const match = days.find((day) => day.dateStr === actDateStr)
        if (match) match.count++
      } catch {}
    })

    const maxTrendCount = Math.max(1, ...days.map((d) => d.count))

    // 2. Leaderboard: top active administrators
    const adminCountMap = new Map<string, { count: number; name: string; email: string }>()
    activities.forEach((act) => {
      const email = act.adminEmail.toLowerCase()
      const existing = adminCountMap.get(email) || { count: 0, name: act.adminName, email: act.adminEmail }
      existing.count++
      adminCountMap.set(email, existing)
    })
    const topAdmins = Array.from(adminCountMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
    const maxAdminCount = Math.max(1, ...topAdmins.map((a) => a.count))

    // 3. Category distribution
    const catCounts: Record<ActivityCategory, number> = {
      'Admin Accounts': 0,
      'Role Management': 0,
      'Permission Changes': 0,
      'Security': 0,
      'Platform Operations': 0,
    }
    activities.forEach((act) => {
      if (catCounts[act.category] !== undefined) {
        catCounts[act.category]++
      }
    })

    // 4. Severity breakdown
    const sevCounts: Record<ActivitySeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
      success: 0,
    }
    activities.forEach((act) => {
      if (sevCounts[act.severity] !== undefined) {
        sevCounts[act.severity]++
      }
    })

    return {
      trends: days,
      maxTrendCount,
      topAdmins,
      maxAdminCount,
      catCounts,
      sevCounts,
      totalCount: activities.length || 1,
    }
  }, [activities])

  // ── CSV Export Function ──────────────────────────────────────────────
  const handleExportCSV = () => {
    if (filteredActivities.length === 0) {
      showToast('No records match current filters to export', 'error')
      return
    }

    const headers = [
      'Event ID',
      'Timestamp (ISO)',
      'Timestamp (Relative)',
      'Actor Name',
      'Actor Email',
      'Action',
      'Category',
      'Severity',
      'Target Resource',
      'Description',
      'Previous Value',
      'New Value',
      'Source',
      'Client IP',
    ]

    const escapeCsv = (str?: string) => {
      if (!str) return '""'
      const escaped = String(str).replace(/"/g, '""')
      return `"${escaped}"`
    }

    const rows = filteredActivities.map((act) => [
      escapeCsv(act.id),
      escapeCsv(act.isoTimestamp),
      escapeCsv(act.timestamp),
      escapeCsv(act.adminName),
      escapeCsv(act.adminEmail),
      escapeCsv(act.action),
      escapeCsv(act.category),
      escapeCsv(act.severity),
      escapeCsv(act.targetResource),
      escapeCsv(act.description || ''),
      escapeCsv(act.previousValue || ''),
      escapeCsv(act.newValue || ''),
      escapeCsv(act.source || 'Super Admin Portal'),
      escapeCsv(act.ipAddress || ''),
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateTag = new Date().toISOString().slice(0, 10)
    link.href = url
    link.setAttribute('download', `inferxe-admin-activity-${dateTag}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    showToast(`Exported ${filteredActivities.length} activity records to CSV`, 'success')
  }

  // ── Reset Demo Activities ────────────────────────────────────────────
  const handleConfirmReset = () => {
    const fresh = resetToDefaultActivities()
    setActivities(fresh)
    setResetModalOpen(false)
    showToast('Activity stream successfully reset to initial demonstration dataset', 'success')
  }

  // ── Selected Profile Admin Details ──────────────────────────────────
  const profileAdminData = useMemo(() => {
    if (!profileAdminEmail) return null
    const emailLower = profileAdminEmail.toLowerCase()
    const account = adminAccountMap.get(emailLower)
    const adminEvents = activities.filter((a) => a.adminEmail.toLowerCase() === emailLower)
    const criticalEvents = adminEvents.filter((a) => a.severity === 'critical')

    // Find top category for this admin
    const catMap = new Map<ActivityCategory, number>()
    adminEvents.forEach((e) => {
      catMap.set(e.category, (catMap.get(e.category) || 0) + 1)
    })
    let topCategory: ActivityCategory = 'Admin Accounts'
    let maxCatCount = 0
    catMap.forEach((count, cat) => {
      if (count > maxCatCount) {
        maxCatCount = count
        topCategory = cat
      }
    })

    return {
      email: profileAdminEmail,
      name: account?.fullName || adminEvents[0]?.adminName || profileAdminEmail.split('@')[0],
      role: account?.role || 'super_admin',
      status: account?.status || 'active',
      department: account?.department || 'Executive Engineering',
      avatarInitials: account?.avatarInitials || (adminEvents[0]?.adminName || 'AD').substring(0, 2).toUpperCase(),
      avatarGradient: account?.avatarGradient || 'linear-gradient(135deg, #50e396, #0e3820)',
      events: adminEvents,
      totalCount: adminEvents.length,
      criticalCount: criticalEvents.length,
      topCategory,
      lastEvent: adminEvents[0] || null,
      catMap,
    }
  }, [profileAdminEmail, activities, adminAccountMap])

  return (
    <DashboardLayout
      pageTitle="Activity Monitoring"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Super Admin', to: '/dashboard/super-admin' },
        { label: 'Activity Monitoring' },
      ]}
      heading="Activity Monitoring"
      description="Real-time immutable audit trail, administrative lifecycle operations, and security access telemetry."
      backButtonTo="/dashboard/super-admin"
      backButtonLabel="Back to Overview"
    >
      {/* ── 1. Top Governance Header Banner ──────────────────────────────── */}
      <motion.div
        className="sa-header-banner"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sa-banner-title-group">
          <div className="sa-shield-icon-wrap" aria-hidden="true">
            <Activity size={22} />
          </div>
          <div>
            <div className="sa-meta-badges-row">
              <span className="sa-meta-badge sa-meta-badge--cyan">
                <ShieldCheck size={12} />
                Super Admin
              </span>
              <span className="sa-meta-badge sa-meta-badge--lime">
                <Sparkles size={12} />
                Phase 3
              </span>
              <span className="sa-meta-badge sa-meta-badge--purple">
                <Layers size={12} />
                Audit Stream
              </span>
              <span className="sa-meta-badge sa-meta-badge--amber">
                <span className="sa-meta-badge__dot" />
                Prototype RBAC Sandbox
              </span>
              <span className="sa-meta-badge sa-meta-badge--emerald">
                {activities.length} Recorded Events
              </span>
            </div>

            <h2 className="sa-banner-title">Super Admin Activity Stream</h2>
            <div className="sa-banner-sub">
              Captures all platform mutations, privileged role delegations, permission assignments, and security probes.
            </div>
          </div>
        </div>

        <div className="sa-banner-actions">
          <button
            type="button"
            className="sa-btn-primary"
            onClick={handleExportCSV}
            title="Download CSV of current filtered records"
          >
            <Download size={14} />
            Export Filtered CSV
          </button>

          <button
            type="button"
            className="sa-btn-secondary"
            onClick={() => setResetModalOpen(true)}
            title="Restore demonstration activities"
          >
            <RotateCcw size={14} />
            Reset Demo Log
          </button>
        </div>
      </motion.div>

      {/* ── 2. Overview KPI Cards ────────────────────────────────────────── */}
      <div className="sa-kpi-grid">
        <motion.div
          className="sa-kpi-card sa-kpi-card--primary"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Total Activity Events</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--lime">
              <Activity size={18} />
            </div>
          </div>
          <div className="sa-kpi-val">{kpiStats.totalEvents}</div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--up">Live Feed</span>
            <span>Recorded mutations</span>
          </div>
        </motion.div>

        <motion.div
          className="sa-kpi-card sa-kpi-card--cyan"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Events Today</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--cyan">
              <Clock size={18} />
            </div>
          </div>
          <div className="sa-kpi-val">{kpiStats.eventsToday}</div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--up">Last 24h</span>
            <span>Recent platform activity</span>
          </div>
        </motion.div>

        <motion.div
          className="sa-kpi-card sa-kpi-card--purple"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Active Administrators</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--purple">
              <UserCheck size={18} />
            </div>
          </div>
          <div className="sa-kpi-val">{kpiStats.uniqueActors}</div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--neutral">Actors</span>
            <span>Distinct privileged accounts</span>
          </div>
        </motion.div>

        <motion.div
          className="sa-kpi-card sa-kpi-card--red"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <div className="sa-kpi-header">
            <span className="sa-kpi-label">Critical Activities</span>
            <div className="sa-kpi-icon-wrap sa-stat-icon--red">
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="sa-kpi-val" style={{ color: '#ef4444' }}>
            {kpiStats.criticalCount}
          </div>
          <div className="sa-kpi-sub">
            <span className="sa-stat-trend sa-stat-trend--down">Elevated</span>
            <span>Deletions & security overrides</span>
          </div>
        </motion.div>
      </div>

      {/* ── 3. Visual Analytics Section (SVG / CSS Charts) ────────────────── */}
      <motion.div
        className="sa-analytics-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
      >
        <div className="sa-analytics-header">
          <div className="sa-analytics-title">
            <BarChart3 size={18} style={{ color: '#50e396' }} />
            <span>Activity Telemetry & Breakdown</span>
            <span className="sa-demo-chip" style={{ fontSize: '0.65rem' }}>
              Zero-Dependency SVG/CSS
            </span>
          </div>
          <button
            type="button"
            className="sa-btn-secondary"
            onClick={() => setShowAnalytics((v) => !v)}
            style={{ padding: '4px 10px', fontSize: '0.74rem' }}
          >
            {showAnalytics ? (
              <>
                <ChevronUp size={14} /> Hide Charts
              </>
            ) : (
              <>
                <ChevronDown size={14} /> Show Charts
              </>
            )}
          </button>
        </div>

        <AnimatePresence>
          {showAnalytics && (
            <motion.div
              className="sa-analytics-grid"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
            >
              {/* 1. Trends Over Time Bar Chart */}
              <div className="sa-analytics-subcard">
                <div className="sa-analytics-subcard-title">
                  <span>Activity Trends (Past 7 Days)</span>
                  <Calendar size={13} style={{ color: '#50e396' }} />
                </div>
                <div className="sa-bar-chart-wrap">
                  {analyticsData.trends.map((item, idx) => {
                    const heightPercent = Math.max(12, Math.round((item.count / analyticsData.maxTrendCount) * 100))
                    return (
                      <div key={idx} className="sa-bar-col" title={`${item.dateStr}: ${item.count} events`}>
                        <div className="sa-bar-tooltip">
                          {item.count} {item.count === 1 ? 'event' : 'events'}
                        </div>
                        <div className="sa-bar-fill" style={{ height: `${heightPercent}%` }} />
                        <div className="sa-bar-col-label">{item.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 2. Most Active Administrators Leaderboard */}
              <div className="sa-analytics-subcard">
                <div className="sa-analytics-subcard-title">
                  <span>Most Active Administrators</span>
                  <UserCheck size={13} style={{ color: '#22d3ee' }} />
                </div>
                <div className="sa-leaderboard">
                  {analyticsData.topAdmins.map((adm, i) => {
                    const acc = adminAccountMap.get(adm.email.toLowerCase())
                    const percent = Math.round((adm.count / analyticsData.maxAdminCount) * 100)
                    return (
                      <div
                        key={i}
                        className="sa-leaderboard-item"
                        onClick={() => setProfileAdminEmail(adm.email)}
                        style={{ cursor: 'pointer' }}
                        title="Click to view administrator profile"
                      >
                        <div className="sa-leaderboard-user">
                          <div
                            className="sa-avatar sa-avatar--sm"
                            style={{
                              background: acc?.avatarGradient || 'linear-gradient(135deg, #50e396, #0e3820)',
                              fontSize: '0.68rem',
                              borderRadius: '50%',
                            }}
                          >
                            {acc?.avatarInitials || adm.name.substring(0, 2).toUpperCase()}
                          </div>
                          <span className="sa-leaderboard-name">{adm.name}</span>
                        </div>
                        <div className="sa-leaderboard-bar">
                          <div className="sa-leaderboard-bar-fill" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="sa-leaderboard-count">{adm.count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 3. Category Distribution */}
              <div className="sa-analytics-subcard">
                <div className="sa-analytics-subcard-title">
                  <span>Category Distribution</span>
                  <Layers size={13} style={{ color: '#c084fc' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {ALL_CATEGORIES.map((cat) => {
                    const count = analyticsData.catCounts[cat] || 0
                    const percent = Math.round((count / analyticsData.totalCount) * 100)
                    return (
                      <div key={cat} className="sa-progress-stat">
                        <div className="sa-progress-stat-header">
                          <span className="sa-progress-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            {getCategoryIcon(cat)}
                            {cat}
                          </span>
                          <span className="sa-progress-stat-val">
                            {count} ({percent}%)
                          </span>
                        </div>
                        <div className="sa-progress-track">
                          <div
                            className="sa-progress-bar"
                            style={{
                              width: `${percent}%`,
                              background:
                                cat === 'Admin Accounts'
                                  ? '#22d3ee'
                                  : cat === 'Role Management'
                                  ? '#34d399'
                                  : cat === 'Permission Changes'
                                  ? '#c084fc'
                                  : cat === 'Security'
                                  ? '#f87171'
                                  : '#fbbf24',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 4. Severity Breakdown */}
              <div className="sa-analytics-subcard">
                <div className="sa-analytics-subcard-title">
                  <span>Severity Breakdown</span>
                  <AlertTriangle size={13} style={{ color: '#f87171' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {(['critical', 'warning', 'info', 'success'] as ActivitySeverity[]).map((sev) => {
                    const count = analyticsData.sevCounts[sev] || 0
                    const percent = Math.round((count / analyticsData.totalCount) * 100)
                    return (
                      <div key={sev} className="sa-progress-stat">
                        <div className="sa-progress-stat-header">
                          <span className="sa-progress-stat-label" style={{ textTransform: 'capitalize' }}>
                            {sev}
                          </span>
                          <span className="sa-progress-stat-val">
                            {count} ({percent}%)
                          </span>
                        </div>
                        <div className="sa-progress-track">
                          <div
                            className="sa-progress-bar"
                            style={{
                              width: `${percent}%`,
                              background: getSeverityDotColor(sev),
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── 4. Unified Search & Filter Bar ───────────────────────────────── */}
      <div className="sa-filter-bar" style={{ marginBottom: 18 }}>
        <div className="sa-search-wrap" style={{ flex: '1 1 240px' }}>
          <Search size={15} className="sa-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search by admin name, email, action, resource, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="sa-search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filter by Administrator */}
        <select
          className="sa-select"
          value={selectedAdmin}
          onChange={(e) => setSelectedAdmin(e.target.value)}
          title="Filter by Administrator"
          style={{ minWidth: 160 }}
        >
          <option value="all">All Administrators</option>
          {adminAccounts.map((acc) => (
            <option key={acc.id} value={acc.email}>
              {acc.fullName} ({acc.email.split('@')[0]})
            </option>
          ))}
        </select>

        {/* Filter by Category */}
        <select
          className="sa-select"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          title="Filter by Category"
          style={{ minWidth: 150 }}
        >
          <option value="all">All Categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* Filter by Severity */}
        <select
          className="sa-select"
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          title="Filter by Severity"
          style={{ minWidth: 130 }}
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
        </select>

        {/* Filter by Date Range */}
        <select
          className="sa-select"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as any)}
          title="Filter by Date Range"
          style={{ minWidth: 120 }}
        >
          <option value="all">All Time</option>
          <option value="today">Today (24h)</option>
          <option value="7days">Last 7 Days</option>
          <option value="30days">Last 30 Days</option>
        </select>

        {/* Sort Options */}
        <select
          className="sa-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          title="Sort order"
          style={{ minWidth: 130 }}
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="severity">Highest Severity</option>
        </select>

        {activeFiltersCount > 0 && (
          <button
            type="button"
            className="sa-btn-secondary"
            onClick={handleClearFilters}
            style={{ padding: '7px 12px', fontSize: '0.78rem' }}
          >
            <X size={13} />
            Clear ({activeFiltersCount})
          </button>
        )}
      </div>

      {/* ── 5. Results Counter & Active Query Status ──────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
          padding: '0 4px',
          fontSize: '0.8rem',
          color: '#94a3b8',
        }}
      >
        <div>
          Showing{' '}
          <strong style={{ color: '#50e396' }}>{filteredActivities.length}</strong>{' '}
          {filteredActivities.length === 1 ? 'event' : 'events'}{' '}
          {activities.length !== filteredActivities.length && `(filtered from ${activities.length} total)`}
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="sa-page-btn"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                aria-label="Previous Page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="sa-page-btn"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next Page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 6. Activity Timeline Feed ─────────────────────────────────────── */}
      {paginatedActivities.length === 0 ? (
        <div className="sa-empty-state">
          <div className="sa-empty-icon-wrap" style={{ background: 'rgba(80, 227, 150, 0.1)', color: '#50e396' }}>
            <Activity size={24} />
          </div>
          <h3 className="sa-empty-title">No Activity Events Found</h3>
          <p className="sa-empty-desc">
            No events match your current filter parameters. Try clearing your search query or selecting a broader date range.
          </p>
          {activeFiltersCount > 0 && (
            <button type="button" className="sa-btn-primary" onClick={handleClearFilters}>
              Clear All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="sa-activity-feed">
          {paginatedActivities.map((act) => {
            const acc = adminAccountMap.get(act.adminEmail.toLowerCase())
            const cardSeverityClass =
              act.severity === 'critical'
                ? 'sa-activity-card--critical'
                : act.severity === 'warning'
                ? 'sa-activity-card--warning'
                : act.severity === 'success'
                ? 'sa-activity-card--success'
                : 'sa-activity-card--info'

            return (
              <motion.div
                key={act.id}
                className={`sa-activity-card ${cardSeverityClass}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Clickable Admin Avatar */}
                <button
                  type="button"
                  className="sa-activity-avatar-btn"
                  onClick={() => setProfileAdminEmail(act.adminEmail)}
                  title={`View ${act.adminName}'s activity profile`}
                >
                  <div
                    className="sa-avatar sa-avatar--md"
                    style={{
                      background: acc?.avatarGradient || 'linear-gradient(135deg, #50e396, #0e3820)',
                      borderRadius: '50%',
                    }}
                  >
                    {acc?.avatarInitials || act.adminName.substring(0, 2).toUpperCase()}
                  </div>
                </button>

                {/* Event Main Content */}
                <div className="sa-activity-content">
                  {/* Top line: Actor info, Category, Severity, Time */}
                  <div className="sa-activity-header">
                    <div className="sa-activity-actor-info">
                      <button
                        type="button"
                        className="sa-activity-actor-name"
                        onClick={() => setProfileAdminEmail(act.adminEmail)}
                        title="View administrator profile"
                      >
                        {act.adminName}
                      </button>
                      <span className="sa-activity-actor-email">{act.adminEmail}</span>
                      <span className={getCategoryBadgeClass(act.category)}>
                        {getCategoryIcon(act.category)}
                        {act.category}
                      </span>
                      <span className={getSeverityBadgeClass(act.severity)}>{act.severity}</span>
                    </div>

                    <div className="sa-activity-time" title={act.isoTimestamp}>
                      <Clock size={12} />
                      {act.timestamp}
                    </div>
                  </div>

                  {/* Action Headline & Affected Resource */}
                  <div className="sa-activity-action-row">
                    <span className="sa-activity-action-title">{act.action}</span>
                    <span className="sa-activity-target" title={act.targetResource}>
                      {act.targetResource}
                    </span>
                  </div>

                  {/* Description */}
                  {act.description && <p className="sa-activity-desc">{act.description}</p>}

                  {/* Diff Snippet Preview (if present) */}
                  {(act.previousValue || act.newValue) && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        fontSize: '0.74rem',
                        marginTop: 2,
                        flexWrap: 'wrap',
                      }}
                    >
                      {act.previousValue && (
                        <span style={{ color: '#f87171' }}>
                          <strong>Previous:</strong> {act.previousValue}
                        </span>
                      )}
                      {act.previousValue && act.newValue && <span style={{ color: '#64748b' }}>→</span>}
                      {act.newValue && (
                        <span style={{ color: '#34d399' }}>
                          <strong>New:</strong> {act.newValue}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Bottom Meta & View Details Button */}
                  <div className="sa-activity-meta-bottom">
                    <div className="sa-activity-source-tag">
                      <span>Source: {act.source || 'Super Admin Portal'}</span>
                      {act.ipAddress && (
                        <>
                          <span>•</span>
                          <span>IP: {act.ipAddress}</span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="sa-activity-details-btn"
                      onClick={() => setSelectedEvent(act)}
                    >
                      <Eye size={12} />
                      Inspect Event
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* ── 7. Pagination Footer ─────────────────────────────────────────── */}
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

      {/* ── 8. Modal: Activity Details Inspection ────────────────────────── */}
      <AnimatePresence>
        {selectedEvent && (
          <div
            className="sa-modal-overlay"
            onClick={() => setSelectedEvent(null)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              className="sa-modal-container"
              style={{ maxWidth: 640 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-shield-icon-wrap" style={{ width: 34, height: 34 }}>
                    <Activity size={17} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Activity Event Details</h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      Event ID: <strong style={{ color: '#50e396', fontFamily: 'monospace' }}>{selectedEvent.id}</strong>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close"
                  onClick={() => setSelectedEvent(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                {/* Event Badges & Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={getCategoryBadgeClass(selectedEvent.category)}>
                    {getCategoryIcon(selectedEvent.category)}
                    {selectedEvent.category}
                  </span>
                  <span className={getSeverityBadgeClass(selectedEvent.severity)}>
                    {selectedEvent.severity}
                  </span>
                  <span
                    className="sa-activity-target"
                    style={{ marginLeft: 'auto', fontSize: '0.72rem' }}
                  >
                    {selectedEvent.timestamp}
                  </span>
                </div>

                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', marginTop: 4 }}>
                  {selectedEvent.action}
                </div>

                {/* Actor Information Pill */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      className="sa-avatar sa-avatar--sm"
                      style={{
                        background:
                          adminAccountMap.get(selectedEvent.adminEmail.toLowerCase())?.avatarGradient ||
                          'linear-gradient(135deg, #50e396, #0e3820)',
                        borderRadius: '50%',
                      }}
                    >
                      {selectedEvent.adminName.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff' }}>
                        {selectedEvent.adminName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                        {selectedEvent.adminEmail}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="sa-btn-secondary"
                    onClick={() => {
                      const email = selectedEvent.adminEmail
                      setSelectedEvent(null)
                      setProfileAdminEmail(email)
                    }}
                    style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                  >
                    <User size={13} /> View Profile
                  </button>
                </div>

                {/* Affected Resource & Description */}
                <div>
                  <div className="sa-detail-label">Affected Target Resource</div>
                  <div
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(0, 0, 0, 0.45)',
                      border: '1px solid rgba(80, 227, 150, 0.2)',
                      borderRadius: 6,
                      fontSize: '0.82rem',
                      color: '#50e396',
                      fontFamily: 'monospace',
                    }}
                  >
                    {selectedEvent.targetResource}
                  </div>
                </div>

                {selectedEvent.description && (
                  <div>
                    <div className="sa-detail-label">Contextual Description</div>
                    <div
                      style={{
                        fontSize: '0.82rem',
                        color: '#cbd5e1',
                        lineHeight: 1.5,
                        background: 'rgba(255, 255, 255, 0.02)',
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                      }}
                    >
                      {selectedEvent.description}
                    </div>
                  </div>
                )}

                {/* Previous Value vs New Value Diff Viewer */}
                {(selectedEvent.previousValue || selectedEvent.newValue) && (
                  <div>
                    <div className="sa-detail-label">State Mutation (Diff Comparison)</div>
                    <div className="sa-diff-container">
                      <div className="sa-diff-box">
                        <span className="sa-diff-title sa-diff-title--prev">Previous State</span>
                        <div className="sa-diff-val sa-diff-val--prev">
                          {selectedEvent.previousValue || 'None / Not applicable'}
                        </div>
                      </div>
                      <div className="sa-diff-box">
                        <span className="sa-diff-title sa-diff-title--new">New State</span>
                        <div className="sa-diff-val sa-diff-val--new">
                          {selectedEvent.newValue || 'None / Not applicable'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Telemetry Metadata Grid */}
                <div>
                  <div className="sa-detail-label">Telemetry & Origin</div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                      fontSize: '0.78rem',
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 10px',
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: 6,
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <div style={{ color: '#64748b', fontSize: '0.68rem', fontWeight: 700 }}>
                        ISO 8601 TIMESTAMP
                      </div>
                      <div style={{ color: '#e2e8f0', fontFamily: 'monospace', marginTop: 2 }}>
                        {selectedEvent.isoTimestamp}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '8px 10px',
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: 6,
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <div style={{ color: '#64748b', fontSize: '0.68rem', fontWeight: 700 }}>
                        CALLING SOURCE
                      </div>
                      <div style={{ color: '#e2e8f0', marginTop: 2 }}>
                        {selectedEvent.source || 'Super Admin Portal'}
                      </div>
                    </div>

                    <div
                      style={{
                        gridColumn: '1 / -1',
                        padding: '8px 10px',
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: 6,
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <div style={{ color: '#64748b', fontSize: '0.68rem', fontWeight: 700 }}>
                        CLIENT IP & GEOLOCATION
                      </div>
                      <div style={{ color: '#e2e8f0', fontFamily: 'monospace', marginTop: 2 }}>
                        {selectedEvent.ipAddress || '103.21.144.62 (Bengaluru, IN)'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="sa-btn-secondary"
                  onClick={() => copyToClipboard(selectedEvent.id, selectedEvent.id)}
                >
                  {copiedId === selectedEvent.id ? <Check size={14} style={{ color: '#50e396' }} /> : <Copy size={14} />}
                  {copiedId === selectedEvent.id ? 'Copied!' : 'Copy Event ID'}
                </button>
                <button
                  type="button"
                  className="sa-btn-primary"
                  onClick={() => setSelectedEvent(null)}
                >
                  Close Inspection
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 9. Modal: Administrator Activity Profile ─────────────────────── */}
      <AnimatePresence>
        {profileAdminData && (
          <div
            className="sa-modal-overlay"
            onClick={() => setProfileAdminEmail(null)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              className="sa-modal-container"
              style={{ maxWidth: 680 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className="sa-avatar sa-avatar--md"
                    style={{ background: profileAdminData.avatarGradient, borderRadius: '50%' }}
                  >
                    {profileAdminData.avatarInitials}
                  </div>
                  <div>
                    <h3 className="sa-modal-title">{profileAdminData.name}</h3>
                    <div style={{ fontSize: '0.76rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                      {profileAdminData.email}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close"
                  onClick={() => setProfileAdminEmail(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                {/* Admin Status & Department Tags */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={getAdminRoleMeta(profileAdminData.role).badgeClass}>
                    {getAdminRoleMeta(profileAdminData.role).title}
                  </span>
                  <span
                    className={`chip ${
                      profileAdminData.status === 'active'
                        ? 'chip--lime'
                        : profileAdminData.status === 'inactive'
                        ? 'chip--red'
                        : 'chip--amber'
                    }`}
                  >
                    {profileAdminData.status.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.76rem', color: '#94a3b8', marginLeft: 'auto' }}>
                    Department: <strong style={{ color: '#ffffff' }}>{profileAdminData.department}</strong>
                  </span>
                </div>

                {/* Metrics Grid */}
                <div className="sa-profile-stats-grid">
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Total Events</span>
                    <span className="sa-profile-stat-val" style={{ color: '#50e396' }}>
                      {profileAdminData.totalCount}
                    </span>
                  </div>
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Critical Events</span>
                    <span className="sa-profile-stat-val" style={{ color: '#ef4444' }}>
                      {profileAdminData.criticalCount}
                    </span>
                  </div>
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Top Category</span>
                    <span
                      className="sa-profile-stat-val"
                      style={{ fontSize: '0.88rem', color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {profileAdminData.topCategory}
                    </span>
                  </div>
                  <div className="sa-profile-stat-box">
                    <span className="sa-profile-stat-lbl">Last Active</span>
                    <span
                      className="sa-profile-stat-val"
                      style={{ fontSize: '0.88rem', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {profileAdminData.lastEvent?.timestamp || 'Recently'}
                    </span>
                  </div>
                </div>

                {/* Category Breakdown for this Admin */}
                <div>
                  <div className="sa-detail-label">Category Breakdown</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ALL_CATEGORIES.map((cat) => {
                      const count = profileAdminData.catMap.get(cat) || 0
                      return (
                        <span key={cat} className={getCategoryBadgeClass(cat)}>
                          {getCategoryIcon(cat)}
                          {cat}: <strong>{count}</strong>
                        </span>
                      )
                    })}
                  </div>
                </div>

                {/* Chronological Event History */}
                <div>
                  <div className="sa-profile-history-title">
                    <span>Recorded Activity Log ({profileAdminData.events.length})</span>
                  </div>

                  <div
                    style={{
                      maxHeight: 240,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      paddingRight: 4,
                    }}
                  >
                    {profileAdminData.events.map((e) => (
                      <div
                        key={e.id}
                        style={{
                          padding: '10px 12px',
                          background: 'rgba(0, 0, 0, 0.35)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={getSeverityBadgeClass(e.severity)}>{e.severity}</span>
                            <span
                              style={{
                                fontSize: '0.84rem',
                                fontWeight: 600,
                                color: '#ffffff',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {e.action}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '0.74rem',
                              color: '#94a3b8',
                              marginTop: 2,
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {e.targetResource}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{e.timestamp}</span>
                          <button
                            type="button"
                            className="sa-activity-details-btn"
                            onClick={() => {
                              setSelectedEvent(e)
                              setProfileAdminEmail(null)
                            }}
                            title="Inspect this specific event"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="sa-btn-primary"
                  onClick={() => setProfileAdminEmail(null)}
                >
                  Close Profile
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 10. Modal: Reset Demonstration Activities Confirmation ────────── */}
      <AnimatePresence>
        {resetModalOpen && (
          <div
            className="sa-modal-overlay"
            onClick={() => setResetModalOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              className="sa-modal-container"
              style={{ maxWidth: 480 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-shield-icon-wrap" style={{ width: 34, height: 34, color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.12)' }}>
                    <RotateCcw size={17} />
                  </div>
                  <h3 className="sa-modal-title">Reset Activity Demonstration Log?</h3>
                </div>
                <button
                  type="button"
                  className="sa-modal-close"
                  onClick={() => setResetModalOpen(false)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                  This will restore the activity monitoring stream to the 14 seeded platform demonstration records, resetting all custom mutation logs created during this browser session.
                </p>
                <div
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    borderRadius: 8,
                    fontSize: '0.78rem',
                    color: '#fbbf24',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={15} flex-shrink="0" />
                  <span>Seed demonstration records will be refreshed with current timestamps.</span>
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="sa-btn-secondary"
                  onClick={() => setResetModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="sa-btn-primary"
                  onClick={handleConfirmReset}
                >
                  Yes, Reset Demo Log
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 11. Toast Notifications ───────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className={`sa-toast ${toast.type === 'error' ? 'sa-toast--error' : toast.type === 'info' ? 'sa-toast--info' : 'sa-toast--success'}`}
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
              background: toast.type === 'error' ? '#1c0d0d' : toast.type === 'info' ? '#0b1d24' : '#081d13',
              border: `1px solid ${toast.type === 'error' ? '#ef4444' : toast.type === 'info' ? '#38bdf8' : '#50e396'}`,
              color: toast.type === 'error' ? '#fca5a5' : toast.type === 'info' ? '#7dd3fc' : '#86efac',
              boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
            }}
          >
            {toast.type === 'error' ? (
              <AlertTriangle size={15} />
            ) : toast.type === 'info' ? (
              <Activity size={15} />
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
