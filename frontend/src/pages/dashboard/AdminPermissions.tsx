import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Sliders,
  ShieldCheck,
  Search,
  Eye,
  Edit2,
  Lock,
  Check,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  X,
  Users,
  LayoutGrid,
  List,
  Sparkles,
  Cpu,
  DollarSign,
  Shield,
  Globe,
  KeyRound,
  ExternalLink,
  Plus,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  getAllRoles,
  PLATFORM_PERMISSIONS,
  getPermissionCategories,
  getPermissionSummaryStats,
  getPermissionImpact,
  getRolesForPermission,
  toggleCustomRolePermission,
  setCustomRolePermissions,
  resetToDefaultRoles,
  type RolePermission,
  type PermissionCategory,
  type AdminRoleDefinition,
  type PermissionImpactData,
} from '../../lib/adminRoleStore'
import { getAdminRoleMeta } from '../../lib/adminAccountStore'

function getCategoryIcon(category: PermissionCategory) {
  switch (category) {
    case 'GPU Infrastructure':
      return <Cpu size={14} style={{ color: '#06b6d4' }} />
    case 'FinOps & Billing':
      return <DollarSign size={14} style={{ color: '#f59e0b' }} />
    case 'Customer & Workspaces':
      return <Users size={14} style={{ color: '#a855f7' }} />
    case 'Security & Compliance':
      return <Shield size={14} style={{ color: '#ef4444' }} />
    case 'Administration & RBAC':
      return <KeyRound size={14} style={{ color: '#50e396' }} />
    case 'API & Networking':
      return <Globe size={14} style={{ color: '#38bdf8' }} />
    default:
      return <Sliders size={14} style={{ color: '#94a3b8' }} />
  }
}

