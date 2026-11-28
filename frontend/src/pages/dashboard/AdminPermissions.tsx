import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sliders,
  ShieldCheck,
  Search,
  Lock,
  Check,
  AlertCircle,
  RotateCcw,
  X,
  Users,
  LayoutGrid,
  Cpu,
  DollarSign,
  Shield,
  Globe,
  KeyRound,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  STANDARD_ROLES,
  PLATFORM_PERMISSIONS,
  getPermissionCategories,
  getRolesForPermission,
  type RolePermission,
  type PermissionCategory,
} from '../../lib/adminRoleStore'
import {
  getAdminAccounts,
  syncAdminAccountsFromBackend,
  type AdminAccount,
} from '../../lib/adminAccountStore'

function getCategoryIcon(category: PermissionCategory) {
  switch (category) {
    case 'Dashboard':
      return <LayoutGrid size={14} style={{ color: '#ec4899' }} />
    case 'User Management':
    case 'Customer & Workspaces':
      return <Users size={14} style={{ color: '#a855f7' }} />
    case 'Admin Management':
    case 'Role Management':
    case 'Permission Management':
    case 'Administration & RBAC':
      return <KeyRound size={14} style={{ color: '#50e396' }} />
    case 'Audit & Security':
    case 'Security & Compliance':
      return <Shield size={14} style={{ color: '#ef4444' }} />
    case 'API & Networking':
      return <Globe size={14} style={{ color: '#38bdf8' }} />
    case 'Security & Access':
      return <Lock size={14} style={{ color: '#10b981' }} />
    case 'Workloads & Compute':
      return <Cpu size={14} style={{ color: '#8b5cf6' }} />
    case 'GPU Infrastructure':
      return <Cpu size={14} style={{ color: '#06b6d4' }} />
    case 'FinOps & Billing':
      return <DollarSign size={14} style={{ color: '#f59e0b' }} />
    default:
      return <Sliders size={14} style={{ color: '#94a3b8' }} />
  }
}

