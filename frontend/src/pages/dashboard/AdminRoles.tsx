import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  KeyRound,
  ShieldCheck,
  Plus,
  Search,
  Eye,
  Edit2,
  Trash2,
  Copy,
  Lock,
  Check,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
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
  Sliders,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  getAllRoles,
  getRoleSummaryStats,
  getRoleAssignedAdmins,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  resetToDefaultRoles,
  PLATFORM_PERMISSIONS,
  getPermissionCategories,
  type AdminRoleDefinition,
  type RolePermission,
  type PermissionCategory,
} from '../../lib/adminRoleStore'

const COLOR_SWATCHES = [
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#a855f7', // purple
  '#50e396', // lime
  '#f43f5e', // rose
  '#3b82f6', // blue
  '#ec4899', // pink
]

function getCategoryIcon(category: PermissionCategory) {
  switch (category) {
    case 'GPU Infrastructure':
      return <Cpu size={15} style={{ color: '#06b6d4' }} />
    case 'FinOps & Billing':
      return <DollarSign size={15} style={{ color: '#f59e0b' }} />
    case 'Customer & Workspaces':
      return <Users size={15} style={{ color: '#a855f7' }} />
    case 'Security & Compliance':
      return <Shield size={15} style={{ color: '#ef4444' }} />
    case 'Administration & RBAC':
      return <KeyRound size={15} style={{ color: '#50e396' }} />
    case 'API & Networking':
      return <Globe size={15} style={{ color: '#38bdf8' }} />
    default:
      return <Sliders size={15} style={{ color: '#94a3b8' }} />
  }
}

function formatDate(isoStr?: string): string {
  if (!isoStr) return '—'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return isoStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return isoStr
  }
}

