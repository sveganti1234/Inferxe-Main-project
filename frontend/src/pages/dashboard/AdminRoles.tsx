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
        <div
          className="sa-demo-banner"
          style={{ borderColor: 'rgba(80, 227, 150, 0.3)', background: 'rgba(80, 227, 150, 0.05)', marginBottom: 20 }}
          role="status"
        >
          <ShieldCheck size={18} style={{ color: '#50e396', flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong style={{ color: '#50e396' }}>Platform Two-Role Architecture:</strong>
            <div style={{ marginTop: 2, color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.45 }}>
              Inferxe strictly supports only two platform roles: <strong>Super Admin</strong> (<code>superadmin</code>) and <strong>Admin</strong> (<code>admin</code>). Normal administrators receive standard operational capabilities. Custom roles, role escalation, and unauthorized role assignments are prohibited by backend authorization guards.
            </div>
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
              <span style={{ color: '#38bdf8' }}>Full Platform Authority (21 perms)</span>
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
              <span style={{ color: '#10b981' }}>Operational Capabilities (10 perms)</span>
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
                style={{ color: '#c084fc', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
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
              Syncing live administrator roles and assignments...
            </div>
          </div>
        ) : filteredRoles.length === 0 ? (
          <div
            style={{
              padding: '48px 20px',
              textAlign: 'center',
              background: 'rgba(10, 24, 18, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
            }}
          >
            <Lock size={28} style={{ color: '#94a3b8', margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ margin: '0 0 6px', color: '#e2e8f0', fontSize: '1rem' }}>No Roles Match Filter</h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.82rem' }}>
              Try clearing your search query or selecting a broader category.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
            {filteredRoles.map((role) => {
              const assignedAdmins = getRoleAssignedAdmins(role.id)
              const isSuper = role.id === 'superadmin' || role.id === 'super_admin'

              return (
                <div
                  key={role.id}
                  style={{
                    background: '#0F1612',
                    border: '1px solid #1B2E24',
                    borderRadius: 12,
                    padding: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <div>
                    {/* Top Row: Icon, Title, Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 8,
                            background: isSuper ? 'rgba(80, 227, 150, 0.15)' : 'rgba(6, 182, 212, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isSuper ? '#50e396' : '#06b6d4',
                          }}
                        >
                          {isSuper ? <ShieldCheck size={20} /> : <Users size={20} />}
                        </div>
                        <div>
                          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#FFFFFF' }}>
                            {role.name}
                          </h3>
                          <div style={{ color: '#9CA3AF', fontSize: '0.74rem', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                            <code>{role.id}</code>
                          </div>
                        </div>
                      </div>

                      <span
                        style={{
                          background: isSuper ? 'rgba(80, 227, 150, 0.12)' : 'rgba(6, 182, 212, 0.12)',
                          color: isSuper ? '#50e396' : '#38bdf8',
                          border: `1px solid ${isSuper ? 'rgba(80, 227, 150, 0.3)' : 'rgba(6, 182, 212, 0.3)'}`,
                          borderRadius: 4,
                          padding: '3px 8px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        Standard Role
                      </span>
                    </div>

                    {/* Description */}
                    <p style={{ margin: '0 0 16px', color: '#CBD5E1', fontSize: '0.84rem', lineHeight: 1.5 }}>
                      {role.description}
                    </p>

                    {/* Meta stats: Permissions & Assigned Admins */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                      <div style={{ background: '#121C16', border: '1px solid #1B2E24', borderRadius: 6, padding: '6px 12px', fontSize: '0.78rem' }}>
                        <span style={{ color: '#9CA3AF' }}>Permissions: </span>
                        <strong style={{ color: '#FFFFFF' }}>{role.permissions.length} / 21</strong>
                      </div>
                      <div style={{ background: '#121C16', border: '1px solid #1B2E24', borderRadius: 6, padding: '6px 12px', fontSize: '0.78rem' }}>
                        <span style={{ color: '#9CA3AF' }}>Assigned: </span>
                        <strong style={{ color: '#FFFFFF' }}>{assignedAdmins.length} Administrator{assignedAdmins.length === 1 ? '' : 's'}</strong>
                      </div>
                    </div>

                    {/* Assigned Admins Roster Preview */}
                    <div style={{ marginBottom: 16 }}>
                      <span style={{ color: '#9CA3AF', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                        Active Members:
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {assignedAdmins.length === 0 ? (
                          <span style={{ color: '#6B7280', fontSize: '0.76rem', fontStyle: 'italic' }}>
                            No active administrators
                          </span>
                        ) : (
                          assignedAdmins.map((adm) => (
                            <span
                              key={adm.id}
                              style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: 4,
                                padding: '2px 8px',
                                fontSize: '0.74rem',
                                color: '#E2E8F0',
                              }}
                            >
                              {adm.fullName} ({adm.email.split('@')[0]})
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div style={{ borderTop: '1px solid #1B2E24', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="dash-filter-btn"
                      onClick={() => setViewingRole(role)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                    >
                      <Eye size={13} />
                      <span>Inspect Permissions</span>
                    </button>

                    <Link
                      to="/dashboard/super-admin/accounts"
                      style={{
                        color: isSuper ? '#50e396' : '#38bdf8',
                        textDecoration: 'none',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span>Manage Admins</span>
                      <ArrowRight size={12} />
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
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: 'rgba(80, 227, 150, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#50e396',
                    }}
                  >
                    <KeyRound size={17} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">{viewingRole.name} Role Details</h3>
                    <div style={{ color: '#9CA3AF', fontSize: '0.74rem' }}>
                      Canonical Platform Role Definition · <code>{viewingRole.id}</code>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close"
                  onClick={() => setViewingRole(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                <p style={{ margin: '0 0 16px', color: '#CBD5E1', fontSize: '0.86rem', lineHeight: 1.5 }}>
                  {viewingRole.description}
                </p>

                <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 10px' }}>
                  Assigned Capabilities ({viewingRole.permissions.length} / 21)
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {Array.from(viewingPermissionsByCategory.entries()).map(([cat, perms]) => {
                    if (perms.length === 0) return null
                    return (
                      <div key={cat} style={{ background: '#121C16', border: '1px solid #1B2E24', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: '0.74rem', color: '#10B981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          {cat} ({perms.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {perms.map((p) => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.8rem' }}>
                              <CheckCircle2 size={14} style={{ color: '#10B981', flexShrink: 0, marginTop: 2 }} />
                              <div>
                                <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{p.name}</span>
                                <div style={{ color: '#9CA3AF', fontSize: '0.74rem' }}>{p.description}</div>
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