export default function AdminPermissions() {
  usePageMeta(
    'Permission Management · Inferxe Super Admin',
    'Inspect granular platform permissions, role matrices, and affected administrator impact.'
  )

  // Data State
  const [roles, setRoles] = useState<AdminRoleDefinition[]>(() => getAllRoles())
  const [stats, setStats] = useState(() => getPermissionSummaryStats())

  // Controls & Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PermissionCategory>('all')
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'assigned' | 'unassigned' | 'custom'>('all')
  const [viewMode, setViewMode] = useState<'matrix' | 'table'>('matrix')

  // Modals & Drawers
  const [selectedImpact, setSelectedImpact] = useState<PermissionImpactData | null>(null)
  const [editingRoleForPerms, setEditingRoleForPerms] = useState<AdminRoleDefinition | null>(null)
  const [pendingPerms, setPendingPerms] = useState<string[]>([])
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3800)
    return () => clearTimeout(timer)
  }, [toast])

  // Sync data on changes
  const reloadData = useCallback(() => {
    setRoles(getAllRoles())
    setStats(getPermissionSummaryStats())
  }, [])

  useEffect(() => {
    window.addEventListener('inferxe_admin_roles_change', reloadData)
    window.addEventListener('inferxe_admin_accounts_change', reloadData)
    window.addEventListener('storage', reloadData)
    return () => {
      window.removeEventListener('inferxe_admin_roles_change', reloadData)
      window.removeEventListener('inferxe_admin_accounts_change', reloadData)
      window.removeEventListener('storage', reloadData)
    }
  }, [reloadData])

  // Lock body scroll when modal open
  const isAnyModalOpen = Boolean(selectedImpact || editingRoleForPerms || resetModalOpen)

  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden'
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setSelectedImpact(null)
          setEditingRoleForPerms(null)
          setResetModalOpen(false)
        }
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        document.body.style.overflow = ''
        window.removeEventListener('keydown', handleKeyDown)
      }
    } else {
      document.body.style.overflow = ''
    }
  }, [isAnyModalOpen])

  // Group permissions by category
  const permissionsByCategory = useMemo(() => {
    const categories = getPermissionCategories()
    const map = new Map<PermissionCategory, RolePermission[]>()
    categories.forEach((cat) => map.set(cat, []))
    PLATFORM_PERMISSIONS.forEach((perm) => {
      const list = map.get(perm.category) || []
      list.push(perm)
      map.set(perm.category, list)
    })
    return map
  }, [])

  // Filtered permissions
  const filteredPermissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return PLATFORM_PERMISSIONS.filter((perm) => {
      // Category filter
      if (categoryFilter !== 'all' && perm.category !== categoryFilter) {
        return false
      }

      // Assignment filter
      const rolesUsing = roles.filter((r) => r.permissions.includes(perm.id))
      const hasCustom = rolesUsing.some((r) => !r.isStandard)

      if (assignmentFilter === 'assigned' && rolesUsing.length === 0) return false
      if (assignmentFilter === 'unassigned' && rolesUsing.length > 0) return false
      if (assignmentFilter === 'custom' && !hasCustom) return false

      // Search query
      if (!q) return true
      const matchName = perm.name.toLowerCase().includes(q)
      const matchCode = perm.id.toLowerCase().includes(q)
      const matchDesc = perm.description.toLowerCase().includes(q)
      const matchCat = perm.category.toLowerCase().includes(q)
      return matchName || matchCode || matchDesc || matchCat
    })
  }, [searchQuery, categoryFilter, assignmentFilter, roles])

  // Standard vs Custom roles split for matrix
  const standardRoles = useMemo(() => roles.filter((r) => r.isStandard), [roles])
  const customRoles = useMemo(() => roles.filter((r) => !r.isStandard), [roles])

  // Quick toggle single permission on custom role
  const handleToggleCell = (role: AdminRoleDefinition, permId: string) => {
    if (role.isStandard) {
      showToast('Standard platform roles are protected and immutable.', 'error')
      return
    }

    const res = toggleCustomRolePermission(role.id, permId)
    if (!res.ok) {
      showToast(res.error || 'Failed to toggle permission.', 'error')
      return
    }

    const action = res.role?.permissions.includes(permId) ? 'Granted' : 'Revoked'
    showToast(`${action} "${permId}" for role ${role.name}.`)
    reloadData()
  }

  // Open Permission Assignment Modal for a specific custom role
  const openEditPermissionsModal = (role: AdminRoleDefinition) => {
    if (role.isStandard) {
      showToast('Standard platform roles are protected and cannot be modified.', 'error')
      return
    }
    setEditingRoleForPerms(role)
    setPendingPerms([...role.permissions])
  }

  // Handle Save in Permission Assignment Modal
  const handleSaveRolePermissions = () => {
    if (!editingRoleForPerms) return

    const res = setCustomRolePermissions(editingRoleForPerms.id, pendingPerms)
    if (!res.ok) {
      showToast(res.error || 'Failed to update permissions.', 'error')
      return
    }

    setEditingRoleForPerms(null)
    reloadData()
    showToast(`Updated permissions for "${editingRoleForPerms.name}" (${pendingPerms.length} granted).`)
  }

  // Modal helpers for permission assignment
  const togglePendingPerm = (permId: string) => {
    setPendingPerms((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    )
  }

  const toggleCategoryInModal = (cat: PermissionCategory) => {
    const catPerms = (permissionsByCategory.get(cat) || []).map((p) => p.id)
    const allSelected = catPerms.every((id) => pendingPerms.includes(id))

    if (allSelected) {
      setPendingPerms((prev) => prev.filter((id) => !catPerms.includes(id)))
    } else {
      setPendingPerms((prev) => Array.from(new Set([...prev, ...catPerms])))
    }
  }

  const selectAllInModal = () => {
    setPendingPerms(PLATFORM_PERMISSIONS.map((p) => p.id))
  }

  const clearAllInModal = () => {
    setPendingPerms([])
  }

  return (
    <DashboardLayout>
      <div className="sa-overview-root">
        {/* Toast Alert */}
        <AnimatePresence>
          {toast && (
            <motion.div
              className={`sa-toast sa-toast--${toast.type}`}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              {toast.type === 'success' ? (
                <CheckCircle2 size={16} style={{ color: '#50e396', flexShrink: 0 }} />
              ) : (
                <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
              )}
              <span>{toast.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 1. Top Governance Banner ────────────────────────── */}
        <div className="sa-header-banner">
          <div className="sa-banner-title-group">
            <div className="sa-shield-icon-wrap" aria-hidden="true">
              <Sliders size={22} />
            </div>
            <div>
              {/* Separated Metadata Badges */}
              <div className="sa-meta-badges-row">
                <span className="sa-meta-badge sa-meta-badge--primary">
                  <ShieldCheck size={12} />
                  <span>Super Admin</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--phase">
                  <Sliders size={12} />
                  <span>Phase 2.2</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--sandbox">
                  <span className="sa-meta-badge__dot" />
                  <span>Prototype RBAC Sandbox</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--count">
                  <KeyRound size={12} />
                  <span>{PLATFORM_PERMISSIONS.length} Platform Permissions</span>
                </span>
              </div>
              <h2 className="sa-banner-title">
                <span>Permission Management</span>
              </h2>
              <div className="sa-banner-sub">
                Inspect platform capability definitions, evaluate role inheritance matrices, and audit authorization impact across sovereign GPU infrastructure.
              </div>
            </div>
          </div>

          <div className="sa-banner-actions">
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => setResetModalOpen(true)}
              title="Reset prototype custom roles to seed default"
            >
              <RotateCcw size={14} />
              <span>Reset Prototype Roles</span>
            </button>
            {customRoles.length > 0 && (
              <button
                type="button"
                className="dash-primary-btn"
                onClick={() => openEditPermissionsModal(customRoles[0])}
              >
                <Edit2 size={14} />
                <span>Configure {customRoles[0].name}</span>
              </button>
            )}
          </div>
        </div>

        {/* ── 2. Demo Transparency Callout ──────────────────── */}
        <div className="sa-demo-banner" role="status">
          <AlertCircle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong style={{ color: '#fef3c7' }}>Prototype RBAC Matrix Simulation:</strong>
            <div style={{ marginTop: 2, color: '#fcd34d', fontSize: '0.8rem', lineHeight: 1.45 }}>
              Standard roles (Super Admin, Infrastructure, Billing, Support, Security Auditor) represent immutable platform profiles. Custom role assignments persist locally and dynamically update administrator authorization impact.
            </div>
          </div>
        </div>

        {/* ── 3. KPI Statistics Grid ────────────────────────── */}
        <div className="sa-kpi-grid">
          {/* Total Permissions */}
          <div className="sa-kpi-card sa-kpi-card--primary">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Total Permissions</span>
              <div className="sa-kpi-card__icon-wrap">
                <Sliders size={17} style={{ color: '#50e396' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.totalPermissions}</div>
            <div className="sa-kpi-card__subtext">
              <span>6 Sovereign capability domains</span>
            </div>
          </div>

          {/* Capability Domains */}
          <div className="sa-kpi-card sa-kpi-card--cyan">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Capability Domains</span>
              <div className="sa-kpi-card__icon-wrap">
                <Cpu size={17} style={{ color: '#06b6d4' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.totalCategories}</div>
            <div className="sa-kpi-card__subtext">
              <span style={{ color: '#38bdf8' }}>GPU, FinOps, Tenants, Security...</span>
            </div>
          </div>

          {/* Platform Coverage */}
          <div className="sa-kpi-card sa-kpi-card--purple">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Platform Coverage</span>
              <div className="sa-kpi-card__icon-wrap">
                <ShieldCheck size={17} style={{ color: '#a855f7' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">
              {stats.assignedCount} / {stats.totalPermissions}
            </div>
            <div className="sa-kpi-card__subtext">
              <span>100% Platform protected</span>
            </div>
          </div>

          {/* Custom Role Grants */}
          <div className="sa-kpi-card sa-kpi-card--emerald">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Custom Role Grants</span>
              <div className="sa-kpi-card__icon-wrap">
                <Sparkles size={17} style={{ color: '#10b981' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.customAssignedCount}</div>
            <div className="sa-kpi-card__subtext">
              <span>Active in {customRoles.length} custom role(s)</span>
            </div>
          </div>
        </div>

        {/* ── 4. Search, Filter & Layout Controls ───────────── */}
        <div className="sa-accounts-controls">
          {/* Search */}
          <div className="sa-search-wrap">
            <Search size={15} className="sa-search-icon" />
            <input
              type="text"
              className="sa-search-input"
              placeholder="Search by permission name, code (e.g. infra:nodes), or scope..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search permissions"
            />
            {searchQuery && (
              <button
                type="button"
                className="sa-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Category Filter */}
          <select
            className="sa-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | PermissionCategory)}
            aria-label="Filter by category domain"
          >
            <option value="all">All Capability Domains (6)</option>
            {getPermissionCategories().map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Assignment Filter */}
          <select
            className="sa-select"
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value as any)}
            aria-label="Filter by assignment scope"
          >
            <option value="all">All Permissions ({PLATFORM_PERMISSIONS.length})</option>
            <option value="custom">Granted in Custom Roles ({stats.customAssignedCount})</option>
            <option value="assigned">Assigned to Any Role ({stats.assignedCount})</option>
            <option value="unassigned">Unassigned (0)</option>
          </select>

          {/* Reset Filters */}
          {(searchQuery || categoryFilter !== 'all' || assignmentFilter !== 'all') && (
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
                setAssignmentFilter('all')
              }}
            >
              Reset Filters
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="sa-view-toggle" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={`sa-view-toggle-btn ${viewMode === 'matrix' ? 'is-active' : ''}`}
              onClick={() => setViewMode('matrix')}
              title="Role-Permission Matrix View"
              aria-label="Matrix view"
            >
              <LayoutGrid size={14} />
              <span>Matrix View</span>
            </button>
            <button
              type="button"
              className={`sa-view-toggle-btn ${viewMode === 'table' ? 'is-active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Directory Table View"
              aria-label="Table view"
            >
              <List size={14} />
              <span>Directory</span>
            </button>
          </div>
        </div>

        {/* ── 5. Main Content: Matrix vs Table View ─────────── */}
        {filteredPermissions.length === 0 ? (
          <div className="sa-empty-state">
            <Sliders size={36} style={{ color: '#64748b', margin: '0 auto 12px' }} />
            <h3 style={{ color: '#ffffff', fontSize: '1rem', fontWeight: 600, margin: '0 0 4px' }}>
              No Permissions Match Your Filter
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '0.82rem', maxWidth: 420, margin: '0 auto 16px' }}>
              Try adjusting your search query or domain filter to inspect platform permissions.
            </p>
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
                setAssignmentFilter('all')
              }}
            >
              Clear All Filters
            </button>
          </div>
        ) : viewMode === 'matrix' ? (
          /* ── 5A. Role-Permission Interactive Matrix ───────── */
          <div className="sa-matrix-table-card">
            <div className="sa-matrix-table-wrap">
              <table
                className="sa-matrix-table"
                style={{
                  minWidth: `${320 + (standardRoles.length + customRoles.length) * 140}px`,
                }}
              >
                <colgroup>
                  <col className="sa-col-perm" />
                  {standardRoles.map((role) => (
                    <col key={role.id} className="sa-col-role" />
                  ))}
                  {customRoles.map((role) => (
                    <col key={role.id} className="sa-col-role" />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {/* Sticky Permission Details Column */}
                    <th className="sa-matrix-th-perm">Platform Capability</th>

                    {/* Standard Roles Columns */}
                    {standardRoles.map((role) => (
                      <th key={role.id} className="sa-matrix-th-role">
                        <div className="sa-matrix-role-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: role.color,
                                boxShadow: `0 0 6px ${role.color}`,
                              }}
                            />
                            <span>{role.name}</span>
                          </div>
                          <span
                            className="sa-category-tag"
                            style={{
                              background: 'rgba(6, 182, 212, 0.1)',
                              borderColor: 'rgba(6, 182, 212, 0.25)',
                              color: '#38bdf8',
                              fontSize: '0.62rem',
                              padding: '1px 5px',
                            }}
                          >
                            <Lock size={9} style={{ display: 'inline', marginRight: 3 }} />
                            Standard
                          </span>
                        </div>
                      </th>
                    ))}

                    {/* Custom Roles Columns */}
                    {customRoles.map((role) => (
                      <th key={role.id} className="sa-matrix-th-role sa-matrix-th-role--custom">
                        <div className="sa-matrix-role-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: role.color,
                                boxShadow: `0 0 6px ${role.color}`,
                              }}
                            />
                            <span>{role.name}</span>
                          </div>
                          <button
                            type="button"
                            className="sa-category-tag"
                            onClick={() => openEditPermissionsModal(role)}
                            style={{
                              background: 'rgba(16, 185, 129, 0.1)',
                              borderColor: 'rgba(16, 185, 129, 0.3)',
                              color: '#34d399',
                              fontSize: '0.62rem',
                              padding: '1px 6px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                            title="Click to edit permissions for this custom role"
                          >
                            <Edit2 size={9} />
                            <span>Edit Role</span>
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getPermissionCategories().map((cat) => {
                    const catPerms = filteredPermissions.filter((p) => p.category === cat)
                    if (catPerms.length === 0) return null

                    return (
                      <Fragment key={cat}>
                        {/* Category Divider Row */}
                        <tr className="sa-matrix-category-header-row">
                          {/* Sticky Category Heading in Column 1 */}
                          <td className="sa-matrix-td-perm sa-matrix-category-sticky-td">
                            <div className="sa-matrix-category-heading">
                              {getCategoryIcon(cat)}
                              <span className="sa-matrix-category-title">{cat}</span>
                              <span className="sa-matrix-category-count">
                                ({catPerms.length} capabilities)
                              </span>
                            </div>
                          </td>

                          {/* Category Divider Line Spanning Role Columns */}
                          <td
                            colSpan={standardRoles.length + customRoles.length}
                            className="sa-matrix-category-divider-td"
                          >
                            <div className="sa-matrix-category-divider-line" />
                          </td>
                        </tr>

                        {/* Permission Rows */}
                        {catPerms.map((perm) => {
                          const impact = getPermissionImpact(perm.id)

                          return (
                            <tr key={perm.id}>
                              {/* Sticky Permission Name & Code */}
                              <td className="sa-matrix-td-perm">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 8,
                                    }}
                                  >
                                    <span style={{ fontWeight: 600, color: '#ffffff' }}>
                                      {perm.name}
                                    </span>
                                    <button
                                      type="button"
                                      className="sa-impact-badge"
                                      onClick={() => setSelectedImpact(impact || null)}
                                      title="Inspect administrator impact"
                                    >
                                      <Users size={11} />
                                      <span>{impact?.affectedAdminsCount || 0}</span>
                                    </button>
                                  </div>
                                  <span
                                    style={{
                                      fontFamily: 'var(--font-mono, monospace)',
                                      fontSize: '0.68rem',
                                      color: '#64748b',
                                    }}
                                  >
                                    {perm.id}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '0.72rem',
                                      color: '#94a3b8',
                                      lineHeight: 1.3,
                                      whiteSpace: 'normal',
                                      marginTop: 2,
                                    }}
                                  >
                                    {perm.description}
                                  </span>
                                </div>
                              </td>

                              {/* Standard Roles Cells (Protected) */}
                              {standardRoles.map((role) => {
                                const isGranted = role.permissions.includes(perm.id)
                                return (
                                  <td
                                    key={role.id}
                                    className="sa-matrix-cell"
                                    title={`${role.name}: ${isGranted ? 'Granted' : 'Not Granted'} (Immutable standard role)`}
                                  >
                                    {isGranted ? (
                                      <span className="sa-matrix-check sa-matrix-check--standard">
                                        <Check size={14} />
                                      </span>
                                    ) : (
                                      <span className="sa-matrix-dash">—</span>
                                    )}
                                  </td>
                                )
                              })}

                              {/* Custom Roles Cells (Interactive Toggles) */}
                              {customRoles.map((role) => {
                                const isGranted = role.permissions.includes(perm.id)
                                return (
                                  <td key={role.id} className="sa-matrix-cell">
                                    <button
                                      type="button"
                                      className={`sa-matrix-toggle ${isGranted ? 'is-active' : ''}`}
                                      onClick={() => handleToggleCell(role, perm.id)}
                                      title={`Click to ${isGranted ? 'Revoke' : 'Grant'} for ${role.name}`}
                                      aria-label={`${role.name} ${perm.name}`}
                                    >
                                      {isGranted ? <Check size={14} /> : <Plus size={12} />}
                                    </button>
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* ── 5B. Permission Directory Table View ───────────── */
          <div className="sa-accounts-table-card">
            <div className="sa-table-responsive">
              <table className="sa-accounts-table">
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>Capability & Code</th>
                    <th style={{ width: '16%' }}>Domain</th>
                    <th style={{ width: '24%' }}>Assigned Roles</th>
                    <th style={{ width: '14%' }}>Affected Personnel</th>
                    <th style={{ width: '18%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPermissions.map((perm) => {
                    const rolesUsing = getRolesForPermission(perm.id)
                    const impact = getPermissionImpact(perm.id)

                    return (
                      <tr key={perm.id}>
                        {/* Name & Code */}
                        <td>
                          <div>
                            <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.84rem' }}>
                              {perm.name}
                            </div>
                            <div
                              style={{
                                fontFamily: 'var(--font-mono, monospace)',
                                fontSize: '0.68rem',
                                color: '#50e396',
                                marginTop: 1,
                              }}
                            >
                              {perm.id}
                            </div>
                            <div
                              style={{
                                fontSize: '0.74rem',
                                color: '#94a3b8',
                                marginTop: 3,
                                lineHeight: 1.35,
                              }}
                            >
                              {perm.description}
                            </div>
                          </div>
                        </td>

                        {/* Category */}
                        <td>
                          <span
                            className="sa-category-tag"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            {getCategoryIcon(perm.category)}
                            <span>{perm.category}</span>
                          </span>
                        </td>

                        {/* Assigned Roles */}
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {rolesUsing.map((role) => (
                              <span
                                key={role.id}
                                className="sa-role-chip-mini"
                                style={{
                                  background: `${role.color}18`,
                                  borderColor: `${role.color}44`,
                                  color: '#f1f5f9',
                                }}
                                title={role.description}
                              >
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: role.color,
                                  }}
                                />
                                <span>{role.name}</span>
                              </span>
                            ))}
                          </div>
                        </td>

                        {/* Impact */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="sa-impact-badge">
                              <Users size={12} />
                              <span>{impact?.affectedAdminsCount || 0} Admins</span>
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            <button
                              type="button"
                              className="sa-card-btn"
                              onClick={() => setSelectedImpact(impact || null)}
                              title="Inspect authorization impact"
                            >
                              <Eye size={13} />
                              <span>Impact</span>
                            </button>
                            {customRoles.length > 0 && (
                              <button
                                type="button"
                                className="sa-card-btn"
                                onClick={() => openEditPermissionsModal(customRoles[0])}
                                title="Manage custom role capabilities"
                              >
                                <Edit2 size={13} />
                                <span>Role</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 6. Permission Impact Analysis Modal ───────────── */}
        <AnimatePresence>
          {selectedImpact && (
            <div className="sa-modal-overlay" onClick={() => setSelectedImpact(null)}>
              <motion.div
                className="sa-modal-container"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                style={{ maxWidth: 700 }}
              >
                <div className="sa-modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="sa-modal-icon-wrap">
                      <ShieldCheck size={18} style={{ color: '#50e396' }} />
                    </div>
                    <div>
                      <h3 className="sa-modal-title">Permission Impact Analysis</h3>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                        <code>{selectedImpact.permission.id}</code> · {selectedImpact.permission.category}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close-btn"
                    onClick={() => setSelectedImpact(null)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  {/* Permission Description */}
                  <div
                    style={{
                      padding: 14,
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.92rem', marginBottom: 4 }}>
                      {selectedImpact.permission.name}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.45 }}>
                      {selectedImpact.permission.description}
                    </div>
                  </div>

                  {/* Direct Roles Granting Access */}
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ffffff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <KeyRound size={14} style={{ color: '#50e396' }} />
                      <span>Roles Granting This Capability ({selectedImpact.roles.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {selectedImpact.roles.map((role) => (
                        <div
                          key={role.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 12px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: `1px solid ${role.color}44`,
                            borderRadius: 8,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: role.color,
                            }}
                          />
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
                            {role.name}
                          </span>
                          <span
                            className="sa-category-tag"
                            style={{
                              fontSize: '0.62rem',
                              padding: '1px 5px',
                              background: role.isStandard ? 'rgba(6, 182, 212, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                              color: role.isStandard ? '#38bdf8' : '#34d399',
                            }}
                          >
                            {role.isStandard ? 'Standard' : 'Custom'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Indirectly Affected Platform Administrators */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Users size={14} style={{ color: '#a855f7' }} />
                        <span>Personnel Indirectly Authorized ({selectedImpact.affectedAdminsCount})</span>
                      </div>
                      <Link
                        to="/dashboard/super-admin/accounts"
                        style={{ fontSize: '0.72rem', color: '#50e396', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <span>Admin Accounts</span>
                        <ExternalLink size={11} />
                      </Link>
                    </div>

                    {selectedImpact.affectedAdminsCount === 0 ? (
                      <div
                        style={{
                          padding: '16px',
                          textAlign: 'center',
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px dashed rgba(255, 255, 255, 0.1)',
                          borderRadius: 8,
                          color: '#94a3b8',
                          fontSize: '0.78rem',
                        }}
                      >
                        No active platform administrators currently inherit this capability.
                      </div>
                    ) : (
                      <div className="sa-assigned-admins-list">
                        {selectedImpact.affectedAdmins.map((admin) => {
                          const roleMeta = getAdminRoleMeta(admin.role)
                          return (
                            <div key={admin.id} className="sa-assigned-admin-item">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: '50%',
                                    background: roleMeta.color,
                                    color: '#ffffff',
                                    fontSize: '0.74rem',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  {admin.fullName.charAt(0)}
                                </div>
                                <div>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
                                    {admin.fullName}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                    {admin.email} · {admin.department}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                  className="sa-role-chip-mini"
                                  style={{
                                    background: `${roleMeta.color}18`,
                                    borderColor: `${roleMeta.color}44`,
                                    color: '#ffffff',
                                    fontSize: '0.68rem',
                                  }}
                                >
                                  {roleMeta.title}
                                </span>
                                <span
                                  className={`sa-status-chip sa-status-chip--${admin.status}`}
                                  style={{ fontSize: '0.66rem', padding: '1px 6px' }}
                                >
                                  {admin.status}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-primary-btn"
                    onClick={() => setSelectedImpact(null)}
                    style={{ marginLeft: 'auto' }}
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── 7. Permission Assignment Modal (Custom Role) ──── */}
        <AnimatePresence>
          {editingRoleForPerms && (
            <div className="sa-modal-overlay" onClick={() => setEditingRoleForPerms(null)}>
              <motion.div
                className="sa-modal-container"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                style={{ maxWidth: 740 }}
              >
                <div className="sa-modal-header">
                  <div>
                    <h3 className="sa-modal-title">
                      Configure Permissions: {editingRoleForPerms.name}
                    </h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      Assign or revoke granular platform capabilities for this custom RBAC profile.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close-btn"
                    onClick={() => setEditingRoleForPerms(null)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  {/* Role Selector (if multiple custom roles exist) */}
                  {customRoles.length > 1 && (
                    <div className="sa-form-group">
                      <label className="sa-form-label">Active Custom Role</label>
                      <select
                        className="sa-form-input"
                        value={editingRoleForPerms.id}
                        onChange={(e) => {
                          const r = customRoles.find((role) => role.id === e.target.value)
                          if (r) {
                            setEditingRoleForPerms(r)
                            setPendingPerms([...r.permissions])
                          }
                        }}
                      >
                        {customRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} — {r.permissions.length} capabilities
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Permission Matrix Sticky Status */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: 'rgba(80, 227, 150, 0.05)',
                      border: '1px solid rgba(80, 227, 150, 0.15)',
                      borderRadius: 8,
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#ffffff' }}>
                        Capabilities Granted:
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#50e396', fontWeight: 600 }}>
                        {pendingPerms.length} of {PLATFORM_PERMISSIONS.length} platform permissions active
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="sa-perm-category-toggle-btn"
                        onClick={selectAllInModal}
                      >
                        Select All (25)
                      </button>
                      <span style={{ color: '#475569' }}>|</span>
                      <button
                        type="button"
                        className="sa-perm-category-toggle-btn"
                        onClick={clearAllInModal}
                        style={{ color: '#94a3b8' }}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  {/* Grouped Permission Categories */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                    {getPermissionCategories().map((cat) => {
                      const catPerms = permissionsByCategory.get(cat) || []
                      const selectedInCat = catPerms.filter((p) => pendingPerms.includes(p.id)).length
                      const allSelected = selectedInCat === catPerms.length

                      return (
                        <div key={cat} className="sa-perm-category-box">
                          <div className="sa-perm-category-header">
                            <div className="sa-perm-category-title">
                              {getCategoryIcon(cat)}
                              <span>{cat}</span>
                              <span className="sa-perm-category-count">
                                ({selectedInCat} / {catPerms.length})
                              </span>
                            </div>
                            <button
                              type="button"
                              className="sa-perm-category-toggle-btn"
                              onClick={() => toggleCategoryInModal(cat)}
                            >
                              {allSelected ? 'Deselect Category' : 'Select Category'}
                            </button>
                          </div>

                          <div className="sa-perm-items-list">
                            {catPerms.map((perm) => {
                              const isSelected = pendingPerms.includes(perm.id)
                              return (
                                <div
                                  key={perm.id}
                                  className={`sa-perm-item-row ${isSelected ? 'is-selected' : ''}`}
                                  onClick={() => togglePendingPerm(perm.id)}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {}}
                                    style={{ marginTop: 2, accentColor: '#50e396', cursor: 'pointer' }}
                                  />
                                  <div className="sa-perm-item-info">
                                    <div className="sa-perm-item-name">
                                      <span>{perm.name}</span>
                                      <span className="sa-perm-item-code">{perm.id}</span>
                                    </div>
                                    <div className="sa-perm-item-desc">{perm.description}</div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-filter-btn"
                    onClick={() => setEditingRoleForPerms(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dash-primary-btn"
                    onClick={handleSaveRolePermissions}
                  >
                    Save Changes
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── 8. Reset Prototype Roles Modal ─────────────────── */}
        <AnimatePresence>
          {resetModalOpen && (
            <div className="sa-modal-overlay" onClick={() => setResetModalOpen(false)}>
              <motion.div
                className="sa-modal-container"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                style={{ maxWidth: 480 }}
              >
                <div className="sa-modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="sa-modal-icon-wrap">
                      <RotateCcw size={18} style={{ color: '#50e396' }} />
                    </div>
                    <div>
                      <h3 className="sa-modal-title">Reset Prototype Roles</h3>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                        Restore default custom role seed data
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close-btn"
                    onClick={() => setResetModalOpen(false)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  <p style={{ fontSize: '0.86rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                    Resetting prototype roles will restore the default <strong>Cluster Operator</strong> custom role and discard any locally added prototype roles. Standard platform roles will remain intact.
                  </p>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-filter-btn"
                    onClick={() => setResetModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dash-primary-btn"
                    onClick={() => {
                      resetToDefaultRoles()
                      setResetModalOpen(false)
                      reloadData()
                      showToast('Prototype roles reset to default seed state.')
                    }}
                  >
                    Reset Roles
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  )
}
