import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  UserPlus,
  Eye,
  EyeOff,
  UserX,
  UserCheck,
  RefreshCw,
  RotateCcw,
  X,
  AlertCircle,
  Lock,
  CheckCircle2,
  Users,
  ShieldCheck,
  Pencil,
  Trash2,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  mapBackendAdminToAccount,
  syncAdminAccountsFromBackend,
  getAdminAccounts,
  getAdminRoleMeta,
  type AdminAccount,
} from '../../lib/adminAccountStore'
import {
  createDeveloperAdminAccount,
  deleteSuperadminAdmin,
  updateAdminAccountStatus,
  updateSuperadminAdmin,
} from '../../lib/authStore'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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

function isProtectedSuperAdmin(acc: AdminAccount): boolean {
  return Boolean(acc.isSuperAdmin || acc.role === 'super_admin')
}

function validateNewAdminPassword(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters long.'
  if (password.length > 128) return 'Password must not exceed 128 characters.'
  if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter.'
  if (!/[a-z]/.test(password)) return 'Password must include at least one lowercase letter.'
  if (!/[0-9]/.test(password)) return 'Password must include at least one number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character.'
  return null
}

export default function AdminAccounts() {
  usePageMeta(
    'Admin Accounts · Inferxe Dashboard',
    'Provision, audit, and govern real database-backed platform administrator accounts.',
  )

  const [accounts, setAccounts] = useState<AdminAccount[]>(() => {
    try {
      return getAdminAccounts()
    } catch {
      return []
    }
  })
  const [loading, setLoading] = useState<boolean>(() => {
    try {
      return getAdminAccounts().length === 0
    } catch {
      return true
    }
  })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [viewingAdmin, setViewingAdmin] = useState<AdminAccount | null>(null)
  const [deactivatingAdmin, setDeactivatingAdmin] = useState<AdminAccount | null>(null)
  const [reactivatingAdmin, setReactivatingAdmin] = useState<AdminAccount | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [submittingStatus, setSubmittingStatus] = useState(false)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Add Administrator form state (backed by POST /api/superadmin/admins)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [creatingAdmin, setCreatingAdmin] = useState(false)
  const [formErrors, setFormErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    submit?: string
  }>({})

  // Edit Administrator form state (backed by PATCH /api/superadmin/admins/:id)
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editConfirmPassword, setEditConfirmPassword] = useState('')
  const [editReason, setEditReason] = useState('')
  const [showEditPassword, setShowEditPassword] = useState(false)
  const [updatingAdmin, setUpdatingAdmin] = useState(false)
  const [editErrors, setEditErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    submit?: string
  }>({})

  // Delete Administrator state (backed by DELETE /api/superadmin/admins/:id)
  const [deletingAdmin, setDeletingAdmin] = useState<AdminAccount | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deletingAdminLoading, setDeletingAdminLoading] = useState(false)

  const loadAccountsFromBackend = useCallback(async (force = false) => {
    if (getAdminAccounts().length === 0) {
      setLoading(true)
    }
    setLoadError(null)
    const result = await syncAdminAccountsFromBackend(force)
    if (result.ok) {
      setAccounts(result.accounts)
    } else {
      setLoadError(result.error || 'Failed to fetch administrator accounts from Supabase.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadAccountsFromBackend()
  }, [loadAccountsFromBackend])

  // Auto-dismiss notification
  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(() => setNotification(null), 5000)
    return () => clearTimeout(timer)
  }, [notification])

  const isAnyModalOpen = Boolean(
    isAddModalOpen ||
      viewingAdmin ||
      deactivatingAdmin ||
      reactivatingAdmin ||
      editingAdmin ||
      deletingAdmin,
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

  const closeAddModal = useCallback(() => {
    if (creatingAdmin) return
    setIsAddModalOpen(false)
    setNewEmail('')
    setNewPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setFormErrors({})
  }, [creatingAdmin])

  useEffect(() => {
    if (!isAnyModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deactivatingAdmin && !submittingStatus) {
          setDeactivatingAdmin(null)
          setStatusReason('')
        } else if (reactivatingAdmin && !submittingStatus) {
          setReactivatingAdmin(null)
          setStatusReason('')
        } else if (viewingAdmin) {
          setViewingAdmin(null)
        } else if (isAddModalOpen) {
          closeAddModal()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isAnyModalOpen,
    deactivatingAdmin,
    reactivatingAdmin,
    viewingAdmin,
    isAddModalOpen,
    submittingStatus,
    closeAddModal,
  ])

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const q = searchQuery.toLowerCase().trim()
      const matchesSearch =
        !q ||
        acc.fullName.toLowerCase().includes(q) ||
        acc.email.toLowerCase().includes(q) ||
        acc.id.toLowerCase().includes(q)

      const matchesRole = roleFilter === 'all' || acc.role === roleFilter
      const matchesStatus = statusFilter === 'all' || acc.status === statusFilter

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [accounts, searchQuery, roleFilter, statusFilter])

  const activeCount = useMemo(() => accounts.filter((a) => a.status === 'active').length, [accounts])
  const superAdminCount = useMemo(() => accounts.filter((a) => isProtectedSuperAdmin(a)).length, [accounts])
  const standardAdminCount = accounts.length - superAdminCount

  const handleAddAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors: typeof formErrors = {}
    const cleanEmail = newEmail.trim().toLowerCase()

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      errors.email = 'Please enter a valid administrator email address.'
    }

    const pwError = validateNewAdminPassword(newPassword)
    if (pwError) {
      errors.password = pwError
    }

    if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Password confirmation does not match.'
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    // If the email already exists in the synced live directory, refresh from backend
    // and inform the user clearly instead of leaving them uncertain.
    const existingAccount = accounts.find((a) => a.email.toLowerCase() === cleanEmail)
    if (existingAccount) {
      await loadAccountsFromBackend()
      setFormErrors({
        email: `An administrator account for "${cleanEmail}" already exists (${existingAccount.status === 'active' ? 'Active' : 'Inactive'}). The directory has been refreshed.`,
      })
      return
    }

    setCreatingAdmin(true)
    setFormErrors({})

    const result = await createDeveloperAdminAccount({
      email: cleanEmail,
      password: newPassword,
    })

    setCreatingAdmin(false)

    if (result.ok && result.admin) {
      const createdAccount = mapBackendAdminToAccount(result.admin)
      setAccounts((prev) =>
        prev.some((a) => a.id === createdAccount.id || a.email === createdAccount.email)
          ? prev.map((a) => (a.id === createdAccount.id ? createdAccount : a))
          : [...prev, createdAccount],
      )
      setNewEmail('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setIsAddModalOpen(false)
      setSearchQuery('')
      setRoleFilter('all')
      setStatusFilter('all')
      setNotification({
        message: `Administrator "${result.admin.email}" created in Supabase with role "admin".`,
        type: 'success',
      })
      await loadAccountsFromBackend(true)
    } else if (result.isDuplicate) {
      // Backend confirmed 409 Conflict: refresh live directory immediately so the existing account is visible.
      await loadAccountsFromBackend(true)
      setSearchQuery('')
      setRoleFilter('all')
      setStatusFilter('all')
      setFormErrors({
        email: `An administrator account for "${cleanEmail}" already exists in Supabase. The administrator list has been refreshed so you can view or manage it.`,
      })
      setNotification({
        message: `"${cleanEmail}" already exists in Supabase. Refreshed administrator directory.`,
        type: 'error',
      })
    } else {
      setFormErrors({
        submit: result.error || 'Failed to create administrator account.',
      })
    }
  }

  const handleStartDeactivate = (acc: AdminAccount) => {
    if (isProtectedSuperAdmin(acc)) {
      setNotification({
        message: 'The primary Super Admin account cannot be deactivated.',
        type: 'error',
      })
      return
    }
    setStatusReason('')
    setDeactivatingAdmin(acc)
  }

  const handleStartReactivate = (acc: AdminAccount) => {
    setStatusReason('')
    setReactivatingAdmin(acc)
  }

  const handleConfirmDeactivate = async () => {
    if (!deactivatingAdmin) return
    setSubmittingStatus(true)
    const target = deactivatingAdmin
    const res = await updateAdminAccountStatus(
      target.id,
      'inactive',
      statusReason.trim() || 'Deactivated by Super Admin',
    )
    setSubmittingStatus(false)

    if (res.ok) {
      setDeactivatingAdmin(null)
      setStatusReason('')
      if (viewingAdmin?.id === target.id) {
        setViewingAdmin({ ...viewingAdmin, status: 'inactive' })
      }
      setNotification({
        message: `Administrator ${target.email} deactivated. All active sessions have been revoked.`,
        type: 'success',
      })
      await loadAccountsFromBackend(true)
    } else {
      setNotification({
        message: res.error || 'Failed to deactivate administrator account.',
        type: 'error',
      })
    }
  }

  const handleConfirmReactivate = async () => {
    if (!reactivatingAdmin) return
    setSubmittingStatus(true)
    const target = reactivatingAdmin
    const res = await updateAdminAccountStatus(
      target.id,
      'active',
      statusReason.trim() || 'Reactivated by Super Admin',
    )
    setSubmittingStatus(false)

    if (res.ok) {
      setReactivatingAdmin(null)
      setStatusReason('')
      if (viewingAdmin?.id === target.id) {
        setViewingAdmin({ ...viewingAdmin, status: 'active' })
      }
      setNotification({
        message: `Administrator ${target.email} reactivated. They can now sign in with a fresh session.`,
        type: 'success',
      })
      await loadAccountsFromBackend(true)
    } else {
      setNotification({
        message: res.error || 'Failed to reactivate administrator account.',
        type: 'error',
      })
    }
  }

  const closeEditModal = useCallback(() => {
    if (updatingAdmin) return
    setEditingAdmin(null)
    setEditEmail('')
    setEditPassword('')
    setEditConfirmPassword('')
    setEditReason('')
    setShowEditPassword(false)
    setEditErrors({})
  }, [updatingAdmin])

  const handleStartEdit = (acc: AdminAccount) => {
    if (isProtectedSuperAdmin(acc)) {
      setNotification({
        message: 'The primary Super Admin account cannot be modified.',
        type: 'error',
      })
      return
    }
    setEditingAdmin(acc)
    setEditEmail(acc.email)
    setEditPassword('')
    setEditConfirmPassword('')
    setEditReason('')
    setShowEditPassword(false)
    setEditErrors({})
  }

  const handleEditAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAdmin) return

    const errors: typeof editErrors = {}
    const cleanEmail = editEmail.trim().toLowerCase()

    if (!cleanEmail) {
      errors.email = 'Email address is required.'
    } else if (!EMAIL_REGEX.test(cleanEmail)) {
      errors.email = 'Please enter a valid email address.'
    }

    if (editPassword.trim()) {
      const pwdErr = validateNewAdminPassword(editPassword)
      if (pwdErr) {
        errors.password = pwdErr
      } else if (editPassword !== editConfirmPassword) {
        errors.confirmPassword = 'Passwords do not match.'
      }
    }

    if (Object.keys(errors).length > 0) {
      setEditErrors(errors)
      return
    }

    setUpdatingAdmin(true)
    const emailChanged = cleanEmail !== editingAdmin.email.toLowerCase()
    const passwordChanged = Boolean(editPassword.trim())

    const res = await updateSuperadminAdmin(editingAdmin.id, {
      email: emailChanged ? cleanEmail : undefined,
      password: passwordChanged ? editPassword.trim() : undefined,
      reason: editReason.trim() || 'Updated by Super Admin',
    })
    setUpdatingAdmin(false)

    if (res.ok) {
      setEditingAdmin(null)
      setNotification({
        message: `Administrator ${cleanEmail} updated successfully.${
          emailChanged || passwordChanged ? ' Active sessions revoked.' : ''
        }`,
        type: 'success',
      })
      await loadAccountsFromBackend(true)
    } else if (res.isDuplicate) {
      await loadAccountsFromBackend(true)
      setEditErrors({
        email: `An administrator account for "${cleanEmail}" already exists in Supabase.`,
      })
      setNotification({
        message: `"${cleanEmail}" already exists in Supabase.`,
        type: 'error',
      })
    } else {
      setEditErrors({
        submit: res.error || 'Failed to update administrator account.',
      })
    }
  }

  const handleStartDelete = (acc: AdminAccount) => {
    if (isProtectedSuperAdmin(acc)) {
      setNotification({
        message: 'The primary Super Admin account cannot be deleted.',
        type: 'error',
      })
      return
    }
    setDeletingAdmin(acc)
    setDeleteReason('')
  }

  const handleConfirmDelete = async () => {
    if (!deletingAdmin) return
    setDeletingAdminLoading(true)
    const target = deletingAdmin
    const res = await deleteSuperadminAdmin(
      target.id,
      deleteReason.trim() || 'Deleted by Super Admin',
    )
    setDeletingAdminLoading(false)

    if (res.ok) {
      const targetEmail = target.email
      setDeletingAdmin(null)
      setDeleteReason('')
      if (viewingAdmin?.id === target.id) {
        setViewingAdmin(null)
      }
      setNotification({
        message: `Administrator ${targetEmail} deleted successfully. All active sessions have been revoked.`,
        type: 'success',
      })
      await loadAccountsFromBackend(true)
    } else {
      setNotification({
        message: res.error || 'Failed to delete administrator account.',
        type: 'error',
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
      description="Provision and govern database-backed platform administrators authenticated with Argon2id and server-side sessions."
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
              <span>
                {loading && accounts.length === 0
                  ? 'Loading Platform Administrators...'
                  : `${accounts.length} Database-Backed Administrator${accounts.length === 1 ? '' : 's'}`}
              </span>
              <span className="sa-scope-badge">
                <span className="sa-scope-badge__dot" />
                LIVE SUPABASE AUTH
              </span>
            </h2>
            <div className="sa-banner-sub">
              {activeCount} active · {superAdminCount} Super Admin · {standardAdminCount} standard Admin{standardAdminCount === 1 ? '' : 's'}. All credentials are hashed server-side with Argon2id.
            </div>
          </div>
        </div>

        <div className="sa-banner-actions">
          <button
            type="button"
            className="dash-filter-btn"
            onClick={() => void loadAccountsFromBackend(true)}
            disabled={loading}
            title="Refresh administrator accounts from Supabase"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            className="dash-primary-btn"
            onClick={() => {
              setFormErrors({})
              setIsAddModalOpen(true)
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <UserPlus size={15} />
            <span>Add Administrator</span>
          </button>
        </div>
      </div>

      {/* Backend Load Error Banner */}
      {loadError && (
        <div
          className="sa-demo-banner"
          role="alert"
          style={{ borderColor: 'rgba(239, 68, 68, 0.45)', background: 'rgba(127, 29, 29, 0.2)' }}
        >
          <AlertCircle size={18} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Unable to load administrator directory:</strong> {loadError}
          </div>
        </div>
      )}

      {/* ── 2. Search & Filter Bar ────────────────────────── */}
      <div className="sa-filter-bar">
        <div className="sa-search-wrap">
          <Search size={15} className="sa-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search by administrator name, email, or account ID..."
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

        <select
          className="sa-select"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by Role"
        >
          <option value="all">All Roles ({accounts.length})</option>
          <option value="super_admin">Super Admin ({superAdminCount})</option>
          <option value="admin">Admin ({standardAdminCount})</option>
        </select>

        <select
          className="sa-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by Status"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>

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

      {/* ── 3. Live Admin Accounts Table ──────────────────── */}
      <div className="sa-table-container">
        <table className="sa-table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>Administrator</th>
              <th style={{ width: '25%' }}>Email</th>
              <th style={{ width: '14%' }}>Role</th>
              <th style={{ width: '11%' }}>Status</th>
              <th style={{ width: '12%' }}>Created</th>
              <th style={{ width: '13%' }}>Last Login</th>
              <th style={{ width: '110px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && accounts.length === 0 ? (
              [1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="sa-skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                      <div className="sa-skeleton sa-skeleton--text" style={{ width: 110, height: 14 }} />
                    </div>
                  </td>
                  <td><div className="sa-skeleton sa-skeleton--text" style={{ width: 140, height: 14 }} /></td>
                  <td><div className="sa-skeleton sa-skeleton--chip" style={{ width: 90 }} /></td>
                  <td><div className="sa-skeleton sa-skeleton--chip" style={{ width: 65 }} /></td>
                  <td><div className="sa-skeleton sa-skeleton--text" style={{ width: 80, height: 12 }} /></td>
                  <td><div className="sa-skeleton sa-skeleton--text" style={{ width: 75, height: 12 }} /></td>
                  <td style={{ textAlign: 'right' }}><div className="sa-skeleton" style={{ width: 64, height: 26, borderRadius: 6, display: 'inline-block' }} /></td>
                </tr>
              ))
            ) : filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--ink-3)' }}>
                  <Users size={32} style={{ margin: '0 auto 10px', opacity: 0.4, display: 'block' }} />
                  <div>
                    {accounts.length === 0
                      ? 'No administrator accounts loaded.'
                      : 'No administrators match your active filter criteria.'}
                  </div>
                  {(searchQuery || roleFilter !== 'all' || statusFilter !== 'all') && (
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
                  )}
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc) => {
                const roleMeta = getAdminRoleMeta(acc.role)
                const isProtected = isProtectedSuperAdmin(acc)
                return (
                  <tr key={acc.id} className={acc.status === 'inactive' ? 'sa-row--inactive' : ''}>
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

                    <td>
                      <div className="sa-email-cell">
                        <span className="sa-email-text">{acc.email}</span>
                      </div>
                    </td>

                    <td>
                      <span className={`sa-role-pill sa-role-pill--${acc.role}`}>
                        {roleMeta.title}
                      </span>
                    </td>

                    <td>
                      <span className={`sa-status-pill sa-status-pill--${acc.status}`}>
                        <span className="sa-status-pill__dot" />
                        {acc.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td>
                      <span className="sa-date-text">{formatProvisionedDate(acc.createdAt)}</span>
                    </td>

                    <td>
                      <span
                        className="sa-date-text"
                        style={{ color: acc.status === 'active' ? '#50e396' : '#94a3b8' }}
                      >
                        {acc.lastActiveAt}
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div className="sa-action-group">
                        <button
                          type="button"
                          className="sa-action-btn"
                          title="View administrator details"
                          onClick={() => setViewingAdmin(acc)}
                          aria-label={`View details for ${acc.email}`}
                        >
                          <Eye size={14} />
                        </button>

                        <button
                          type="button"
                          className="sa-action-btn"
                          title={
                            isProtected
                              ? 'Primary Super Admin account details cannot be modified'
                              : 'Edit administrator details'
                          }
                          disabled={isProtected}
                          onClick={() => handleStartEdit(acc)}
                          aria-label={`Edit ${acc.email}`}
                        >
                          <Pencil size={14} />
                        </button>

                        {acc.status === 'active' ? (
                          <button
                            type="button"
                            className="sa-action-btn sa-action-btn--warning"
                            title={
                              isProtected
                                ? 'Primary Super Admin cannot be deactivated'
                                : 'Deactivate administrator account and revoke all active sessions'
                            }
                            disabled={isProtected}
                            onClick={() => handleStartDeactivate(acc)}
                            aria-label={`Deactivate ${acc.email}`}
                          >
                            <UserX size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sa-action-btn sa-action-btn--success"
                            title="Reactivate administrator account"
                            disabled={isProtected}
                            onClick={() => handleStartReactivate(acc)}
                            aria-label={`Reactivate ${acc.email}`}
                          >
                            <UserCheck size={14} />
                          </button>
                        )}

                        <button
                          type="button"
                          className="sa-action-btn sa-action-btn--danger"
                          title={
                            isProtected
                              ? 'Primary Super Admin cannot be deleted'
                              : 'Delete administrator account permanently'
                          }
                          disabled={isProtected}
                          onClick={() => handleStartDelete(acc)}
                          aria-label={`Delete ${acc.email}`}
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

      {/* ── 4. Add Administrator Modal (POST /api/superadmin/admins) ── */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="sa-modal-overlay" onClick={closeAddModal}>
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
                      Creates a real database-backed Admin account in Supabase.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={closeAddModal}
                  disabled={creatingAdmin}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddAdminSubmit} className="sa-modal-form">
                <div className="sa-modal-body">
                  {formErrors.submit && (
                    <div className="sa-confirm-box sa-confirm-box--danger">
                      <strong>Creation Failed</strong>
                      <div>{formErrors.submit}</div>
                    </div>
                  )}

                  {/* Email */}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-new-admin-email">
                      <span>Administrator Email</span>
                      <span style={{ color: '#50e396' }}>*</span>
                    </label>
                    <input
                      id="sa-new-admin-email"
                      type="email"
                      required
                      className="sa-form-input"
                      placeholder="developer@inferxe.com"
                      value={newEmail}
                      onChange={(e) => {
                        setNewEmail(e.target.value)
                        if (formErrors.email) setFormErrors({ ...formErrors, email: undefined })
                      }}
                    />
                    {formErrors.email && <span className="sa-form-error">{formErrors.email}</span>}
                  </div>

                  {/* Password */}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-new-admin-password">
                      <span>Initial Password</span>
                      <span style={{ color: '#50e396' }}>*</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="sa-new-admin-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        className="sa-form-input"
                        style={{ paddingRight: 40 }}
                        placeholder="Minimum 12 characters with upper, lower, number, symbol"
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value)
                          if (formErrors.password) setFormErrors({ ...formErrors, password: undefined })
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <span className="sa-form-hint">
                      12–128 characters, including uppercase, lowercase, digit, and special character.
                    </span>
                    {formErrors.password && <span className="sa-form-error">{formErrors.password}</span>}
                  </div>

                  {/* Confirm Password */}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-new-admin-confirm-password">
                      <span>Confirm Password</span>
                      <span style={{ color: '#50e396' }}>*</span>
                    </label>
                    <input
                      id="sa-new-admin-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      className="sa-form-input"
                      placeholder="Re-enter initial password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)
                        if (formErrors.confirmPassword) {
                          setFormErrors({ ...formErrors, confirmPassword: undefined })
                        }
                      }}
                    />
                    {formErrors.confirmPassword && (
                      <span className="sa-form-error">{formErrors.confirmPassword}</span>
                    )}
                  </div>

                  {/* Assigned Role (Strictly locked to standard Admin) */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">Assigned Role</label>
                    <div
                      className="sa-form-input"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        opacity: 0.9,
                        cursor: 'not-allowed',
                      }}
                    >
                      <span>Admin (Standard Platform Administrator)</span>
                      <span className="sa-role-pill sa-role-pill--admin" style={{ fontSize: '0.7rem' }}>
                        role = admin
                      </span>
                    </div>
                    <span className="sa-form-hint">
                      Additional Super Admin accounts cannot be created. Standard Admins have operational console access and cannot access Super Admin routes.
                    </span>
                  </div>

                  {/* Security Notice */}
                  <div className="sa-security-notice">
                    <Lock size={18} style={{ color: '#50e396', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong>Server-Side Argon2id Provisioning:</strong>
                      <div>
                        The password is transmitted over the authenticated Super Admin channel, hashed server-side with Argon2id, never stored in plaintext, and never returned in API responses.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-filter-btn"
                    onClick={closeAddModal}
                    disabled={creatingAdmin}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dash-primary-btn"
                    disabled={creatingAdmin}
                  >
                    {creatingAdmin ? 'Creating Account...' : 'Create Administrator'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 5. View Administrator Details Drawer ───────────── */}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="sa-detail-field">
                    <span className="sa-detail-label">Account ID</span>
                    <span className="sa-detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', wordBreak: 'break-all' }}>
                      {viewingAdmin.id}
                    </span>
                  </div>
                  <div className="sa-detail-field">
                    <span className="sa-detail-label">Role</span>
                    <span className={`sa-role-pill sa-role-pill--${viewingAdmin.role}`}>
                      {getAdminRoleMeta(viewingAdmin.role).title}
                    </span>
                  </div>
                  <div className="sa-detail-field">
                    <span className="sa-detail-label">Status</span>
                    <span className={`sa-status-pill sa-status-pill--${viewingAdmin.status}`}>
                      <span className="sa-status-pill__dot" />
                      {viewingAdmin.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="sa-detail-field">
                    <span className="sa-detail-label">Session Version</span>
                    <span className="sa-detail-value">v{viewingAdmin.sessionVersion ?? 1}</span>
                  </div>
                  <div className="sa-detail-field">
                    <span className="sa-detail-label">Provisioned</span>
                    <span className="sa-detail-value">{formatProvisionedDate(viewingAdmin.createdAt)}</span>
                  </div>
                  <div className="sa-detail-field">
                    <span className="sa-detail-label">Last Login</span>
                    <span className="sa-detail-value">{viewingAdmin.lastActiveAt}</span>
                  </div>
                </div>

                {isProtectedSuperAdmin(viewingAdmin) && (
                  <div className="sa-security-notice" style={{ marginTop: 12 }}>
                    <ShieldCheck size={18} style={{ color: '#50e396', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong>Protected Super Admin Identity:</strong>
                      <div>
                        This account holds primary platform governance authority and cannot be deactivated or removed through the Admin Accounts UI.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  onClick={() => setViewingAdmin(null)}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 6. Deactivate Confirmation Modal ──────────────── */}
      <AnimatePresence>
        {deactivatingAdmin && (
          <div
            className="sa-modal-overlay"
            onClick={() => {
              if (!submittingStatus) {
                setDeactivatingAdmin(null)
                setStatusReason('')
              }
            }}
          >
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
                  <div className="sa-modal-icon-wrap--warning">
                    <UserX size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Deactivate Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#fbbf24' }}>
                      Immediately revokes all active database sessions
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  disabled={submittingStatus}
                  onClick={() => {
                    setDeactivatingAdmin(null)
                    setStatusReason('')
                  }}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                <div className="sa-confirm-box sa-confirm-box--warning">
                  <div>
                    Are you sure you want to deactivate <strong>{deactivatingAdmin.email}</strong>?
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#fef3c7' }}>
                    Deactivation sets <code>is_active = false</code>, increments <code>session_version</code>, revokes all active rows in <code>admin_sessions</code>, and blocks further sign-in across both Node.js and Python services.
                  </div>
                </div>

                <div className="sa-form-group" style={{ marginTop: 12 }}>
                  <label className="sa-form-label" htmlFor="sa-deactivate-reason">
                    Reason for Audit Log (Optional)
                  </label>
                  <input
                    id="sa-deactivate-reason"
                    type="text"
                    className="sa-form-input"
                    placeholder="e.g. Offboarding / temporary access suspension"
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                  />
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  disabled={submittingStatus}
                  onClick={() => {
                    setDeactivatingAdmin(null)
                    setStatusReason('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-warning-btn"
                  disabled={submittingStatus}
                  onClick={() => void handleConfirmDeactivate()}
                >
                  <UserX size={14} />
                  <span>{submittingStatus ? 'Deactivating...' : 'Deactivate Account'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 7. Reactivate Confirmation Modal ──────────────── */}
      <AnimatePresence>
        {reactivatingAdmin && (
          <div
            className="sa-modal-overlay"
            onClick={() => {
              if (!submittingStatus) {
                setReactivatingAdmin(null)
                setStatusReason('')
              }
            }}
          >
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
                    <h3 className="sa-modal-title">Reactivate Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#50e396' }}>
                      Restore standard Admin sign-in access
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  disabled={submittingStatus}
                  onClick={() => {
                    setReactivatingAdmin(null)
                    setStatusReason('')
                  }}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                <div style={{ fontSize: '0.84rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                  Reactivating <strong>{reactivatingAdmin.email}</strong> sets <code>is_active = true</code> so they can sign in with a new session. Previously revoked sessions remain permanently invalid.
                </div>

                <div className="sa-form-group" style={{ marginTop: 12 }}>
                  <label className="sa-form-label" htmlFor="sa-reactivate-reason">
                    Reason for Audit Log (Optional)
                  </label>
                  <input
                    id="sa-reactivate-reason"
                    type="text"
                    className="sa-form-input"
                    placeholder="e.g. Access restored after review"
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                  />
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  disabled={submittingStatus}
                  onClick={() => {
                    setReactivatingAdmin(null)
                    setStatusReason('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-primary-btn"
                  disabled={submittingStatus}
                  onClick={() => void handleConfirmReactivate()}
                >
                  <UserCheck size={14} />
                  <span>{submittingStatus ? 'Reactivating...' : 'Reactivate Account'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 8. Edit Administrator Modal (PATCH /api/superadmin/admins/:id) ── */}
      <AnimatePresence>
        {editingAdmin && (
          <div className="sa-modal-overlay" onClick={closeEditModal}>
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
                    <Pencil size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Edit Platform Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      Update email, rotate password, or document changes with audit logging.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  onClick={closeEditModal}
                  disabled={updatingAdmin}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleEditAdminSubmit} className="sa-modal-form">
                <div className="sa-modal-body">
                  {editErrors.submit && (
                    <div className="sa-confirm-box sa-confirm-box--danger">
                      <strong>Update Failed</strong>
                      <div>{editErrors.submit}</div>
                    </div>
                  )}

                  {/* Email */}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-edit-admin-email">
                      <span>Administrator Email</span>
                      <span style={{ color: '#50e396' }}>*</span>
                    </label>
                    <input
                      id="sa-edit-admin-email"
                      type="email"
                      required
                      className="sa-form-input"
                      value={editEmail}
                      onChange={(e) => {
                        setEditEmail(e.target.value)
                        if (editErrors.email) setEditErrors({ ...editErrors, email: undefined })
                      }}
                    />
                    {editErrors.email && <span className="sa-form-error">{editErrors.email}</span>}
                  </div>

                  {/* Optional Password Reset */}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-edit-admin-password">
                      <span>Reset Password (Optional)</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="sa-edit-admin-password"
                        type={showEditPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="sa-form-input"
                        style={{ paddingRight: 40 }}
                        placeholder="Leave blank to keep existing password"
                        value={editPassword}
                        onChange={(e) => {
                          setEditPassword(e.target.value)
                          if (editErrors.password) setEditErrors({ ...editErrors, password: undefined })
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditPassword((prev) => !prev)}
                        aria-label={showEditPassword ? 'Hide password' : 'Show password'}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: 4,
                        }}
                      >
                        {showEditPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {editErrors.password && (
                      <span className="sa-form-error">{editErrors.password}</span>
                    )}
                  </div>

                  {/* Confirm Password (only shown if reset password entered) */}
                  {editPassword.trim().length > 0 && (
                    <div className="sa-form-group">
                      <label className="sa-form-label" htmlFor="sa-edit-confirm-password">
                        <span>Confirm Reset Password</span>
                        <span style={{ color: '#50e396' }}>*</span>
                      </label>
                      <input
                        id="sa-edit-confirm-password"
                        type={showEditPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="sa-form-input"
                        placeholder="Re-enter new password"
                        value={editConfirmPassword}
                        onChange={(e) => {
                          setEditConfirmPassword(e.target.value)
                          if (editErrors.confirmPassword) {
                            setEditErrors({ ...editErrors, confirmPassword: undefined })
                          }
                        }}
                      />
                      {editErrors.confirmPassword && (
                        <span className="sa-form-error">{editErrors.confirmPassword}</span>
                      )}
                    </div>
                  )}

                  {/* Audit Reason */}
                  <div className="sa-form-group">
                    <label className="sa-form-label" htmlFor="sa-edit-reason">
                      <span>Reason for Audit Log (Optional)</span>
                    </label>
                    <input
                      id="sa-edit-reason"
                      type="text"
                      className="sa-form-input"
                      placeholder="e.g. Email correction, periodic credential rotation"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                    />
                  </div>

                  {/* Assigned Role (Strictly locked to standard Admin) */}
                  <div className="sa-form-group">
                    <label className="sa-form-label">Assigned Role</label>
                    <div
                      className="sa-form-input"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        opacity: 0.9,
                        cursor: 'not-allowed',
                      }}
                    >
                      <span>Admin (Standard Platform Administrator)</span>
                      <span className="sa-role-pill sa-role-pill--admin" style={{ fontSize: '0.7rem' }}>
                        role = admin
                      </span>
                    </div>
                    <span className="sa-form-hint">
                      Role promotion to Super Admin is strictly prohibited. Administrator accounts maintain separated operational privileges.
                    </span>
                  </div>

                  {/* Security Notice */}
                  <div className="sa-security-notice">
                    <Lock size={18} style={{ color: '#50e396', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong>Automatic Session Revocation:</strong>
                      <div>
                        Updating credentials immediately increments the administrator's session version and revokes all active sessions.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sa-modal-footer">
                  <button
                    type="button"
                    className="dash-filter-btn"
                    onClick={closeEditModal}
                    disabled={updatingAdmin}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dash-primary-btn"
                    disabled={updatingAdmin}
                  >
                    {updatingAdmin ? 'Saving Changes...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 9. Delete Administrator Modal (DELETE /api/superadmin/admins/:id) ── */}
      <AnimatePresence>
        {deletingAdmin && (
          <div
            className="sa-modal-overlay"
            onClick={() => {
              if (!deletingAdminLoading) {
                setDeletingAdmin(null)
                setDeleteReason('')
              }
            }}
          >
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
                  <div className="sa-modal-icon-wrap--danger">
                    <Trash2 size={18} />
                  </div>
                  <div>
                    <h3 className="sa-modal-title">Delete Administrator</h3>
                    <div style={{ fontSize: '0.74rem', color: '#f87171' }}>
                      Permanent account removal and session revocation
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="sa-modal-close-btn"
                  disabled={deletingAdminLoading}
                  onClick={() => {
                    setDeletingAdmin(null)
                    setDeleteReason('')
                  }}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="sa-modal-body">
                <div className="sa-confirm-box sa-confirm-box--danger">
                  <strong>Permanent Removal Warning</strong>
                  <div>
                    Are you sure you want to delete administrator <strong>{deletingAdmin.email}</strong>? All active sessions will be terminated immediately. Audit history is permanently preserved.
                  </div>
                </div>

                <div className="sa-form-group" style={{ marginTop: 12 }}>
                  <label className="sa-form-label" htmlFor="sa-delete-reason">
                    Reason for Audit Log (Optional)
                  </label>
                  <input
                    id="sa-delete-reason"
                    type="text"
                    className="sa-form-input"
                    placeholder="e.g. Developer departure, role deprovisioning"
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                  />
                </div>
              </div>

              <div className="sa-modal-footer">
                <button
                  type="button"
                  className="dash-filter-btn"
                  disabled={deletingAdminLoading}
                  onClick={() => {
                    setDeletingAdmin(null)
                    setDeleteReason('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dash-warning-btn"
                  style={{ background: '#b91c1c', borderColor: '#ef4444' }}
                  disabled={deletingAdminLoading}
                  onClick={() => void handleConfirmDelete()}
                >
                  <Trash2 size={14} />
                  <span>{deletingAdminLoading ? 'Deleting...' : 'Delete Administrator'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}
