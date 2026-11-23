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
        <div
          className="sa-demo-banner"
          style={{ borderColor: 'rgba(80, 227, 150, 0.3)', background: 'rgba(80, 227, 150, 0.05)', marginBottom: 20 }}
          role="status"
        >
          <ShieldCheck size={18} style={{ color: '#50e396', flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong style={{ color: '#50e396' }}>Platform Permission Architecture:</strong>
            <div style={{ marginTop: 2, color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.45 }}>
              Platform authorization is anchored by 21 canonical capabilities. The <strong>Super Admin</strong> role possesses all 21 permissions, while standard <strong>Admin</strong> accounts receive 10 operational permissions for tenant, workload, and telemetry management.
            </div>
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
              <span style={{ color: '#38bdf8' }}>100% Platform Access Scope</span>
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
              <span style={{ color: '#10b981' }}>Operations, Telemetry & Billing</span>
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
              <span style={{ color: '#c084fc' }}>Admin Management, RBAC, Sessions</span>
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
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              background: 'rgba(10, 24, 18, 0.4)',
              border: '1px solid rgba(80, 227, 150, 0.12)',
              borderRadius: 14,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <RotateCcw size={24} style={{ color: '#50e396', animation: 'spin 1.2s linear infinite' }} />
            <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
              Querying platform permission matrix and role assignments...
            </div>
          </div>
        ) : filteredPermissions.length === 0 ? (
          <div
            style={{
              padding: '48px 20px',
              textAlign: 'center',
              background: 'rgba(10, 24, 18, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
            }}
          >
            <Sliders size={28} style={{ color: '#94a3b8', margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ margin: '0 0 6px', color: '#e2e8f0', fontSize: '1rem' }}>No Permissions Match</h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.82rem' }}>
              Try adjusting your search query or selecting a different filter.
            </p>
          </div>
        ) : (
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1B2E24', background: '#0A120E' }}>
                    <th style={{ padding: '14px 16px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', width: '48%' }}>
                      Canonical Permission & Scope
                    </th>
                    <th style={{ padding: '14px 16px', color: '#9CA3AF', fontWeight: 600, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', width: '18%' }}>
                      Category
                    </th>
                    <th style={{ padding: '14px 16px', color: '#00FF88', fontWeight: 600, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', width: '17%' }}>
                      Super Admin
                    </th>
                    <th style={{ padding: '14px 16px', color: '#38BDF8', fontWeight: 600, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', width: '17%' }}>
                      Admin
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categorizedPermissions.map(([category, perms]) => (
                    <Fragment key={category}>
                      {/* Category Header Row */}
                      <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid #152219' }}>
                        <td
                          colSpan={4}
                          style={{
                            padding: '10px 16px',
                            fontWeight: 700,
                            fontSize: '0.76rem',
                            color: '#10B981',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {getCategoryIcon(category)}
                            <span>{category} ({perms.length})</span>
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
                            style={{
                              borderBottom: '1px solid #152219',
                              transition: 'background 0.15s',
                              cursor: 'pointer',
                            }}
                            onClick={() => setSelectedPermission(p)}
                            title="Click to inspect permission details and affected administrators"
                          >
                            {/* Permission Name & Code */}
                            <td style={{ padding: '12px 16px' }}>
                              <div style={{ fontWeight: 600, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>{p.name}</span>
                              </div>
                              <div style={{ color: '#9CA3AF', fontSize: '0.74rem', marginTop: 2 }}>
                                {p.description}
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <code
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.7rem',
                                    color: '#6EE7B7',
                                    background: 'rgba(0, 255, 136, 0.08)',
                                    padding: '1px 6px',
                                    borderRadius: 3,
                                  }}
                                >
                                  {p.id}
                                </code>
                              </div>
                            </td>

                            {/* Category Badge */}
                            <td style={{ padding: '12px 16px' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  color: '#CBD5E1',
                                  fontSize: '0.74rem',
                                  background: 'rgba(255, 255, 255, 0.04)',
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  border: '1px solid rgba(255, 255, 255, 0.08)',
                                }}
                              >
                                {getCategoryIcon(p.category)}
                                <span>{p.category}</span>
                              </span>
                            </td>

                            {/* Super Admin Column */}
                            <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                              {hasSuper ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    background: 'rgba(0, 255, 136, 0.15)',
                                    color: '#00FF88',
                                  }}
                                  title="Granted to Super Admin"
                                >
                                  <Check size={14} />
                                </span>
                              ) : (
                                <span style={{ color: '#4B5563' }}>—</span>
                              )}
                            </td>

                            {/* Standard Admin Column */}
                            <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                              {hasAdmin ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    background: 'rgba(56, 189, 248, 0.15)',
                                    color: '#38BDF8',
                                  }}
                                  title="Granted to Standard Admin"
                                >
                                  <Check size={14} />
                                </span>
                              ) : (
                                <span
                                  style={{
                                    color: '#4B5563',
                                    fontSize: '0.75rem',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                  title="Restricted from Standard Admin"
                                >
                                  —
                                </span>
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
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: 'rgba(80, 227, 150, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#50e396',
                      }}
                    >
                      <Sliders size={18} />
                    </div>
                    <div>
                      <h3 className="sa-modal-title">{selectedPermission.name}</h3>
                      <div style={{ color: '#9CA3AF', fontSize: '0.74rem' }}>
                        <code>{selectedPermission.id}</code>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close"
                    onClick={() => setSelectedPermission(null)}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  <p style={{ margin: '0 0 16px', color: '#CBD5E1', fontSize: '0.86rem', lineHeight: 1.5 }}>
                    {selectedPermission.description}
                  </p>

                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <div style={{ background: '#121C16', border: '1px solid #1B2E24', borderRadius: 6, padding: '8px 12px', flex: 1 }}>
                      <div style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Category</div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#FFFFFF', marginTop: 2 }}>
                        {selectedPermission.category}
                      </div>
                    </div>
                    <div style={{ background: '#121C16', border: '1px solid #1B2E24', borderRadius: 6, padding: '8px 12px', flex: 1 }}>
                      <div style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase' }}>Scope</div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: standardAdminRole.permissions.includes(selectedPermission.id) ? '#38BDF8' : '#00FF88', marginTop: 2 }}>
                        {standardAdminRole.permissions.includes(selectedPermission.id) ? 'All Admin Roles' : 'Super Admin Only'}
                      </div>
                    </div>
                  </div>

                  {/* Active Administrators with this Permission */}
                  <div>
                    <h4 style={{ fontSize: '0.84rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 8px' }}>
                      Administrators Granted This Permission ({adminsWithSelectedPerm.length})
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {adminsWithSelectedPerm.map((adm) => (
                        <div
                          key={adm.id}
                          style={{
                            background: '#121C16',
                            border: '1px solid #1B2E24',
                            borderRadius: 6,
                            padding: '8px 12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <div style={{ color: '#FFFFFF', fontWeight: 600, fontSize: '0.8rem' }}>{adm.fullName}</div>
                            <div style={{ color: '#9CA3AF', fontSize: '0.72rem' }}>{adm.email}</div>
                          </div>
                          <span
                            style={{
                              background: adm.isSuperAdmin || adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                              color: adm.isSuperAdmin || adm.role === 'superadmin' ? '#00FF88' : '#38BDF8',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            {adm.isSuperAdmin || adm.role === 'superadmin' ? 'Super Admin' : 'Admin'}
                          </span>
                        </div>
                      ))}
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
