import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  UserPlus,
  Eye,
  Edit2,
  Trash2,
  UserX,
  UserCheck,
  AlertTriangle,
  RotateCcw,
  X,
  Check,
  AlertCircle,
  Lock,
  CheckCircle2,
  Users,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  getAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  setAdminStatus,
  deleteAdminAccount,
  resetToDefaultAccounts,
  getAdminRoleMeta,
  type AdminAccount,
  type AdminRole,
  type AdminStatus,
  type CreateAdminInput,
} from '../../lib/adminAccountStore'
import { getAllRoles, type AdminRoleDefinition } from '../../lib/adminRoleStore'

function formatProvisionedDate(isoStr?: string): string {
  if (!isoStr) return '—'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return isoStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return isoStr
  }
}

export default function AdminAccounts() {
  usePageMeta('Admin Accounts · Inferxe Dashboard', 'Provision, audit, and configure privileges for platform administrators.')

  const [accounts, setAccounts] = useState<AdminAccount[]>(() => getAdminAccounts())
  const [allRoles, setAllRoles] = useState<AdminRoleDefinition[]>(() => getAllRoles())
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null)
  const [viewingAdmin, setViewingAdmin] = useState<AdminAccount | null>(null)
  const [deactivatingAdmin, setDeactivatingAdmin] = useState<AdminAccount | null>(null)
  const [reactivatingAdmin, setReactivatingAdmin] = useState<AdminAccount | null>(null)
  const [deletingAdmin, setDeletingAdmin] = useState<AdminAccount | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Add Admin form state
  const [newAdmin, setNewAdmin] = useState<CreateAdminInput>({
    fullName: '',
    email: '',
    role: 'infrastructure_admin',
    department: 'Infrastructure Operations',
    status: 'active',
    notes: '',
  })
  const [formErrors, setFormErrors] = useState<{ fullName?: string; email?: string }>({})

  const refreshAccounts = () => {
    setAccounts(getAdminAccounts())
  }

  // Cross-component and cross-tab synchronization
  useEffect(() => {
    const handleSync = () => {
      refreshAccounts()
      setAllRoles(getAllRoles())
    }
    window.addEventListener('inferxe_admin_accounts_change', handleSync)
    window.addEventListener('inferxe_admin_roles_change', handleSync)
    window.addEventListener('storage', handleSync)
    return () => {
      window.removeEventListener('inferxe_admin_accounts_change', handleSync)
      window.removeEventListener('inferxe_admin_roles_change', handleSync)
      window.removeEventListener('storage', handleSync)
    }
  }, [])

  // Auto-dismiss notification
  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(() => setNotification(null), 4000)
    return () => clearTimeout(timer)
  }, [notification])

  // Check if any modal is active to lock background body scroll
  const isAnyModalOpen = Boolean(
    isAddModalOpen ||
    editingAdmin ||
    viewingAdmin ||
    deactivatingAdmin ||
    reactivatingAdmin ||
    deletingAdmin
  )

  useEffect(() => {
    if (!isAnyModalOpen) return
    const originalOverflow = document.body.style.overflow
    const originalPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
      document.body.style.paddingRight = originalPaddingRight
    }
  }, [isAnyModalOpen])

  // Escape key closes whichever modal is open
  useEffect(() => {
    if (!isAnyModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deletingAdmin) {
          setDeletingAdmin(null)
        } else if (deactivatingAdmin) {
          setDeactivatingAdmin(null)
        } else if (reactivatingAdmin) {
          setReactivatingAdmin(null)
        } else if (editingAdmin) {
          setEditingAdmin(null)
        } else if (viewingAdmin) {
          setViewingAdmin(null)
        } else if (isAddModalOpen) {
          setIsAddModalOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAnyModalOpen, deletingAdmin, deactivatingAdmin, reactivatingAdmin, editingAdmin, viewingAdmin, isAddModalOpen])

  // Filtered accounts list
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const q = searchQuery.toLowerCase().trim()
      const matchesSearch =
        !q ||
        acc.fullName.toLowerCase().includes(q) ||
        acc.email.toLowerCase().includes(q) ||
        acc.department.toLowerCase().includes(q)

      const matchesRole = roleFilter === 'all' || acc.role === roleFilter
      const matchesStatus = statusFilter === 'all' || acc.status === statusFilter

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [accounts, searchQuery, roleFilter, statusFilter])

  // Validate Add Admin form
  const validateForm = (): boolean => {
    const errors: { fullName?: string; email?: string } = {}
    if (!newAdmin.fullName.trim() || newAdmin.fullName.trim().length < 2) {
      errors.fullName = 'Full Name is required (at least 2 characters).'
    }

    const email = newAdmin.email.trim().toLowerCase()
    if (!email) {
      errors.email = 'Corporate email is required.'
    } else if (!email.endsWith('@inferxe.com')) {
      errors.email = 'Company email MUST end with @inferxe.com'
    } else if (accounts.some((a) => a.email.toLowerCase() === email)) {
      errors.email = 'An administrator account with this email already exists.'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleAddAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

    const result = createAdminAccount(newAdmin)
    if (result.ok && result.account) {
      refreshAccounts()
      setIsAddModalOpen(false)
      setNewAdmin({
        fullName: '',
        email: '',
        role: 'infrastructure_admin',
        department: 'Infrastructure Operations',
        status: 'active',
        notes: '',
      })
      setFormErrors({})
      setNotification({
        message: `Prototype administrator ${result.account.fullName} provisioned in local store.`,
        type: 'success',
      })
    } else {
      setNotification({
        message: result.error || 'Failed to create administrator account.',
        type: 'error',
      })
    }
  }

  const handleStartDeactivate = (acc: AdminAccount) => {
    if (acc.id === 'adm-001') {
      setNotification({
        message: 'Primary Super Admin account cannot be deactivated.',
        type: 'error',
      })
      return
    }
    setDeactivatingAdmin(acc)
  }

  const handleStartReactivate = (acc: AdminAccount) => {
    setReactivatingAdmin(acc)
  }

  const handleStartDelete = (acc: AdminAccount) => {
    if (acc.id === 'adm-001') {
      setNotification({
        message: 'Primary Super Admin account cannot be deleted.',
        type: 'error',
      })
      return
    }
    setDeletingAdmin(acc)
  }

  const handleConfirmDelete = () => {
    if (!deletingAdmin) return
    if (deletingAdmin.id === 'adm-001') {
      setNotification({ message: 'Primary Super Admin account cannot be deleted.', type: 'error' })
      setDeletingAdmin(null)
      return
    }
    const target = deletingAdmin
    const res = deleteAdminAccount(target.id)
    if (res.ok) {
      refreshAccounts()
      if (viewingAdmin?.id === target.id) {
        setViewingAdmin(null)
      }
      const name = target.fullName
      const email = target.email
      setDeletingAdmin(null)
      setNotification({
        message: `Administrator ${name} (${email}) was permanently deleted.`,
        type: 'success',
      })
    } else {
      setNotification({ message: res.error || 'Failed to delete administrator.', type: 'error' })
    }
  }

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAdmin) return

    const res = updateAdminAccount(editingAdmin.id, {
      fullName: editingAdmin.fullName,
      role: editingAdmin.role,
      department: editingAdmin.department,
      status: editingAdmin.status,
      notes: editingAdmin.notes,
    })

    if (res.ok) {
      refreshAccounts()
      setEditingAdmin(null)
      setNotification({
        message: `Privileges for ${editingAdmin.fullName} updated successfully.`,
        type: 'success',
      })
    } else {
      setNotification({ message: res.error || 'Failed to update admin account.', type: 'error' })
    }
  }

  const handleResetData = () => {
    if (window.confirm('Reset all administrator accounts and logs to the default 10 seeded prototype accounts?')) {
      resetToDefaultAccounts()
      refreshAccounts()
      setNotification({
        message: 'Restored 10 default prototype administrator records.',
        type: 'success',
      })
    }
  }

  return (
    <DashboardLayout
      pageTitle="Admin Accounts"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Super Admin', to: '/dashboard/super-admin' },
        { label: 'Accounts' },
      ]}
      heading="Platform Administrator Accounts"
      description="Provision, audit, and configure privileges for @inferxe.com platform administrators."
      backButtonTo="/dashboard/super-admin"
      backButtonLabel="Super Admin Console"
    >
      {/* Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className={`sa-notification-toast sa-notification-toast--${notification.type}`}
          >
            {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{notification.message}</span>
            <button
              type="button"
              className="sa-modal-close-btn"
              onClick={() => setNotification(null)}
              style={{ marginLeft: 'auto', padding: 2 }}
              aria-label="Close notification"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 1. Top Banner ─────────────────────────────────── */}
      <div className="sa-header-banner">
        <div className="sa-banner-title-group">
          <div className="sa-shield-icon-wrap" aria-hidden="true">
            <Users size={22} />
          </div>
          <div>
            <h2 className="sa-banner-title">
              <span>{accounts.length} Platform Administrators Configured</span>
              <span className="sa-demo-chip">PROTOTYPE SANDBOX</span>
            </h2>
            <div className="sa-banner-sub">
              Target pool: 9–10 enterprise platform administrators. Identity authority will integrate with Supabase Auth in Phase 2.
            </div>
          </div>
        </div>

        <div className="sa-banner-actions">
          <button
            type="button"
            className="dash-filter-btn"
            onClick={handleResetData}
            title="Reset to default 10 seeded administrator accounts"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={13} />
            <span>Reset Seed Data</span>
          </button>

          <button
            type="button"
            className="dash-primary-btn"
            onClick={() => setIsAddModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <UserPlus size={15} />
            <span>Add Administrator</span>
          </button>
        </div>
      </div>

      {/* ── 2. Demo Transparency Callout ──────────────────── */}
      <div className="sa-demo-banner" role="status">
        <AlertCircle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Demonstration Data Environment:</strong> Displaying 10 seeded prototype platform administrators. Adding, editing, or deactivating accounts updates local prototype simulation state only. No real invitation emails or Supabase Auth invitations are dispatched in Phase 1.
        </div>
      </div>

      {/* ── 3. Search & Filter Bar ────────────────────────── */}
      <div className="sa-filter-bar">
        {/* Search */}
        <div className="sa-search-wrap">
          <Search size={15} className="sa-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search by administrator name, corporate email, or department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search platform administrators"
          />
          {searchQuery && (
            <button
              type="button"
              className="sa-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search query"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Role Filter */}
        <select
          className="sa-select"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by RBAC Role"
        >
          <option value="all">All Roles ({allRoles.length})</option>
          {allRoles.map((r) => {
            const count = accounts.filter((a) => a.role === r.id).length
            return (
              <option key={r.id} value={r.id}>
                {r.name} ({count})
              </option>
            )
          })}
        </select>

        {/* Status Filter */}
        <select
          className="sa-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by Status"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
          <option value="invited">Pending Invitations (Demo)</option>
        </select>

        {/* Reset */}
        {(searchQuery || roleFilter !== 'all' || statusFilter !== 'all') && (
          <button
            type="button"
            className="dash-filter-btn"
            onClick={() => {
              setSearchQuery('')
              setRoleFilter('all')
              setStatusFilter('all')
            }}
            title="Reset filters"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={13} />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* ── 4. Admin Accounts Table (Aligned Separate Columns) */}
      <div className="sa-table-container">
        <table className="sa-table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>Administrator</th>
              <th style={{ width: '23%' }}>Corporate Email</th>
              <th style={{ width: '17%' }}>Assigned RBAC Role</th>
              <th style={{ width: '11%' }}>Status</th>
              <th style={{ width: '12%' }}>Provisioned</th>
              <th style={{ width: '12%' }}>Last Active</th>
              <th style={{ width: '140px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--ink-3)' }}>
                  <Users size={32} style={{ margin: '0 auto 10px', opacity: 0.4, display: 'block' }} />
                  <div>No administrators match your active filter criteria.</div>
                  <button
                    type="button"
                    className="sa-link-action"
                    onClick={() => {
                      setSearchQuery('')
                      setRoleFilter('all')
                      setStatusFilter('all')
                    }}
                    style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Reset all filters
                  </button>
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc) => {
                const roleMeta = getAdminRoleMeta(acc.role)
                return (
                  <tr key={acc.id} className={acc.status === 'inactive' ? 'sa-row--inactive' : ''}>
                    {/* Column 1: Admin Name, Initials Avatar & Dept */}
                    <td>
                      <div className="sa-user-cell">
                        <div
                          className="sa-avatar-circle"
                          style={{ background: acc.avatarGradient }}
                          aria-hidden="true"
                        >
                          {acc.avatarInitials}
                        </div>
                        <div className="sa-user-meta">
                          <span className="sa-user-meta__name">{acc.fullName}</span>
                          <span className="sa-user-meta__dept">{acc.department}</span>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Corporate Email (Fixed: No duplicate @inferxe.com badge) */}
                    <td>
                      <div className="sa-email-cell">
                        <span className="sa-email-text">{acc.email}</span>
                      </div>
                    </td>

                    {/* Column 3: Assigned Role */}
                    <td>
                      <span className={`sa-role-pill sa-role-pill--${acc.role}`}>
                        {roleMeta.title}
                      </span>
                    </td>

                    {/* Column 4: Status */}
                    <td>
                      <span className={`sa-status-pill sa-status-pill--${acc.status}`}>
                        <span className="sa-status-pill__dot" />
                        {acc.status === 'active' && 'Active'}
                        {acc.status === 'inactive' && 'Inactive'}
                        {acc.status === 'invited' && 'Invited (Demo)'}
                      </span>
                    </td>

                    {/* Column 5: Created / Provisioned Date */}
                    <td>
                      <span className="sa-date-text">{formatProvisionedDate(acc.createdAt)}</span>
                    </td>

                    {/* Column 6: Last Active */}
                    <td>
                      <span
                        className="sa-date-text"
                        style={{ color: acc.status === 'active' ? '#50e396' : '#94a3b8' }}
                      >
                        {acc.lastActiveAt}
                      </span>
                    </td>

                    {/* Column 7: Actions (Aligned & Accessible) */}
                    <td style={{ textAlign: 'right' }}>
                      <div className="sa-action-group">
                        <button
                          type="button"
                          className="sa-action-btn"
                          title="View administrator profile & privileges"
                          onClick={() => setViewingAdmin(acc)}
                          aria-label={`View details for ${acc.fullName}`}
                        >
                          <Eye size={14} />
                        </button>

                        <button
                          type="button"
                          className="sa-action-btn"
                          title="Edit administrator role"
                          onClick={() => setEditingAdmin(acc)}
                          aria-label={`Edit ${acc.fullName}`}
                        >
                          <Edit2 size={14} />
                        </button>

                        {acc.status === 'active' ? (
                          <button
                            type="button"
                            className="sa-action-btn sa-action-btn--warning"
                            title={
                              acc.id === 'adm-001'
                                ? 'Primary Super Admin cannot be deactivated'
                                : 'Deactivate administrator account'
                            }
                            disabled={acc.id === 'adm-001'}
                            onClick={() => handleStartDeactivate(acc)}
                            aria-label={`Deactivate ${acc.fullName}`}
                          >
                            <UserX size={14} />
                          </button>
                        ) : acc.status === 'inactive' ? (
                          <button
                            type="button"
                            className="sa-action-btn sa-action-btn--success"
                            title="Reactivate administrator account"
                            disabled={acc.id === 'adm-001'}
                            onClick={() => handleStartReactivate(acc)}
                            aria-label={`Reactivate ${acc.fullName}`}
                          >
                            <UserCheck size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sa-action-btn sa-action-btn--warning"
                            title="Revoke / Deactivate invitation"
                            onClick={() => handleStartDeactivate(acc)}
                            aria-label={`Revoke invitation for ${acc.fullName}`}
                          >
                            <UserX size={14} />
                          </button>
                        )}

                        <button
                          type="button"
                          className="sa-action-btn sa-action-btn--delete"
                          title={
                            acc.id === 'adm-001'
                              ? 'Primary Super Admin cannot be deleted'
                              : 'Delete administrator permanently'
                          }
                          disabled={acc.id === 'adm-001'}
                          onClick={() => handleStartDelete(acc)}
                          aria-label={`Delete ${acc.fullName}`}
                        >
                          <Trash2 size={14} />
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

      {/* ── 5. Add Administrator Modal ────────────────────── */}
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
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-shield-icon-wrap" style={{ width: 34, height: 34 }}>
                    <UserPlus size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Add Platform Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      Enforce strict @inferxe.com corporate identity.
                    </div>
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

              <form onSubmit={handleAddAdminSubmit} className="sa-modal-form">
                <div className="sa-modal-body">
                  {/* Full Name */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">
                      <span>Full Name</span>
                      <span style={{ color: '#50e396' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="sa-form-input"
                      placeholder="e.g. Vikram Malhotra"
                      value={newAdmin.fullName}
                      onChange={(e) => {
                        setNewAdmin({ ...newAdmin, fullName: e.target.value })
                        if (formErrors.fullName) setFormErrors({ ...formErrors, fullName: undefined })
                      }}
                    />
                    {formErrors.fullName && <span className="sa-form-error">{formErrors.fullName}</span>}
                  </div>

                  {/* Corporate Email */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">
                      <span>Corporate Email Address</span>
                      <span style={{ color: '#50e396' }}>* (@inferxe.com)</span>
                    </label>
                    <input
                      type="email"
                      className="sa-form-input"
                      placeholder="name@inferxe.com"
                      value={newAdmin.email}
                      onChange={(e) => {
                        setNewAdmin({ ...newAdmin, email: e.target.value })
                        if (formErrors.email) setFormErrors({ ...formErrors, email: undefined })
                      }}
                    />
                    <span className="sa-form-hint">
                      Must use official corporate domain: <code>@inferxe.com</code>
                    </span>
                    {formErrors.email && <span className="sa-form-error">{formErrors.email}</span>}
                  </div>

                  {/* RBAC Role Selection */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">
                      <span>Assigned RBAC Role</span>
                      <span style={{ color: '#50e396' }}>*</span>
                    </label>
                    <select
                      className="sa-form-input"
                      value={newAdmin.role}
                      onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value as AdminRole })}
                    >
                      <optgroup label="Standard Platform Roles">
                        {allRoles.filter((r) => r.isStandard).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} — {r.description}
                          </option>
                        ))}
                      </optgroup>
                      {allRoles.some((r) => !r.isStandard) && (
                        <optgroup label="Custom Configured Roles">
                          {allRoles.filter((r) => !r.isStandard).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} — {r.description}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {/* Department */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">Department / Unit</label>
                    <input
                      type="text"
                      className="sa-form-input"
                      placeholder="e.g. Infrastructure Operations, Security, Billing"
                      value={newAdmin.department}
                      onChange={(e) => setNewAdmin({ ...newAdmin, department: e.target.value })}
                    />
                  </div>

                  {/* Initial Account Status */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">Initial Account Status</label>
                    <select
                      className="sa-form-input"
                      value={newAdmin.status}
                      onChange={(e) => setNewAdmin({ ...newAdmin, status: e.target.value as AdminStatus })}
                    >
                      <option value="active">Active (Immediate platform access)</option>
                      <option value="invited">Pending Invitation (Simulated invitation)</option>
                    </select>
                  </div>

                  {/* Optional Notes */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">Internal Provisioning Notes</label>
                    <input
                      type="text"
                      className="sa-form-input"
                      placeholder="e.g. Approved during Q4 engineering security review"
                      value={newAdmin.notes || ''}
                      onChange={(e) => setNewAdmin({ ...newAdmin, notes: e.target.value })}
                    />
                  </div>

                  {/* Security Notice: No Plaintext Passwords */}
                  <div className="sa-security-notice">
                    <Lock size={18} style={{ color: '#38bdf8', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong>Zero-Knowledge Invitation Policy (Phase 1 Sandbox):</strong>
                      <div>
                        No plaintext passwords are collected or stored. In Phase 2, an encrypted Supabase Auth invite link will be dispatched to this corporate address for cryptographic key setup.
                      </div>
                    </div>
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
                    Provision Administrator
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 6. Edit Administrator Modal ───────────────────── */}
      <AnimatePresence>
        {editingAdmin && (
          <div className="sa-modal-overlay" onClick={() => setEditingAdmin(null)}>
            <motion.div
              className="sa-modal-container"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
            >
              <div className="sa-modal-header">
                <div>
                  <h3 className="sa-modal-title">Modify Administrator Privileges</h3>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    {editingAdmin.fullName} ({editingAdmin.email})
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={() => setEditingAdmin(null)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleEditSubmit} className="sa-modal-form">
                <div className="sa-modal-body">
                  <div className="sa-form-group">
                    <label className="sa-form-label">Full Name</label>
                    <input
                      type="text"
                      className="sa-form-input"
                      value={editingAdmin.fullName}
                      onChange={(e) => setEditingAdmin({ ...editingAdmin, fullName: e.target.value })}
                    />
                  </div>

                  <div className="sa-form-group">
                    <label className="sa-form-label">Assigned RBAC Role</label>
                    <select
                      className="sa-form-input"
                      value={editingAdmin.role}
                      onChange={(e) => setEditingAdmin({ ...editingAdmin, role: e.target.value as AdminRole })}
                    >
                      <optgroup label="Standard Platform Roles">
                        {allRoles.filter((r) => r.isStandard).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                      {allRoles.some((r) => !r.isStandard) && (
                        <optgroup label="Custom Configured Roles">
                          {allRoles.filter((r) => !r.isStandard).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <span className="sa-form-hint">
                      {getAdminRoleMeta(editingAdmin.role).description}
                    </span>
                  </div>

                  <div className="sa-form-group">
                    <label className="sa-form-label">Department / Unit</label>
                    <input
                      type="text"
                      className="sa-form-input"
                      value={editingAdmin.department}
                      onChange={(e) => setEditingAdmin({ ...editingAdmin, department: e.target.value })}
                    />
                  </div>

                  <div className="sa-form-group">
                    <label className="sa-form-label">Account Status</label>
                    <select
                      className="sa-form-input"
                      value={editingAdmin.status}
                      disabled={editingAdmin.id === 'adm-001'}
                      onChange={(e) => setEditingAdmin({ ...editingAdmin, status: e.target.value as AdminStatus })}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive (Suspended)</option>
                      <option value="invited">Pending Invitation (Demo)</option>
                    </select>
                    {editingAdmin.id === 'adm-001' && (
                      <span className="sa-form-hint" style={{ color: '#fbbf24' }}>
                        Primary Super Admin cannot be suspended.
                      </span>
                    )}
                  </div>

                  <div className="sa-form-group">
                    <label className="sa-form-label">Administrative Notes</label>
                    <input
                      type="text"
                      className="sa-form-input"
                      value={editingAdmin.notes || ''}
                      onChange={(e) => setEditingAdmin({ ...editingAdmin, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-filter-btn"
                    onClick={() => setEditingAdmin(null)}
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

      {/* ── 7. View Administrator Details Drawer ───────────── */}
      <AnimatePresence>
        {viewingAdmin && (
          <div className="sa-modal-overlay" onClick={() => setViewingAdmin(null)}>
            <motion.div
              className="sa-modal-container"
              style={{ maxWidth: 540 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    className="sa-avatar-circle"
                    style={{ background: viewingAdmin.avatarGradient, width: 40, height: 40, fontSize: '0.95rem' }}
                    aria-hidden="true"
                  >
                    {viewingAdmin.avatarInitials}
                  </div>
                  <div>
                    <h3 className="sa-modal-title">{viewingAdmin.fullName}</h3>
                    <div style={{ fontSize: '0.76rem', color: '#50e396' }}>{viewingAdmin.email}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={() => setViewingAdmin(null)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                {/* Meta details list */}
                <div className="sa-detail-list">
                  <div className="sa-detail-row">
                    <span className="sa-detail-label">Account Identifier:</span>
                    <span className="sa-detail-val"><code>{viewingAdmin.id}</code></span>
                  </div>

                  <div className="sa-detail-row">
                    <span className="sa-detail-label">Assigned RBAC Role:</span>
                    <span className="sa-detail-val">
                      <span className={`sa-role-pill sa-role-pill--${viewingAdmin.role}`}>
                        {getAdminRoleMeta(viewingAdmin.role).title}
                      </span>
                    </span>
                  </div>

                  <div className="sa-detail-row">
                    <span className="sa-detail-label">Account Status:</span>
                    <span className="sa-detail-val">
                      <span className={`sa-status-pill sa-status-pill--${viewingAdmin.status}`}>
                        <span className="sa-status-pill__dot" />
                        {viewingAdmin.status.toUpperCase()}
                      </span>
                    </span>
                  </div>

                  <div className="sa-detail-row">
                    <span className="sa-detail-label">Department / Unit:</span>
                    <span className="sa-detail-val">{viewingAdmin.department}</span>
                  </div>

                  <div className="sa-detail-row">
                    <span className="sa-detail-label">Provisioned Date:</span>
                    <span className="sa-detail-val">{formatProvisionedDate(viewingAdmin.createdAt)}</span>
                  </div>

                  <div className="sa-detail-row">
                    <span className="sa-detail-label">Last Active:</span>
                    <span className="sa-detail-val">{viewingAdmin.lastActiveAt}</span>
                  </div>

                  {viewingAdmin.notes && (
                    <div className="sa-detail-row">
                      <span className="sa-detail-label">Internal Notes:</span>
                      <span className="sa-detail-val">{viewingAdmin.notes}</span>
                    </div>
                  )}
                </div>

                {/* Role Permissions Matrix */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>
                    Granted Role Capabilities:
                  </div>
                  <div className="sa-perm-badges">
                    {getAdminRoleMeta(viewingAdmin.role).permissionsSummary.map((perm: string) => (
                      <span key={perm} className="sa-perm-chip">
                        <Check size={12} style={{ color: '#50e396' }} />
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="sa-modal-footer" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {viewingAdmin.id !== 'adm-001' ? (
                    <>
                      {viewingAdmin.status === 'active' ? (
                        <button
                          type="button"
                          className="dash-warning-btn"
                          style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                          onClick={() => handleStartDeactivate(viewingAdmin)}
                        >
                          <UserX size={14} />
                          <span>Deactivate</span>
                        </button>
                      ) : viewingAdmin.status === 'inactive' ? (
                        <button
                          type="button"
                          className="dash-primary-btn"
                          style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                          onClick={() => handleStartReactivate(viewingAdmin)}
                        >
                          <UserCheck size={14} />
                          <span>Reactivate</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="dash-warning-btn"
                          style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                          onClick={() => handleStartDeactivate(viewingAdmin)}
                        >
                          <UserX size={14} />
                          <span>Revoke Invite</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="dash-danger-btn"
                        style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                        onClick={() => handleStartDelete(viewingAdmin)}
                      >
                        <Trash2 size={14} />
                        <span>Delete</span>
                      </button>
                    </>
                  ) : (
                    <span className="sa-scope-badge" title="Protected root administrator">
                      <span className="sa-scope-badge__dot" />
                      Primary Super Admin Protected
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="dash-filter-btn"
                    onClick={() => setViewingAdmin(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="dash-primary-btn"
                    onClick={() => {
                      const target = viewingAdmin
                      setViewingAdmin(null)
                      setEditingAdmin(target)
                    }}
                  >
                    <Edit2 size={13} />
                    <span>Edit Role</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 8. Deactivate Confirmation Modal ──────────────── */}
      <AnimatePresence>
        {deactivatingAdmin && (
          <div className="sa-modal-overlay" onClick={() => setDeactivatingAdmin(null)}>
            <motion.div
              className="sa-modal-container sa-modal-container--warning"
              style={{ maxWidth: 490 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-modal-icon-wrap--warning">
                    <UserX size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Deactivate Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#fbbf24' }}>
                      Suspend platform console access privileges
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={() => setDeactivatingAdmin(null)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                {deactivatingAdmin.id === 'adm-001' ? (
                  <div className="sa-confirm-box sa-confirm-box--danger">
                    <strong>Primary Super Admin Protected</strong>
                    <div>
                      The primary Super Admin account (<code>bhumireddy@inferxe.com</code>) cannot be deactivated. Platform governance requires an active primary administrator.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sa-confirm-box sa-confirm-box--warning">
                      <div>
                        Are you sure you want to deactivate <strong>{deactivatingAdmin.fullName}</strong>?
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#fef3c7' }}>
                        Deactivation retains the administrator record, role configuration, and audit logs, but immediately terminates active sessions and prevents further platform access.
                      </div>
                    </div>

                    <div className="sa-confirm-target-card">
                      <div
                        className="sa-avatar-circle"
                        style={{ background: deactivatingAdmin.avatarGradient, width: 36, height: 36, fontSize: '0.82rem' }}
                        aria-hidden="true"
                      >
                        {deactivatingAdmin.avatarInitials}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                        <span style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.86rem' }}>
                          {deactivatingAdmin.fullName}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#cbd5e1', fontSize: '0.78rem' }}>
                          {deactivatingAdmin.email}
                        </span>
                      </div>
                      <span className={`sa-role-pill sa-role-pill--${deactivatingAdmin.role}`} style={{ fontSize: '0.7rem' }}>
                        {getAdminRoleMeta(deactivatingAdmin.role).title}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <CheckCircle2 size={13} style={{ color: '#50e396', flexShrink: 0 }} />
                      <span>This account can be reactivated at any time by a Super Admin.</span>
                    </div>
                  </>
                )}
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  onClick={() => setDeactivatingAdmin(null)}
                >
                  Cancel
                </button>
                {deactivatingAdmin.id !== 'adm-001' && (
                  <button
                    type="button"
                    className="dash-warning-btn"
                    onClick={() => {
                      const target = deactivatingAdmin
                      const res = setAdminStatus(target.id, 'inactive')
                      if (res.ok) {
                        refreshAccounts()
                        if (viewingAdmin?.id === target.id) {
                          setViewingAdmin({ ...viewingAdmin, status: 'inactive' })
                        }
                        setDeactivatingAdmin(null)
                        setNotification({
                          message: `Administrator ${target.fullName} has been deactivated. Access suspended.`,
                          type: 'success',
                        })
                      } else {
                        setNotification({ message: res.error || 'Deactivation failed.', type: 'error' })
                      }
                    }}
                  >
                    <UserX size={14} />
                    <span>Deactivate Account</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 9. Reactivate Confirmation Modal ──────────────── */}
      <AnimatePresence>
        {reactivatingAdmin && (
          <div className="sa-modal-overlay" onClick={() => setReactivatingAdmin(null)}>
            <motion.div
              className="sa-modal-container"
              style={{ maxWidth: 490 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-modal-icon-wrap--success">
                    <UserCheck size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Reactivate Platform Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#50e396' }}>
                      Restore platform console access privileges
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={() => setReactivatingAdmin(null)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                <div className="sa-confirm-target-card">
                  <div
                    className="sa-avatar-circle"
                    style={{ background: reactivatingAdmin.avatarGradient, width: 36, height: 36, fontSize: '0.82rem' }}
                    aria-hidden="true"
                  >
                    {reactivatingAdmin.avatarInitials}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <span style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.86rem' }}>
                      {reactivatingAdmin.fullName}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#cbd5e1', fontSize: '0.78rem' }}>
                      {reactivatingAdmin.email}
                    </span>
                  </div>
                  <span className={`sa-role-pill sa-role-pill--${reactivatingAdmin.role}`} style={{ fontSize: '0.7rem' }}>
                    {getAdminRoleMeta(reactivatingAdmin.role).title}
                  </span>
                </div>

                <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                  Reactivating <strong>{reactivatingAdmin.fullName}</strong> will restore full administrative privileges corresponding to their assigned <strong>{getAdminRoleMeta(reactivatingAdmin.role).title}</strong> role.
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  onClick={() => setReactivatingAdmin(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-primary-btn"
                  onClick={() => {
                    const target = reactivatingAdmin
                    const res = setAdminStatus(target.id, 'active')
                    if (res.ok) {
                      refreshAccounts()
                      if (viewingAdmin?.id === target.id) {
                        setViewingAdmin({ ...viewingAdmin, status: 'active' })
                      }
                      setReactivatingAdmin(null)
                      setNotification({
                        message: `Administrator ${target.fullName} has been reactivated. Access restored.`,
                        type: 'success',
                      })
                    } else {
                      setNotification({ message: res.error || 'Reactivation failed.', type: 'error' })
                    }
                  }}
                >
                  <UserCheck size={14} />
                  <span>Reactivate Account</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 10. Delete Confirmation Modal ─────────────────── */}
      <AnimatePresence>
        {deletingAdmin && (
          <div className="sa-modal-overlay" onClick={() => setDeletingAdmin(null)}>
            <motion.div
              className="sa-modal-container sa-modal-container--danger"
              style={{ maxWidth: 490 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            >
              <div className="sa-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="sa-modal-icon-wrap--danger">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Delete Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#f87171' }}>
                      Permanent account removal
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={() => setDeletingAdmin(null)}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                {deletingAdmin.id === 'adm-001' ? (
                  <div className="sa-confirm-box sa-confirm-box--danger">
                    <strong>Primary Super Admin Protected</strong>
                    <div>
                      The primary Super Admin account (<code>bhumireddy@inferxe.com</code>) cannot be deleted under any circumstances. Platform security requires the primary root administrator to remain intact.
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', lineHeight: 1.4 }}>
                      Are you sure you want to delete this administrator?
                    </div>

                    <div className="sa-confirm-box sa-confirm-box--danger">
                      <div>
                        This action is permanent and cannot be undone. The administrator record, permissions, and platform access will be permanently removed from local prototype storage.
                      </div>
                    </div>

                    <div className="sa-confirm-target-card">
                      <div
                        className="sa-avatar-circle"
                        style={{ background: deletingAdmin.avatarGradient, width: 38, height: 38, fontSize: '0.86rem' }}
                        aria-hidden="true"
                      >
                        {deletingAdmin.avatarInitials}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                        <span style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.9rem' }}>
                          {deletingAdmin.fullName}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#cbd5e1', fontSize: '0.8rem' }}>
                          {deletingAdmin.email}
                        </span>
                      </div>
                      <span className={`sa-role-pill sa-role-pill--${deletingAdmin.role}`} style={{ fontSize: '0.72rem' }}>
                        {getAdminRoleMeta(deletingAdmin.role).title}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  onClick={() => setDeletingAdmin(null)}
                >
                  No, Cancel
                </button>
                {deletingAdmin.id !== 'adm-001' && (
                  <button
                    type="button"
                    className="dash-danger-btn"
                    onClick={handleConfirmDelete}
                  >
                    <Trash2 size={14} />
                    <span>Yes, Delete</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}
