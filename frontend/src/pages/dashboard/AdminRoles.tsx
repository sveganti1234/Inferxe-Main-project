import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  KeyRound,
  Users,
  Search,
  Lock,
  ArrowRight,
  Eye,
  Sliders,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  STANDARD_ROLES,
  PLATFORM_PERMISSIONS,
  getPermissionCategories,
  getRoleAssignedAdmins,
  type AdminRoleDefinition,
  type PermissionCategory,
  type RolePermission,
} from '../../lib/adminRoleStore'
import {
  getAdminAccounts,
  syncAdminAccountsFromBackend,
  type AdminAccount,
} from '../../lib/adminAccountStore'

export default function AdminRoles() {
  usePageMeta(
    'Role Management · Inferxe Super Admin',
    'Canonical platform governance and administrative role profiles for @inferxe.com administrators.',
  )

  // Data state
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(() => getAdminAccounts())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters & Controls
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PermissionCategory>('all')
  const [sortBy, setSortBy] = useState<'name' | 'permissions_desc' | 'permissions_asc' | 'admins_desc'>('name')

  // Modals state
  const [viewingRole, setViewingRole] = useState<AdminRoleDefinition | null>(null)

  // Backend sync
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
      setError(err instanceof Error ? err.message : 'Failed to sync administrator accounts.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Sync data on changes
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
    if (viewingRole) {
      document.body.style.overflow = 'hidden'
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setViewingRole(null)
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        document.body.style.overflow = ''
        window.removeEventListener('keydown', handleKeyDown)
      }
    } else {
      document.body.style.overflow = ''
    }
  }, [viewingRole])

  // Filter and sort standard roles
  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return STANDARD_ROLES.filter((role) => {
      // Category filter
      if (categoryFilter !== 'all') {
        const categoryPerms = PLATFORM_PERMISSIONS.filter((p) => p.category === categoryFilter).map((p) => p.id)
        const hasCategoryPerm = role.permissions.some((pId) => categoryPerms.includes(pId))
        if (!hasCategoryPerm) return false
      }

      // Search query
      if (!q) return true
      const nameMatch = role.name.toLowerCase().includes(q)
      const descMatch = role.description.toLowerCase().includes(q)
      const permMatch = role.permissions.some((pId) => {
        const p = PLATFORM_PERMISSIONS.find((item) => item.id === pId)
        return p && (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      })
      return nameMatch || descMatch || permMatch
    }).sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'permissions_desc') return b.permissions.length - a.permissions.length
      if (sortBy === 'permissions_asc') return a.permissions.length - b.permissions.length
      if (sortBy === 'admins_desc') {
        return getRoleAssignedAdmins(b.id).length - getRoleAssignedAdmins(a.id).length
      }
      return 0
    })
  }, [searchQuery, categoryFilter, sortBy])

  // Summary counts
  const superAdminCount = adminAccounts.filter((a) => a.isSuperAdmin || a.role === 'superadmin').length
  const standardAdminCount = adminAccounts.filter((a) => !a.isSuperAdmin && a.role === 'admin').length

  // Categorized permissions for viewing role modal
  const viewingPermissionsByCategory = useMemo(() => {
    if (!viewingRole) return new Map<PermissionCategory, RolePermission[]>()
    const categories = getPermissionCategories()
    const map = new Map<PermissionCategory, RolePermission[]>()
    categories.forEach((cat) => map.set(cat, []))

    PLATFORM_PERMISSIONS.forEach((p) => {
      if (viewingRole.permissions.includes(p.id)) {
        const list = map.get(p.category) || []
        list.push(p)
        map.set(p.category, list)
      }
    })
    return map
  }, [viewingRole])

  return (
    <DashboardLayout
      pageTitle="Role Management"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/super-admin' },
        { label: 'Role Management' },
      ]}
      heading="Role Management"
      description="Canonical platform governance and administrative role profiles for @inferxe.com administrators."
      backButtonTo="/dashboard/super-admin"
      backButtonLabel="Super Admin Overview"
    >
      <div style={{ maxWidth: 1440, margin: '0 auto', width: '100%' }}>
        {/* ── 1. Header Banner & Actions ──────────────────────── */}
        <div className="sa-header-banner">
          <div className="sa-banner-title-group">
            <div className="sa-shield-icon-wrap" aria-hidden="true">
              <KeyRound size={22} />
            </div>
            <div>
              <div className="sa-meta-badges-row">
                <span className="sa-meta-badge sa-meta-badge--primary">
                  <ShieldCheck size={12} />
                  <span>Super Admin</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--emerald">
                  <span className="sa-meta-badge__dot" />
                  <span>Two-Role Platform Model</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--count">
                  <KeyRound size={12} />
                  <span>{STANDARD_ROLES.length} Standard Roles</span>
                </span>
              </div>
              <h2 className="sa-banner-title">
                <span>Platform Role Architecture</span>
              </h2>
              <div className="sa-banner-sub">
                Canonical platform governance profiles and permission mappings for @inferxe.com administrators.
              </div>
            </div>
          </div>

          <div className="sa-banner-actions">
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => void loadData(true)}
              disabled={isLoading}
              title="Refresh administrator role assignments from backend"
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
              <span>Strict Two-Role Architecture</span>
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

        {/* ── 3. Two-Role Architecture Policy Callout ──────────────────── */}
        <div className="ar-notice" role="status">
          <span className="ar-notice__icon" aria-hidden="true"><ShieldCheck size={18} /></span>
          <div>
            <strong className="ar-notice__title">Platform two-role architecture</strong>
            <p className="ar-notice__body">
              Inferxe strictly supports only two platform roles: <strong>Super Admin</strong> (<code>superadmin</code>) and <strong>Admin</strong> (<code>admin</code>). Normal administrators receive standard operational capabilities. Custom roles, role escalation, and unauthorized role assignments are prohibited by backend authorization guards.
            </p>
          </div>
        </div>

        {/* ── 4. KPI Statistics Grid ────────────────────────── */}
        <div className="sa-kpi-grid" style={{ marginBottom: 24 }}>
          {/* Total Roles */}
          <div className="sa-kpi-card sa-kpi-card--primary">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Total Standard Roles</span>
              <div className="sa-kpi-card__icon-wrap">
                <KeyRound size={17} style={{ color: '#50e396' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{STANDARD_ROLES.length}</div>
            <div className="sa-kpi-card__subtext">
              <span>Super Admin + Admin</span>
            </div>
          </div>

          {/* Super Admin Tier */}
          <div className="sa-kpi-card sa-kpi-card--cyan">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Protected Governance Tier</span>
              <div className="sa-kpi-card__icon-wrap">
                <ShieldCheck size={17} style={{ color: '#06b6d4' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{superAdminCount} Super Admin</div>
            <div className="sa-kpi-card__subtext">
              <span className="ar-tone--info">Full Platform Authority (21 perms)</span>
            </div>
          </div>

          {/* Standard Admins */}
          <div className="sa-kpi-card sa-kpi-card--emerald">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Standard Administrators</span>
              <div className="sa-kpi-card__icon-wrap">
                <Users size={17} style={{ color: '#10b981' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{standardAdminCount} Admin</div>
            <div className="sa-kpi-card__subtext">
              <span className="ar-tone--accent">Operational Capabilities (10 perms)</span>
            </div>
          </div>

          {/* Canonical Permissions */}
          <div className="sa-kpi-card sa-kpi-card--purple">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Canonical Permissions</span>
              <div className="sa-kpi-card__icon-wrap">
                <Sliders size={17} style={{ color: '#a855f7' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{PLATFORM_PERMISSIONS.length}</div>
            <div className="sa-kpi-card__subtext">
              <Link
                to="/dashboard/super-admin/permissions"
                className="ar-tone--violet ar-inline-link"
              >
                <span>View Permission Matrix</span>
                <ArrowRight size={12} />
              </Link>
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
              placeholder="Search standard roles by name, description, permission..."
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
            title="Filter roles by permission category"
            style={{ minWidth: 160 }}
          >
            <option value="all">All Categories</option>
            {getPermissionCategories().map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Sort By */}
          <select
            className="sa-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            title="Sort roles"
            style={{ minWidth: 150 }}
          >
            <option value="name">Sort by Name</option>
            <option value="permissions_desc">Most Permissions</option>
            <option value="permissions_asc">Fewest Permissions</option>
            <option value="admins_desc">Most Administrators</option>
          </select>

          {/* Reset Filters */}
          {(searchQuery || categoryFilter !== 'all') && (
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => {
                setSearchQuery('')
                setCategoryFilter('all')
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={12} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>


        {/* ── 6. Roles Display ──────────────────────────────── */}
        {isLoading && adminAccounts.length === 0 ? (
          <div className="ar-state">
            <RotateCcw size={24} className="ar-state__icon ar-spin" />
            <div className="ar-state__body">Syncing live administrator roles and assignments...</div>
          </div>
        ) : filteredRoles.length === 0 ? (
          <div className="ar-state">
            <Lock size={28} className="ar-state__icon" />
            <h3 className="ar-state__title">No Roles Match Filter</h3>
            <p className="ar-state__body">Try clearing your search query or selecting a broader category.</p>
          </div>
        ) : (
          <div className="ar-grid">
            {filteredRoles.map((role) => {
              const assignedAdmins = getRoleAssignedAdmins(role.id)
              const isSuper = role.id === 'superadmin' || role.id === 'super_admin'

              return (
                <div key={role.id} className={`ar-card ${isSuper ? 'ar-card--super' : 'ar-card--admin'}`}>
                  <div>
                    {/* Top Row: Icon, Title, Badge */}
                    <div className="ar-card__top">
                      <div className="ar-card__id">
                        <span className="ar-card__icon" aria-hidden="true">
                          {isSuper ? <ShieldCheck size={20} /> : <Users size={20} />}
                        </span>
                        <div>
                          <h3 className="ar-card__title">{role.name}</h3>
                          <code className="ar-card__code">{role.id}</code>
                        </div>
                      </div>
                      <span className="ar-card__badge">Standard role</span>
                    </div>

                    {/* Description */}
                    <p className="ar-card__desc">{role.description}</p>

                    {/* Meta stats: Permissions & Assigned Admins */}
                    <div className="ar-card__stats">
                      <div className="ar-stat">
                        <span>Permissions</span>
                        <strong>{role.permissions.length} / 21</strong>
                      </div>
                      <div className="ar-stat">
                        <span>Assigned</span>
                        <strong>{assignedAdmins.length} Administrator{assignedAdmins.length === 1 ? '' : 's'}</strong>
                      </div>
                    </div>

                    {/* Assigned Admins Roster Preview */}
                    <div className="ar-card__members">
                      <span className="ar-label">Active members</span>
                      <div className="ar-chips">
                        {assignedAdmins.length === 0 ? (
                          <span className="ar-chips__empty">No active administrators</span>
                        ) : (
                          assignedAdmins.map((adm) => (
                            <span key={adm.id} className="ar-chip">
                              {adm.fullName} <em>({adm.email.split('@')[0]})</em>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="ar-card__actions">
                    <button type="button" className="dash-filter-btn ar-btn" onClick={() => setViewingRole(role)}>
                      <Eye size={14} />
                      <span>Inspect permissions</span>
                    </button>
                    <Link to="/dashboard/super-admin/accounts" className="ar-link">
                      <span>Manage admins</span>
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 7. Inspect Role Modal ────────────────────────────── */}
        {viewingRole && (
          <div
            className="sa-modal-overlay"
            onClick={() => setViewingRole(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="sa-modal-container"
              style={{ maxWidth: 640 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-modal-icon-wrap--success">
                    <KeyRound size={17} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">{viewingRole.name} Role Details</h3>
                    <div>
                      Canonical Platform Role Definition · <code>{viewingRole.id}</code>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close sa-modal-close-btn"
                  onClick={() => setViewingRole(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                <p className="ar-card__desc">{viewingRole.description}</p>

                <h4 className="ar-modal__heading">
                  Assigned capabilities ({viewingRole.permissions.length} / 21)
                </h4>

                <div className="ar-perm-groups">
                  {Array.from(viewingPermissionsByCategory.entries()).map(([cat, perms]) => {
                    if (perms.length === 0) return null
                    return (
                      <div key={cat} className="ar-perm-group">
                        <div className="ar-label ar-label--accent">
                          {cat} ({perms.length})
                        </div>
                        <div className="ar-perm-list">
                          {perms.map((p) => (
                            <div key={p.id} className="ar-perm">
                              <CheckCircle2 size={15} className="ar-perm__icon" />
                              <div>
                                <span className="ar-perm__name">{p.name}</span>
                                <div className="ar-perm__desc">{p.description}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-primary-btn"
                  onClick={() => setViewingRole(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