export default function AdminRoles() {
  usePageMeta('Role Management · Inferxe Super Admin', 'Manage platform standard profiles and author custom RBAC roles.')

  // Data state
  const [roles, setRoles] = useState<AdminRoleDefinition[]>(() => getAllRoles())
  const [stats, setStats] = useState(() => getRoleSummaryStats())

  // Filters & Controls
  const [searchQuery, setSearchQuery] = useState('')
  const [classificationFilter, setClassificationFilter] = useState<'all' | 'standard' | 'custom'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PermissionCategory>('all')
  const [sortBy, setSortBy] = useState<'name' | 'permissions_desc' | 'permissions_asc' | 'admins_desc' | 'recent'>('name')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<AdminRoleDefinition | null>(null)
  const [viewingRole, setViewingRole] = useState<AdminRoleDefinition | null>(null)
  const [deletingRole, setDeletingRole] = useState<AdminRoleDefinition | null>(null)
  const [resetModalOpen, setResetModalOpen] = useState(false)

  // Form state (used for both Add and Edit modals)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formColor, setFormColor] = useState('#10b981')
  const [formPermissions, setFormPermissions] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  // Toast notification state
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3800)
    return () => clearTimeout(timer)
  }, [toast])

  // Sync with stores
  const reloadData = useCallback(() => {
    setRoles(getAllRoles())
    setStats(getRoleSummaryStats())
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

  // Lock body scroll when any modal is open
  const isAnyModalOpen = Boolean(
    isAddModalOpen || editingRole || viewingRole || deletingRole || resetModalOpen
  )

  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden'
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsAddModalOpen(false)
          setEditingRole(null)
          setViewingRole(null)
          setDeletingRole(null)
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

  // Group all platform permissions by category for modal pickers
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

  // Filter and sort roles
  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return roles
      .filter((role) => {
        // Classification filter
        if (classificationFilter === 'standard' && !role.isStandard) return false
        if (classificationFilter === 'custom' && role.isStandard) return false

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
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name)
        }
        if (sortBy === 'permissions_desc') {
          return b.permissions.length - a.permissions.length
        }
        if (sortBy === 'permissions_asc') {
          return a.permissions.length - b.permissions.length
        }
        if (sortBy === 'admins_desc') {
          const adminsA = getRoleAssignedAdmins(a.id).length
          const adminsB = getRoleAssignedAdmins(b.id).length
          return adminsB - adminsA
        }
        if (sortBy === 'recent') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        }
        return 0
      })
  }, [roles, searchQuery, classificationFilter, categoryFilter, sortBy])

  // Open Add Custom Role Modal
  const openAddModal = (initialData?: { name?: string; description?: string; color?: string; permissions?: string[] }) => {
    setFormName(initialData?.name || '')
    setFormDescription(initialData?.description || '')
    setFormColor(initialData?.color || '#10b981')
    setFormPermissions(initialData?.permissions || [
      'infra:nodes:view',
      'infra:workloads:view',
      'infra:telemetry:view',
    ])
    setFormError(null)
    setIsAddModalOpen(true)
  }

  // Open Edit Custom Role Modal
  const openEditModal = (role: AdminRoleDefinition) => {
    if (role.isStandard) return
    setFormName(role.name)
    setFormDescription(role.description)
    setFormColor(role.color || '#10b981')
    setFormPermissions([...role.permissions])
    setFormError(null)
    setEditingRole(role)
  }

  // Open Duplicate Role Modal
  const handleDuplicate = (role: AdminRoleDefinition) => {
    openAddModal({
      name: `${role.name} (Copy)`,
      description: `Custom variant of ${role.name}. ${role.description}`,
      color: role.color,
      permissions: [...role.permissions],
    })
    showToast(`Template copied from "${role.name}". Customize your new role below.`)
  }

  // Handle Form Submission for Add
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const result = createCustomRole({
      name: formName,
      description: formDescription,
      color: formColor,
      permissions: formPermissions,
    })

    if (!result.ok) {
      setFormError(result.error || 'Failed to create role.')
      return
    }

    setIsAddModalOpen(false)
    reloadData()
    showToast(`Custom role "${result.role?.name}" created successfully.`)
  }

  // Handle Form Submission for Edit
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRole) return
    setFormError(null)

    const result = updateCustomRole(editingRole.id, {
      name: formName,
      description: formDescription,
      color: formColor,
      permissions: formPermissions,
    })

    if (!result.ok) {
      setFormError(result.error || 'Failed to update role.')
      return
    }

    setEditingRole(null)
    reloadData()
    showToast(`Custom role "${result.role?.name}" updated successfully.`)
  }

  // Handle Role Deletion
  const handleDeleteConfirm = () => {
    if (!deletingRole) return

    const result = deleteCustomRole(deletingRole.id)
    if (!result.ok) {
      showToast(result.error || 'Failed to delete role.', 'error')
      return
    }

    setDeletingRole(null)
    reloadData()
    showToast(`Custom role "${result.deletedRole?.name}" deleted successfully.`)
  }

  // Toggle single permission selection
  const togglePermission = (permId: string) => {
    setFormPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    )
  }

  // Toggle all permissions in a category
  const toggleCategoryPermissions = (category: PermissionCategory) => {
    const catPerms = (permissionsByCategory.get(category) || []).map((p) => p.id)
    const allSelected = catPerms.every((id) => formPermissions.includes(id))

    if (allSelected) {
      // Deselect all in this category
      setFormPermissions((prev) => prev.filter((id) => !catPerms.includes(id)))
    } else {
      // Select all in this category
      setFormPermissions((prev) => Array.from(new Set([...prev, ...catPerms])))
    }
  }

  // Select all 25 permissions
  const selectAllPermissions = () => {
    setFormPermissions(PLATFORM_PERMISSIONS.map((p) => p.id))
  }

  // Clear all permissions
  const clearAllPermissions = () => {
    setFormPermissions([])
  }

  // Helper to get categories covered by a role
  const getRoleCoveredCategories = (rolePerms: string[]): PermissionCategory[] => {
    const cats = new Set<PermissionCategory>()
    rolePerms.forEach((pId) => {
      const p = PLATFORM_PERMISSIONS.find((perm) => perm.id === pId)
      if (p) cats.add(p.category)
    })
    return Array.from(cats)
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

        {/* ── 1. Header Banner & Actions ──────────────────────── */}
        <div className="sa-header-banner">
          <div className="sa-banner-title-group">
            <div className="sa-shield-icon-wrap" aria-hidden="true">
              <KeyRound size={22} />
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
                  <span>Phase 2.1</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--sandbox">
                  <span className="sa-meta-badge__dot" />
                  <span>Prototype RBAC Sandbox</span>
                </span>
                <span className="sa-meta-badge sa-meta-badge--count">
                  <KeyRound size={12} />
                  <span>{roles.length} Roles Active</span>
                </span>
              </div>
              <h2 className="sa-banner-title">
                <span>Role Management</span>
              </h2>
              <div className="sa-banner-sub">
                Manage protected platform governance roles and define custom RBAC profiles with granular permissions for @inferxe.com administrators.
              </div>
            </div>
          </div>

          <div className="sa-banner-actions">
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => setResetModalOpen(true)}
              title="Reset prototype roles to default seed state"
            >
              <RotateCcw size={14} />
              <span>Reset Prototype Roles</span>
            </button>
            <button
              type="button"
              className="dash-primary-btn"
              onClick={() => openAddModal()}
            >
              <Plus size={15} />
              <span>Add Custom Role</span>
            </button>
          </div>
        </div>

        {/* ── 2. Demo Transparency Callout ──────────────────── */}
        <div className="sa-demo-banner" role="status">
          <AlertCircle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong style={{ color: '#fef3c7' }}>Prototype RBAC Storage Active:</strong>
            <div style={{ marginTop: 2, color: '#fcd34d', fontSize: '0.8rem', lineHeight: 1.45 }}>
              Standard roles (Super Admin, Infrastructure, Billing, Support, Security Auditor) are platform-enforced and immutable. Custom roles are persisted in your local browser sandbox and linked to administrator accounts.
            </div>
          </div>
        </div>

        {/* ── 3. KPI Statistics Grid ────────────────────────── */}
        <div className="sa-kpi-grid">
          {/* Total Roles */}
          <div className="sa-kpi-card sa-kpi-card--primary">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Total Roles</span>
              <div className="sa-kpi-card__icon-wrap">
                <KeyRound size={17} style={{ color: '#50e396' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.totalRoles}</div>
            <div className="sa-kpi-card__subtext">
              <span>Standard + Custom definitions</span>
            </div>
          </div>

          {/* Standard Roles */}
          <div className="sa-kpi-card sa-kpi-card--cyan">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Standard Roles</span>
              <div className="sa-kpi-card__icon-wrap">
                <Lock size={17} style={{ color: '#06b6d4' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.standardRolesCount}</div>
            <div className="sa-kpi-card__subtext">
              <span style={{ color: '#38bdf8' }}>Immutable Core Profiles</span>
            </div>
          </div>

          {/* Custom Roles */}
          <div className="sa-kpi-card sa-kpi-card--emerald">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Custom Roles</span>
              <div className="sa-kpi-card__icon-wrap">
                <Sparkles size={17} style={{ color: '#10b981' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.customRolesCount}</div>
            <div className="sa-kpi-card__subtext">
              <span>Granular tailored permissions</span>
            </div>
          </div>

          {/* Administrators Assigned */}
          <div className="sa-kpi-card sa-kpi-card--purple">
            <div className="sa-kpi-card__top">
              <span className="sa-kpi-card__label">Administrators Assigned</span>
              <div className="sa-kpi-card__icon-wrap">
                <Users size={17} style={{ color: '#a855f7' }} />
              </div>
            </div>
            <div className="sa-kpi-card__value">{stats.totalAssignedAdmins}</div>
            <div className="sa-kpi-card__subtext">
              <Link
                to="/dashboard/super-admin/accounts"
                style={{ color: '#c084fc', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <span>Manage in Admin Accounts</span>
                <ArrowRight size={12} />
              </Link>
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
              placeholder="Search by role name, description, or capability..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search roles"
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

          {/* Classification Filter */}
          <select
            className="sa-select"
            value={classificationFilter}
            onChange={(e) => setClassificationFilter(e.target.value as 'all' | 'standard' | 'custom')}
            aria-label="Filter by role type"
          >
            <option value="all">All Classifications ({roles.length})</option>
            <option value="standard">Standard Roles ({stats.standardRolesCount})</option>
            <option value="custom">Custom Roles ({stats.customRolesCount})</option>
          </select>

          {/* Category Filter */}
          <select
            className="sa-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | PermissionCategory)}
            aria-label="Filter by permission category"
          >
            <option value="all">All Capability Domains</option>
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
            aria-label="Sort roles"
          >
            <option value="name">Sort: Name (A-Z)</option>
            <option value="permissions_desc">Sort: Permissions (High to Low)</option>
            <option value="permissions_asc">Sort: Permissions (Low to High)</option>
            <option value="admins_desc">Sort: Assigned Admins</option>
            <option value="recent">Sort: Recently Added</option>
          </select>

          {/* Reset Filters */}
          {(searchQuery || classificationFilter !== 'all' || categoryFilter !== 'all' || sortBy !== 'name') && (
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => {
                setSearchQuery('')
                setClassificationFilter('all')
                setCategoryFilter('all')
                setSortBy('name')
              }}
            >
              Reset Filters
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="sa-view-toggle" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={`sa-view-toggle-btn ${viewMode === 'grid' ? 'is-active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Card Grid View"
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
              <span>Cards</span>
            </button>
            <button
              type="button"
              className={`sa-view-toggle-btn ${viewMode === 'table' ? 'is-active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Compact Table View"
              aria-label="Table view"
            >
              <List size={14} />
              <span>Table</span>
            </button>
          </div>
        </div>

        {/* ── 5. Main Content: Grid vs Table View ───────────── */}
        {filteredRoles.length === 0 ? (
          <div className="sa-empty-state">
            <KeyRound size={36} style={{ color: '#64748b', margin: '0 auto 12px' }} />
            <h3 style={{ color: '#ffffff', fontSize: '1rem', fontWeight: 600, margin: '0 0 4px' }}>
              No Roles Match Your Filter
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '0.82rem', maxWidth: 420, margin: '0 auto 16px' }}>
              Try adjusting your search query, classification, or capability domain filter.
            </p>
            <button
              type="button"
              className="dash-filter-btn"
              onClick={() => {
                setSearchQuery('')
                setClassificationFilter('all')
                setCategoryFilter('all')
              }}
            >
              Clear All Filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── 5A. Role Cards Grid ──────────────────────────── */
          <div className="sa-roles-grid">
            {filteredRoles.map((role) => {
              const assignedAdmins = getRoleAssignedAdmins(role.id)
              const coveredCategories = getRoleCoveredCategories(role.permissions)
              const permRatio = Math.round((role.permissions.length / PLATFORM_PERMISSIONS.length) * 100)

              return (
                <div key={role.id} className="sa-role-card-lg">
                  {/* Top Content Area */}
                  <div className="sa-role-card-lg__body">
                    {/* Header: Icon, Title, Standard / Custom Badge */}
                    <div className="sa-role-card-lg__top">
                      <div className="sa-role-card-lg__title-group">
                        <div
                          className="sa-role-card-lg__icon-wrap"
                          style={{
                            background: `radial-gradient(circle, ${role.color}22 0%, rgba(0,0,0,0.5) 100%)`,
                            borderColor: `${role.color}44`,
                          }}
                        >
                          <KeyRound size={18} style={{ color: role.color }} />
                        </div>
                        <div>
                          <h3 className="sa-role-card-lg__title">
                            <span>{role.name}</span>
                            {role.isStandard ? (
                              <span
                                className="sa-category-tag"
                                style={{
                                  background: 'rgba(6, 182, 212, 0.12)',
                                  borderColor: 'rgba(6, 182, 212, 0.3)',
                                  color: '#38bdf8',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <Lock size={10} />
                                <span>Standard</span>
                              </span>
                            ) : (
                              <span
                                className="sa-category-tag"
                                style={{
                                  background: 'rgba(16, 185, 129, 0.12)',
                                  borderColor: 'rgba(16, 185, 129, 0.3)',
                                  color: '#34d399',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <Sparkles size={10} />
                                <span>Custom</span>
                              </span>
                            )}
                          </h3>
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="sa-role-card-lg__desc">
                      {role.description}
                    </p>

                    {/* Stats Block: Assigned Admins & Granted Permissions */}
                    <div className="sa-role-card-lg__stats">
                      {/* Admins */}
                      <div className="sa-role-stat-item">
                        <span className="sa-role-stat-label">
                          <Users size={11} />
                          <span>Assigned Admins</span>
                        </span>
                        <div className="sa-role-stat-value">
                          <span>{assignedAdmins.length}</span>
                          {assignedAdmins.length > 0 && (
                            <div className="sa-avatar-stack" title={`${assignedAdmins.length} assigned administrators`}>
                              {assignedAdmins.slice(0, 3).map((admin) => (
                                <div
                                  key={admin.id}
                                  className="sa-avatar-stack__item"
                                  style={{ background: role.color }}
                                  title={`${admin.fullName} (${admin.email})`}
                                >
                                  {admin.fullName.charAt(0)}
                                </div>
                              ))}
                              {assignedAdmins.length > 3 && (
                                <div
                                  className="sa-avatar-stack__item"
                                  style={{ background: '#334155' }}
                                  title={`+${assignedAdmins.length - 3} more`}
                                >
                                  +{assignedAdmins.length - 3}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Permissions */}
                      <div className="sa-role-stat-item">
                        <span className="sa-role-stat-label">
                          <ShieldCheck size={11} />
                          <span>Permissions</span>
                        </span>
                        <div className="sa-role-stat-value">
                          <span>{role.permissions.length}</span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                            / 25 ({permRatio}%)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Covered Capability Domains */}
                    <div className="sa-role-card-lg__tags-section">
                      <div className="sa-role-card-lg__tags-label">
                        Capabilities Covered
                      </div>
                      <div className="sa-role-card-lg__tags">
                        {coveredCategories.map((cat) => (
                          <span key={cat} className="sa-category-tag">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Footer: View Details on Left, Management Actions on Right */}
                  <div className="sa-role-card-lg__footer">
                    <div className="sa-role-card-lg__footer-left">
                      <button
                        type="button"
                        className="sa-card-btn"
                        onClick={() => setViewingRole(role)}
                        title="Inspect role permissions and assigned administrators"
                      >
                        <Eye size={13} />
                        <span>Details</span>
                      </button>
                    </div>

                    <div className="sa-role-card-lg__footer-right">
                      <button
                        type="button"
                        className="sa-card-btn"
                        onClick={() => handleDuplicate(role)}
                        title="Duplicate this role template"
                      >
                        <Copy size={13} />
                        <span>Duplicate</span>
                      </button>

                      {!role.isStandard && (
                        <>
                          <button
                            type="button"
                            className="sa-card-btn"
                            onClick={() => openEditModal(role)}
                            title="Edit custom role name, description, and permissions"
                          >
                            <Edit2 size={13} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className="sa-card-btn sa-card-btn--delete"
                            onClick={() => setDeletingRole(role)}
                            title="Delete custom role"
                          >
                            <Trash2 size={13} />
                            <span>Delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── 5B. Compact Table View ───────────────────────── */
          <div className="sa-accounts-table-card">
            <div className="sa-table-responsive">
              <table className="sa-accounts-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Role Name</th>
                    <th style={{ width: '13%' }}>Type</th>
                    <th style={{ width: '26%' }}>Description</th>
                    <th style={{ width: '13%' }}>Assigned Admins</th>
                    <th style={{ width: '11%' }}>Permissions</th>
                    <th style={{ width: '15%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoles.map((role) => {
                    const assignedAdmins = getRoleAssignedAdmins(role.id)

                    return (
                      <tr key={role.id}>
                        {/* Name & Swatch */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                background: role.color,
                                boxShadow: `0 0 8px ${role.color}88`,
                                flexShrink: 0,
                              }}
                            />
                            <div>
                              <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.84rem' }}>
                                {role.name}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace' }}>
                                {role.id}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Classification */}
                        <td>
                          {role.isStandard ? (
                            <span
                              className="sa-category-tag"
                              style={{
                                background: 'rgba(6, 182, 212, 0.12)',
                                borderColor: 'rgba(6, 182, 212, 0.3)',
                                color: '#38bdf8',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Lock size={10} />
                              <span>Standard</span>
                            </span>
                          ) : (
                            <span
                              className="sa-category-tag"
                              style={{
                                background: 'rgba(16, 185, 129, 0.12)',
                                borderColor: 'rgba(16, 185, 129, 0.3)',
                                color: '#34d399',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Sparkles size={10} />
                              <span>Custom</span>
                            </span>
                          )}
                        </td>

                        {/* Description */}
                        <td>
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: '#94a3b8',
                              lineHeight: 1.4,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {role.description}
                          </div>
                        </td>

                        {/* Assigned Admins */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.86rem' }}>
                              {assignedAdmins.length}
                            </span>
                            {assignedAdmins.length > 0 && (
                              <div className="sa-avatar-stack">
                                {assignedAdmins.slice(0, 2).map((a) => (
                                  <div
                                    key={a.id}
                                    className="sa-avatar-stack__item"
                                    style={{ background: role.color }}
                                    title={a.fullName}
                                  >
                                    {a.fullName.charAt(0)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Permissions */}
                        <td>
                          <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.82rem' }}>
                            {role.permissions.length}{' '}
                            <span style={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 400 }}>
                              / 25
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            <button
                              type="button"
                              className="sa-action-btn"
                              onClick={() => setViewingRole(role)}
                              title="View details"
                            >
                              <Eye size={13} />
                            </button>
                            <button
                              type="button"
                              className="sa-action-btn"
                              onClick={() => handleDuplicate(role)}
                              title="Duplicate role"
                            >
                              <Copy size={13} />
                            </button>
                            {role.isStandard ? (
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  color: '#64748b',
                                  padding: '4px 6px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                                title="Standard roles cannot be altered"
                              >
                                <Lock size={12} />
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="sa-action-btn"
                                  onClick={() => openEditModal(role)}
                                  title="Edit role"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="sa-action-btn sa-action-btn--delete"
                                  onClick={() => setDeletingRole(role)}
                                  title="Delete role"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
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

        {/* ── 6. Add Custom Role Modal ──────────────────────── */}
        <AnimatePresence>
          {isAddModalOpen && (
            <div className="sa-modal-overlay" onClick={() => setIsAddModalOpen(false)}>
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
                    <h3 className="sa-modal-title">Create Custom RBAC Role</h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      Define a tailored role profile with granular capability grants for @inferxe.com administrators.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close-btn"
                    onClick={() => setIsAddModalOpen(false)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleCreateSubmit} className="sa-modal-form">
                  <div className="sa-modal-body">
                    {/* Error Banner */}
                    {formError && (
                      <div className="sa-error-banner" role="alert">
                        <AlertTriangle size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <span>{formError}</span>
                      </div>
                    )}

                    {/* Role Name */}
                    <div className="sa-form-group">
                      <label className="sa-form-label">
                        Role Name <span style={{ color: '#50e396' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="sa-form-input"
                        placeholder="e.g. Cluster Operations Lead, Audit Investigator"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        autoFocus
                        required
                      />
                    </div>

                    {/* Role Description */}
                    <div className="sa-form-group">
                      <label className="sa-form-label">Description & Scope</label>
                      <input
                        type="text"
                        className="sa-form-input"
                        placeholder="e.g. Specialized telemetry inspection for datacenter engineers."
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                      />
                    </div>

                    {/* Theme Accent Color */}
                    <div className="sa-form-group">
                      <label className="sa-form-label">Role Badge Color</label>
                      <div className="sa-color-swatches">
                        {COLOR_SWATCHES.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`sa-color-swatch ${formColor === color ? 'is-active' : ''}`}
                            style={{ background: color }}
                            onClick={() => setFormColor(color)}
                            title={color}
                          >
                            {formColor === color && <Check size={14} style={{ color: '#ffffff' }} />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Permission Selection Matrix Header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        background: 'rgba(80, 227, 150, 0.05)',
                        border: '1px solid rgba(80, 227, 150, 0.15)',
                        borderRadius: 8,
                        marginTop: 4,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#ffffff' }}>
                          Permission Matrix
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#50e396', fontWeight: 600 }}>
                          {formPermissions.length} of {PLATFORM_PERMISSIONS.length} permissions granted
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="sa-perm-category-toggle-btn"
                          onClick={selectAllPermissions}
                        >
                          Select All (25)
                        </button>
                        <span style={{ color: '#475569' }}>|</span>
                        <button
                          type="button"
                          className="sa-perm-category-toggle-btn"
                          onClick={clearAllPermissions}
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
                        const selectedInCat = catPerms.filter((p) => formPermissions.includes(p.id)).length
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
                                onClick={() => toggleCategoryPermissions(cat)}
                              >
                                {allSelected ? 'Deselect Category' : 'Select Category'}
                              </button>
                            </div>

                            <div className="sa-perm-items-list">
                              {catPerms.map((perm) => {
                                const isSelected = formPermissions.includes(perm.id)
                                return (
                                  <div
                                    key={perm.id}
                                    className={`sa-perm-item-row ${isSelected ? 'is-selected' : ''}`}
                                    onClick={() => togglePermission(perm.id)}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {}} // handled by row onClick
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
                      onClick={() => setIsAddModalOpen(false)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="dash-primary-btn">
                      Create Custom Role
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── 7. Edit Custom Role Modal ─────────────────────── */}
        <AnimatePresence>
          {editingRole && (
            <div className="sa-modal-overlay" onClick={() => setEditingRole(null)}>
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
                    <h3 className="sa-modal-title">Edit Custom Role: {editingRole.name}</h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      Update description, badge color, and granular permissions for this custom role.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close-btn"
                    onClick={() => setEditingRole(null)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleEditSubmit} className="sa-modal-form">
                  <div className="sa-modal-body">
                    {/* Error Banner */}
                    {formError && (
                      <div className="sa-error-banner" role="alert">
                        <AlertTriangle size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <span>{formError}</span>
                      </div>
                    )}

                    {/* Role Name */}
                    <div className="sa-form-group">
                      <label className="sa-form-label">
                        Role Name <span style={{ color: '#50e396' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="sa-form-input"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        required
                      />
                    </div>

                    {/* Role Description */}
                    <div className="sa-form-group">
                      <label className="sa-form-label">Description & Scope</label>
                      <input
                        type="text"
                        className="sa-form-input"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                      />
                    </div>

                    {/* Theme Accent Color */}
                    <div className="sa-form-group">
                      <label className="sa-form-label">Role Badge Color</label>
                      <div className="sa-color-swatches">
                        {COLOR_SWATCHES.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`sa-color-swatch ${formColor === color ? 'is-active' : ''}`}
                            style={{ background: color }}
                            onClick={() => setFormColor(color)}
                            title={color}
                          >
                            {formColor === color && <Check size={14} style={{ color: '#ffffff' }} />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Permission Selection Matrix Header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        background: 'rgba(80, 227, 150, 0.05)',
                        border: '1px solid rgba(80, 227, 150, 0.15)',
                        borderRadius: 8,
                        marginTop: 4,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#ffffff' }}>
                          Permission Matrix
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#50e396', fontWeight: 600 }}>
                          {formPermissions.length} of {PLATFORM_PERMISSIONS.length} permissions granted
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="sa-perm-category-toggle-btn"
                          onClick={selectAllPermissions}
                        >
                          Select All (25)
                        </button>
                        <span style={{ color: '#475569' }}>|</span>
                        <button
                          type="button"
                          className="sa-perm-category-toggle-btn"
                          onClick={clearAllPermissions}
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
                        const selectedInCat = catPerms.filter((p) => formPermissions.includes(p.id)).length
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
                                onClick={() => toggleCategoryPermissions(cat)}
                              >
                                {allSelected ? 'Deselect Category' : 'Select Category'}
                              </button>
                            </div>

                            <div className="sa-perm-items-list">
                              {catPerms.map((perm) => {
                                const isSelected = formPermissions.includes(perm.id)
                                return (
                                  <div
                                    key={perm.id}
                                    className={`sa-perm-item-row ${isSelected ? 'is-selected' : ''}`}
                                    onClick={() => togglePermission(perm.id)}
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
                      onClick={() => setEditingRole(null)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="dash-primary-btn">
                      Save Changes
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── 8. View Role Details Modal ────────────────────── */}
        <AnimatePresence>
          {viewingRole && (
            <div className="sa-modal-overlay" onClick={() => setViewingRole(null)}>
              <motion.div
                className="sa-modal-container"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                style={{ maxWidth: 720 }}
              >
                <div className="sa-modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: viewingRole.color,
                        boxShadow: `0 0 10px ${viewingRole.color}`,
                      }}
                    />
                    <div>
                      <h3 className="sa-modal-title">{viewingRole.name}</h3>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                        {viewingRole.isStandard ? 'Standard Platform Role' : 'Custom Configured Role'} · ID:{' '}
                        <code style={{ color: '#50e396' }}>{viewingRole.id}</code>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sa-modal-close-btn"
                    onClick={() => setViewingRole(null)}
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="sa-modal-body">
                  {/* Description Box */}
                  <div
                    style={{
                      padding: 14,
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                      Role Scope & Responsibilities
                    </div>
                    <div style={{ fontSize: '0.86rem', color: '#e2e8f0', lineHeight: 1.5 }}>
                      {viewingRole.description}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: '0.74rem', color: '#94a3b8' }}>
                      <span>Provisioned: <strong>{formatDate(viewingRole.createdAt)}</strong></span>
                      <span>Last Updated: <strong>{formatDate(viewingRole.updatedAt)}</strong></span>
                      <span>
                        Capabilities:{' '}
                        <strong style={{ color: '#50e396' }}>
                          {viewingRole.permissions.length} / 25
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Assigned Administrators Section */}
                  <div>
                    {(() => {
                      const assignedAdmins = getRoleAssignedAdmins(viewingRole.id)
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Users size={14} style={{ color: '#a855f7' }} />
                              <span>Assigned Administrators ({assignedAdmins.length})</span>
                            </div>
                            <Link
                              to="/dashboard/super-admin/accounts"
                              style={{ fontSize: '0.72rem', color: '#50e396', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <span>Admin Accounts</span>
                              <ExternalLink size={11} />
                            </Link>
                          </div>

                          {assignedAdmins.length === 0 ? (
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
                              No platform administrators are currently assigned to this role.
                            </div>
                          ) : (
                            <div className="sa-assigned-admins-list">
                              {assignedAdmins.map((admin) => (
                                <div key={admin.id} className="sa-assigned-admin-item">
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div
                                      style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: '50%',
                                        background: viewingRole.color,
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
                                  <span
                                    className={`sa-status-chip sa-status-chip--${admin.status}`}
                                    style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                                  >
                                    {admin.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>

                  {/* Granted Permissions List */}
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ffffff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ShieldCheck size={14} style={{ color: '#50e396' }} />
                      <span>Granted Capabilities by Domain</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {getPermissionCategories().map((cat) => {
                        const catPerms = permissionsByCategory.get(cat) || []
                        const grantedInCat = catPerms.filter((p) => viewingRole.permissions.includes(p.id))

                        if (grantedInCat.length === 0) return null

                        return (
                          <div key={cat} className="sa-perm-category-box">
                            <div className="sa-perm-category-header">
                              <div className="sa-perm-category-title">
                                {getCategoryIcon(cat)}
                                <span>{cat}</span>
                                <span className="sa-perm-category-count">
                                  ({grantedInCat.length} of {catPerms.length})
                                </span>
                              </div>
                            </div>
                            <div className="sa-perm-items-list">
                              {grantedInCat.map((perm) => (
                                <div key={perm.id} className="sa-perm-item-row is-selected" style={{ cursor: 'default' }}>
                                  <Check size={14} style={{ color: '#50e396', marginTop: 2, flexShrink: 0 }} />
                                  <div className="sa-perm-item-info">
                                    <div className="sa-perm-item-name">
                                      <span>{perm.name}</span>
                                      <span className="sa-perm-item-code">{perm.id}</span>
                                    </div>
                                    <div className="sa-perm-item-desc">{perm.description}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="sa-card-btn"
                    onClick={() => {
                      const r = viewingRole
                      setViewingRole(null)
                      handleDuplicate(r)
                    }}
                  >
                    <Copy size={13} />
                    <span>Duplicate as Custom</span>
                  </button>

                  {!viewingRole.isStandard && (
                    <button
                      type="button"
                      className="sa-card-btn"
                      onClick={() => {
                        const r = viewingRole
                        setViewingRole(null)
                        openEditModal(r)
                      }}
                    >
                      <Edit2 size={13} />
                      <span>Edit Role</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="dash-primary-btn"
                    onClick={() => setViewingRole(null)}
                    style={{ marginLeft: 'auto' }}
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── 9. Delete Custom Role Modal ───────────────────── */}
        <AnimatePresence>
          {deletingRole && (
            <div className="sa-modal-overlay" onClick={() => setDeletingRole(null)}>
              <motion.div
                className="sa-modal-container"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                style={{ maxWidth: 520 }}
              >
                {(() => {
                  const assignedAdmins = getRoleAssignedAdmins(deletingRole.id)
                  const isBlocked = assignedAdmins.length > 0

                  return (
                    <>
                      <div className="sa-modal-header sa-modal-header--danger">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="sa-modal-icon-wrap--danger">
                            <AlertTriangle size={20} />
                          </div>
                          <div>
                            <h3 className="sa-modal-title">
                              {isBlocked ? 'Cannot Delete Assigned Role' : 'Delete Custom Role'}
                            </h3>
                            <div style={{ fontSize: '0.74rem', color: '#fca5a5' }}>
                              {isBlocked ? 'Reassignment Required Before Deletion' : 'Irreversible Custom Role Removal'}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="sa-modal-close-btn"
                          onClick={() => setDeletingRole(null)}
                          aria-label="Close modal"
                        >
                          <X size={18} />
                        </button>
                      </div>

                      <div className="sa-modal-body">
                        {isBlocked ? (
                          /* Deletion Blocked Notice */
                          <>
                            <div className="sa-error-banner" style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                              <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                              <div>
                                <strong style={{ color: '#fecaca' }}>Integrity Violation Prevented:</strong>
                                <div style={{ fontSize: '0.78rem', color: '#fca5a5', marginTop: 3, lineHeight: 1.4 }}>
                                  The role <strong>"{deletingRole.name}"</strong> cannot be deleted because it is currently assigned to <strong>{assignedAdmins.length} active platform administrator(s)</strong>.
                                </div>
                              </div>
                            </div>

                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 6 }}>
                              Please reassign these administrators to another role in <strong>Admin Accounts</strong> before deleting this profile:
                            </div>

                            <div className="sa-assigned-admins-list" style={{ marginTop: 6 }}>
                              {assignedAdmins.map((admin) => (
                                <div key={admin.id} className="sa-assigned-admin-item">
                                  <div>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
                                      {admin.fullName}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                      {admin.email} · {admin.department}
                                    </div>
                                  </div>
                                  <span className={`sa-status-chip sa-status-chip--${admin.status}`} style={{ fontSize: '0.68rem' }}>
                                    {admin.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          /* Safe Deletion Confirmation */
                          <>
                            <div style={{ fontSize: '0.92rem', color: '#f1f5f9', lineHeight: 1.5 }}>
                              Are you sure you want to permanently delete the custom role <strong>"{deletingRole.name}"</strong>?
                            </div>

                            <div
                              style={{
                                padding: 12,
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: 8,
                                fontSize: '0.78rem',
                                color: '#94a3b8',
                              }}
                            >
                              <div>Role: <strong style={{ color: '#ffffff' }}>{deletingRole.name}</strong></div>
                              <div>Description: {deletingRole.description}</div>
                              <div>Granted Permissions: {deletingRole.permissions.length} capabilities</div>
                            </div>

                            <div style={{ fontSize: '0.78rem', color: '#f87171' }}>
                              This will remove the role definition from the platform catalog. This action cannot be undone.
                            </div>
                          </>
                        )}
                      </div>

                      <div className="sa-modal-footer">
                        {isBlocked ? (
                          <>
                            <button
                              type="button"
                              className="dash-filter-btn"
                              onClick={() => setDeletingRole(null)}
                            >
                              Close
                            </button>
                            <Link
                              to="/dashboard/super-admin/accounts"
                              className="dash-primary-btn"
                              style={{ textDecoration: 'none', marginLeft: 'auto' }}
                            >
                              <span>Go to Admin Accounts</span>
                              <ArrowRight size={14} />
                            </Link>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="dash-filter-btn"
                              onClick={() => setDeletingRole(null)}
                            >
                              No, Cancel
                            </button>
                            <button
                              type="button"
                              className="dash-primary-btn"
                              style={{
                                background: '#dc2626',
                                borderColor: '#ef4444',
                                color: '#ffffff',
                                marginLeft: 'auto',
                              }}
                              onClick={handleDeleteConfirm}
                            >
                              <Trash2 size={14} />
                              <span>Yes, Delete Role</span>
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )
                })()}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ── 10. Reset Prototype Roles Modal ─────────────────── */}
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