export default function AdminPermissions() {
  usePageMeta(
    'Permission Management · Inferxe Super Admin',
    'Canonical platform capabilities, standard RBAC matrix, and administrator authorization scope.'
  )

  // Data State
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(() => getAdminAccounts())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Controls & Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PermissionCategory>('all')
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'all_roles' | 'superadmin_only'>('all')

  // Modals & Drawers
  const [selectedPermission, setSelectedPermission] = useState<RolePermission | null>(null)

  // Backend Data Sync
  const loadData = useCallback(async (force = false) => {
    if (getAdminAccounts().length === 0) setIsLoading(true)
    setError(null)
    try {
      const res = await syncAdminAccountsFromBackend(force)
      if (res.ok && res.accounts) {
        setAdminAccounts(res.accounts)
      } else if (!res.ok && res.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync platform administrator accounts.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Cross-tab synchronization
  const reloadData = useCallback(() => {
    setAdminAccounts(getAdminAccounts())
  }, [])

  useEffect(() => {
    window.addEventListener('inferxe_admin_accounts_change', reloadData)
    window.addEventListener('storage', reloadData)
    return () => {
      window.removeEventListener('inferxe_admin_accounts_change', reloadData)
      window.removeEventListener('storage', reloadData)
    }
  }, [reloadData])

  // Lock body scroll when modal open
  useEffect(() => {
    if (selectedPermission) {
      document.body.style.overflow = 'hidden'
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setSelectedPermission(null)
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        document.body.style.overflow = ''
        window.removeEventListener('keydown', handleKeyDown)
      }
    } else {
      document.body.style.overflow = ''
    }
  }, [selectedPermission])

  // Filtered permissions
  const filteredPermissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    return PLATFORM_PERMISSIONS.filter((perm) => {
      // Category filter
      if (categoryFilter !== 'all' && perm.category !== categoryFilter) return false

      // Assignment filter
      const rolesUsing = getRolesForPermission(perm.id)
      const isSuperOnly = rolesUsing.length === 1 && rolesUsing[0].id === 'superadmin'
      if (assignmentFilter === 'superadmin_only' && !isSuperOnly) return false
      if (assignmentFilter === 'all_roles' && isSuperOnly) return false

      // Search query
      if (!q) return true
      return (
        perm.name.toLowerCase().includes(q) ||
        perm.description.toLowerCase().includes(q) ||
        perm.id.toLowerCase().includes(q) ||
        perm.category.toLowerCase().includes(q)
      )
    })
  }, [searchQuery, categoryFilter, assignmentFilter])

  // Group permissions by category for matrix view
  const categorizedPermissions = useMemo(() => {
    const map = new Map<PermissionCategory, RolePermission[]>()
    getPermissionCategories().forEach((cat) => map.set(cat, []))

    filteredPermissions.forEach((perm) => {
      const list = map.get(perm.category) || []
      list.push(perm)
      map.set(perm.category, list)
    })

    // Return only categories with matching items
    return Array.from(map.entries()).filter(([_, perms]) => perms.length > 0)
  }, [filteredPermissions])

  // Admins who have selected permission
  const adminsWithSelectedPerm = useMemo(() => {
    if (!selectedPermission) return []
    const rolesUsing = getRolesForPermission(selectedPermission.id).map((r) => r.id)
    return adminAccounts.filter((acc) => {
      if (acc.isSuperAdmin || acc.role === 'superadmin') return true
      return rolesUsing.includes(acc.role)
    })
  }, [selectedPermission, adminAccounts])

  const superAdminRole = STANDARD_ROLES.find((r) => r.id === 'superadmin')!
  const standardAdminRole = STANDARD_ROLES.find((r) => r.id === 'admin')!

  return (
    <DashboardLayout
      pageTitle="Permission Management"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/super-admin' },
        { label: 'Permission Management' },
      ]}
      heading="Permission Management"
      description="Canonical platform capability definitions, standard RBAC matrix, and administrator authorization scope."
      backButtonTo="/dashboard/super-admin"
      backButtonLabel="Super Admin Overview"
    >
      <div style={{ maxWidth: 1440, margin: '0 auto', width: '100%' }}>
        {/* ── 1. Header Banner & Actions ──────────────────────── */}
        <div className="sa-header-banner">
          <div className="sa-banner-title-group">
            <div className="sa-shield-icon-wrap" aria-hidden="true">
              <Sliders size={22} />
            </div>
            <div>
              <div className="sa-meta-badges-row">
                <span className="sa-meta-badge sa-meta-badge--primary">
                  <ShieldCheck size={12} />
                  <span>Super Admin</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--emerald">
                  <span className="sa-meta-badge__dot" />
                  <span>Two-Role Standard Matrix</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--count">
                  <KeyRound size={12} />
                  <span>{PLATFORM_PERMISSIONS.length} Canonical Permissions</span>
                </span>
              </div>
              <h2 className="sa-banner-title">
                <span>Canonical Permission Matrix</span>
              </h2>
              <div className="sa-banner-sub">
                Inspect platform capability definitions, evaluate standard role permissions, and audit authorization scopes.
              </div>
            </div>
          </div>

          <div className="sa-banner-actions">
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => void loadData(true)}
              disabled={isLoading}
              title="Refresh permission assignments from backend"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={14} className={isLoading ? 'animate-spin' : ''} />
              <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
            </button>
            <span
              className="sa-meta-badge sa-meta-badge--primary"
              style={{ padding: '8px 14px', fontSize: '0.82rem', gap: 6 }}
            >
              <ShieldCheck size={14} />
              <span>Canonical Permissions Active</span>
            </span>
          </div>
        </div>

        {/* ── 2. Error Banner ─────────────────────────────── */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              color: '#f87171',
              fontSize: '0.85rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="dash-filter-btn"
              style={{ padding: '4px 10px', fontSize: '0.76rem' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── 3. Architecture Notice ────────────────────────── */}
        <div className="ar-notice" role="status">
          <span className="ar-notice__icon" aria-hidden="true"><ShieldCheck size={18} /></span>
          <div>
            <strong className="ar-notice__title">Platform permission architecture</strong>
            <p className="ar-notice__body">
              Platform authorization is anchored by 21 canonical capabilities. The <strong>Super Admin</strong> role possesses all 21 permissions, while standard <strong>Admin</strong> accounts receive 10 operational permissions for tenant, workload, and telemetry management.
            </p>
          </div>
        </div>

        {/* ── 4. KPI Statistics Grid ────────────────────────── */}
        <div className="sa-kpi-grid" style={{ marginBottom: 24 }}>
          {/* Total Permissions */}
          <div className="sa-kpi-card sa-kpi-card--primary">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Total Canonical Permissions</span>
              <div className="sa-kpi-card__icon-wrap">
                <Sliders size={17} style={{ color: '#50e396' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{PLATFORM_PERMISSIONS.length}</div>
            <div className="sa-kpi-card__subtext">
              <span>Across 11 System Categories</span>
            </div>
          </div>

          {/* Super Admin Grants */}
          <div className="sa-kpi-card sa-kpi-card--cyan">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Super Admin Capabilities</span>
              <div className="sa-kpi-card__icon-wrap">
                <ShieldCheck size={17} style={{ color: '#06b6d4' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">21 / 21</div>
            <div className="sa-kpi-card__subtext">
              <span className="ar-tone--info">100% Platform Access Scope</span>
            </div>
          </div>

          {/* Standard Admin Grants */}
          <div className="sa-kpi-card sa-kpi-card--emerald">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Standard Admin Capabilities</span>
              <div className="sa-kpi-card__icon-wrap">
                <Users size={17} style={{ color: '#10b981' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">10 / 21</div>
            <div className="sa-kpi-card__subtext">
              <span className="ar-tone--accent">Operations, Telemetry &amp; Billing</span>
            </div>
          </div>

          {/* Restricted Governance Grants */}
          <div className="sa-kpi-card sa-kpi-card--purple">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Super Admin Exclusive</span>
              <div className="sa-kpi-card__icon-wrap">
                <Lock size={17} style={{ color: '#a855f7' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">11 Permissions</div>
            <div className="sa-kpi-card__subtext">
              <span className="ar-tone--violet">Admin Management, RBAC, Sessions</span>
            </div>
          </div>
        </div>

        {/* ── 5. Search & Filters Bar ────────────────────────── */}
        <div className="sa-filter-bar" style={{ marginBottom: 20 }}>
          {/* Search */}
          <div className="sa-search-wrap" style={{ flex: '1 1 240px' }}>
            <Search size={15} className="sa-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="sa-search-input"
              placeholder="Search permissions by name, identifier, description..."
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

          {/* Filter by Category */}
          <select
            className="sa-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | PermissionCategory)}
            title="Filter by Category"
            style={{ minWidth: 160 }}
          >
            <option value="all">All Categories</option>
            {getPermissionCategories().map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Filter by Scope */}
          <select
            className="sa-select"
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value as any)}
            title="Filter by Role Assignment"
            style={{ minWidth: 170 }}
          >
            <option value="all">All Permissions ({PLATFORM_PERMISSIONS.length})</option>
            <option value="all_roles">Shared by Both Roles (10)</option>
            <option value="superadmin_only">Super Admin Exclusive (11)</option>
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={12} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        {/* ── 6. Permissions Matrix Table ────────────────────── */}
        {isLoading && adminAccounts.length === 0 ? (
          <div className="ar-state">
            <RotateCcw size={24} className="ar-state__icon ar-spin" />
            <div className="ar-state__body">Querying platform permission matrix and role assignments...</div>
          </div>
        ) : filteredPermissions.length === 0 ? (
          <div className="ar-state">
            <Sliders size={28} className="ar-state__icon" />
            <h3 className="ar-state__title">No Permissions Match</h3>
            <p className="ar-state__body">Try adjusting your search query or selecting a different filter.</p>
          </div>
        ) : (
          <div className="pm-card">
            <div className="pm-scroll">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th style={{ width: '48%' }}>Canonical permission &amp; scope</th>
                    <th style={{ width: '18%' }}>Category</th>
                    <th className="pm-col-role pm-tone--super" style={{ width: '17%' }}>Super Admin</th>
                    <th className="pm-col-role pm-tone--admin" style={{ width: '17%' }}>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {categorizedPermissions.map(([category, perms]) => (
                    <Fragment key={category}>
                      {/* Category Header Row */}
                      <tr className="pm-group-row">
                        <td colSpan={4}>
                          <div className="pm-group">
                            {getCategoryIcon(category)}
                            <span>{category}</span>
                            <em>{perms.length}</em>
                          </div>
                        </td>
                      </tr>

                      {/* Permission Rows */}
                      {perms.map((p) => {
                        const hasSuper = superAdminRole.permissions.includes(p.id)
                        const hasAdmin = standardAdminRole.permissions.includes(p.id)

                        return (
                          <tr
                            key={p.id}
                            className="pm-row"
                            onClick={() => setSelectedPermission(p)}
                            title="Click to inspect permission details and affected administrators"
                          >
                            {/* Permission Name & Code */}
                            <td>
                              <div className="pm-name">{p.name}</div>
                              <div className="pm-desc">{p.description}</div>
                              <code className="pm-code">{p.id}</code>
                            </td>

                            {/* Category Badge */}
                            <td>
                              <span className="pm-cat">
                                {getCategoryIcon(p.category)}
                                <span>{p.category}</span>
                              </span>
                            </td>

                            {/* Super Admin Column */}
                            <td className="pm-col-role">
                              {hasSuper ? (
                                <span className="pm-check pm-tone--super" title="Granted to Super Admin">
                                  <Check size={14} />
                                </span>
                              ) : (
                                <span className="pm-none">—</span>
                              )}
                            </td>

                            {/* Standard Admin Column */}
                            <td className="pm-col-role">
                              {hasAdmin ? (
                                <span className="pm-check pm-tone--admin" title="Granted to Standard Admin">
                                  <Check size={14} />
                                </span>
                              ) : (
                                <span className="pm-none" title="Restricted from Standard Admin">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 7. Inspect Permission Modal ────────────────────── */}
        <AnimatePresence>
          {selectedPermission && (
            <div
              className="sa-modal-overlay"
              onClick={() => setSelectedPermission(null)}
              role="dialog"
              aria-modal="true"
            >
              <motion.div
                className="sa-modal-container"
                style={{ maxWidth: 560 }}
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18 }}
              >
                <div className="sa-modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="sa-modal-icon-wrap--success">
                      <Sliders size={18} />
                    </div>
                    <div>
                      <h3 className="sa-modal-title">{selectedPermission.name}</h3>
                      <div>
                        <code>{selectedPermission.id}</code>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close sa-modal-close-btn"
                    onClick={() => setSelectedPermission(null)}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  <p className="ar-card__desc">{selectedPermission.description}</p>

                  <div className="ar-card__stats">
                    <div className="ar-stat">
                      <span>Category</span>
                      <strong>{selectedPermission.category}</strong>
                    </div>
                    <div className="ar-stat">
                      <span>Scope</span>
                      <strong className={standardAdminRole.permissions.includes(selectedPermission.id) ? 'pm-tone--admin' : 'pm-tone--super'}>
                        {standardAdminRole.permissions.includes(selectedPermission.id) ? 'All Admin Roles' : 'Super Admin Only'}
                      </strong>
                    </div>
                  </div>

                  {/* Active Administrators with this Permission */}
                  <div>
                    <h4 className="ar-modal__heading">
                      Administrators granted this permission ({adminsWithSelectedPerm.length})
                    </h4>
                    <div className="pm-admins">
                      {adminsWithSelectedPerm.map((adm) => {
                        const isSuperAdm = adm.isSuperAdmin || adm.role === 'superadmin'
                        return (
                          <div key={adm.id} className="pm-admin">
                            <div>
                              <div className="pm-admin__name">{adm.fullName}</div>
                              <div className="pm-admin__email">{adm.email}</div>
                            </div>
                            <span className={`pm-role ${isSuperAdm ? 'pm-tone--super' : 'pm-tone--admin'}`}>
                              {isSuperAdm ? 'Super Admin' : 'Admin'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-primary-btn"
                    onClick={() => setSelectedPermission(null)}
                  >
                    Close
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
