import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  UserCheck,
  UserX,
  UserPlus,
  ArrowLeft,
  Shield,
  Trash2,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  createDeveloperAdminAccount,
  deleteSuperadminAdmin,
  fetchSuperadminAdmins,
  updateAdminAccountStatus,
  type SuperadminAdminRecord,
} from '../../../lib/authStore'

export default function AdminManagement() {
  usePageMeta(
    'Admin Management · Inferxe Superadmin Governance',
    'Manage platform administrators, approve accounts, view login timestamps, and suspend access privileges.',
  )

  const [admins, setAdmins] = useState<SuperadminAdminRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'inactive'>('all')

  // Status Action Modal State
  const [actionTarget, setActionTarget] = useState<SuperadminAdminRecord | null>(null)
  const [actionType, setActionType] = useState<'active' | 'suspended' | 'inactive' | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)

  // Delete Admin State
  const [deletingAdmin, setDeletingAdmin] = useState<SuperadminAdminRecord | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [submittingDelete, setSubmittingDelete] = useState(false)

  // Create Developer Admin Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingAdmin, setCreatingAdmin] = useState(false)

  const loadAdmins = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchSuperadminAdmins()
      if (res.ok && res.admins) {
        setAdmins(res.admins)
      } else {
        setError(res.error || 'Failed to load administrator accounts.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error retrieving admin directory.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAdmins()
  }, [])

  const handleConfirmStatusChange = async () => {
    if (!actionTarget || !actionType) return
    setSubmittingAction(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const res = await updateAdminAccountStatus(actionTarget.id, actionType, actionReason)
      if (res.ok) {
        setSuccessMsg(
          `Administrator ${actionTarget.email} status has been updated to "${actionType}".`,
        )
        setActionTarget(null)
        setActionType(null)
        setActionReason('')
        await loadAdmins()
      } else {
        setError(res.error || 'Failed to update admin status.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while updating status.')
    } finally {
      setSubmittingAction(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingAdmin) return
    setSubmittingDelete(true)
    setError(null)
    const target = deletingAdmin
    const res = await deleteSuperadminAdmin(target.id, deleteReason.trim() || 'Deleted by Super Admin')
    setSubmittingDelete(false)

    if (res.ok) {
      setSuccessMsg(`Administrator ${target.email} was deleted successfully and all active sessions revoked.`)
      setDeletingAdmin(null)
      setDeleteReason('')
      await loadAdmins()
    } else {
      setError(res.error || 'Failed to delete administrator.')
    }
  }

  const handleCreateDeveloperAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setError(null)
    setSuccessMsg(null)

    const cleanEmail = newAdminEmail.trim().toLowerCase()
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setCreateError('Please enter a valid administrator email address.')
      return
    }
    if (newAdminPassword.length < 12) {
      setCreateError('Password must be at least 12 characters with upper, lower, digit, and symbol.')
      return
    }
    if (newAdminPassword !== confirmAdminPassword) {
      setCreateError('Password confirmation does not match.')
      return
    }

    setCreatingAdmin(true)
    try {
      const res = await createDeveloperAdminAccount({
        email: cleanEmail,
        password: newAdminPassword,
      })
      if (res.ok && res.admin) {
        setSuccessMsg(
          `Administrator account "${res.admin.email}" has been created with role "admin".`,
        )
        setIsCreateModalOpen(false)
        setNewAdminEmail('')
        setNewAdminPassword('')
        setConfirmAdminPassword('')
        await loadAdmins()
      } else if (res.isDuplicate) {
        await loadAdmins()
        setCreateError(
          `An administrator account for "${cleanEmail}" already exists in Supabase. The administrator directory has been refreshed.`,
        )
      } else {
        setCreateError(res.error || 'Unable to create administrator account.')
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create administrator account.')
    } finally {
      setCreatingAdmin(false)
    }
  }

  const filteredAdmins = admins.filter((adm) => {
    const matchesSearch =
      adm.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      adm.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    if (statusFilter === 'all') return matchesSearch
    return matchesSearch && adm.status === statusFilter
  })

  return (
    <DashboardLayout
      pageTitle="Admin Directory & Access Governance"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/superadmin' },
        { label: 'Admin Directory' },
      ]}
    >
      <div style={{ maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {/* ── Top Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Link
                to="/dashboard/superadmin"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'var(--cx-text-3)',
                  fontSize: '0.78rem',
                  textDecoration: 'none',
                }}
              >
                <ArrowLeft size={13} /> Back to Overview
              </Link>
            </div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: 'var(--cx-text)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              Administrator Accounts Directory
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--cx-text-3)', fontSize: '0.84rem' }}>
              View and govern all platform administrators. Suspend or restore authorization privileges with audit logging.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => {
                setCreateError(null)
                setIsCreateModalOpen(true)
              }}
              style={{
                background: 'linear-gradient(135deg, var(--cx-accent-2), var(--cx-accent))',
                border: '1px solid transparent',
                color: 'var(--cx-accent-ink)',
                boxShadow: '0 12px 28px -14px var(--cx-accent-glow), 0 1px 0 rgba(255, 255, 255, 0.4) inset',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <UserPlus size={14} />
              <span>Create Admin Account</span>
            </button>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadAdmins()}
              disabled={loading}
              style={{
                background: 'var(--cx-surface)',
                border: '1px solid var(--cx-border)',
                color: 'var(--cx-text-2)',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>Refresh Directory</span>
            </button>
          </div>
        </div>

        {/* ── Feedback Banners ── */}
        {error && (
          <div
            style={{
              background: 'var(--cx-danger-soft)',
              border: '1px solid color-mix(in srgb, var(--cx-danger) 30%, transparent)',
              borderRadius: '8px',
              padding: '12px 16px',
              color: 'var(--cx-danger)',
              fontSize: '0.85rem',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div
            style={{
              background: 'var(--cx-accent-soft)',
              border: '1px solid var(--cx-accent)',
              borderRadius: '8px',
              padding: '12px 16px',
              color: 'var(--cx-accent)',
              fontSize: '0.85rem',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* ── Search & Filter Toolbar ── */}
        <div
          style={{
            background: 'var(--cx-card-a, var(--cx-panel))',
            border: '1px solid var(--cx-border)',
            borderRadius: '10px',
            padding: '14px 18px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {/* Search */}
          <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--cx-text-4)',
              }}
            />
            <input
              type="text"
              placeholder="Search admin name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--cx-surface)',
                border: '1px solid var(--cx-border-2)',
                borderRadius: '6px',
                padding: '8px 12px 8px 36px',
                color: 'var(--cx-text)',
                fontSize: '0.84rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Filter Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {(
              [
                { key: 'all', label: `All (${admins.length})` },
                {
                  key: 'active',
                  label: `Active (${admins.filter((a) => a.status === 'active').length})`,
                },
                {
                  key: 'suspended',
                  label: `Suspended (${admins.filter((a) => a.status === 'suspended').length})`,
                },
                {
                  key: 'inactive',
                  label: `Inactive (${admins.filter((a) => a.status === 'inactive').length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                style={{
                  background: statusFilter === tab.key ? 'var(--cx-accent)' : 'var(--cx-surface)',
                  color: statusFilter === tab.key ? 'var(--cx-accent-ink)' : 'var(--cx-text-2)',
                  border: `1px solid ${statusFilter === tab.key ? 'var(--cx-accent)' : 'var(--cx-border)'}`,
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Admins Table Card ── */}
        <div
          style={{
            background: 'var(--cx-card-a, var(--cx-panel))',
            border: '1px solid var(--cx-border)',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 4px 20px var(--cx-surface)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: 'var(--cx-surface)', borderBottom: '1px solid var(--cx-border)' }}>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Administrator
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Role
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Status
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Last Login & IP
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Activity Count
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>
                    Governance Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && admins.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: 'var(--cx-text-3)' }}>
                      <RefreshCw size={20} className="spin-icon" style={{ color: 'var(--cx-accent)', margin: '0 auto 8px' }} />
                      <div>Loading admin directory...</div>
                    </td>
                  </tr>
                ) : filteredAdmins.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: 'var(--cx-text-3)' }}>
                      <Users size={28} style={{ opacity: 0.4, margin: '0 auto 8px' }} />
                      <div style={{ color: 'var(--cx-text)', fontWeight: 600 }}>No administrators found</div>
                      <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                        Try clearing search terms or changing status filter.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAdmins.map((adm) => (
                    <tr
                      key={adm.id}
                      style={{
                        borderBottom: '1px solid var(--cx-border)',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              background: adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.15)' : 'var(--cx-surface-2)',
                              color: adm.role === 'superadmin' ? 'var(--cx-accent)' : 'var(--cx-accent)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              border: `1px solid ${adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.3)' : 'var(--cx-border)'}`,
                            }}
                          >
                            {adm.full_name
                              .split(' ')
                              .map((w) => w[0])
                              .join('')
                              .substring(0, 2)
                              .toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--cx-text)', fontSize: '0.88rem' }}>
                              {adm.full_name}
                            </div>
                            <div style={{ color: 'var(--cx-text-3)', fontSize: '0.76rem', fontFamily: 'var(--font-mono)' }}>
                              {adm.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <span
                          style={{
                            background:
                              adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                            color: adm.role === 'superadmin' ? 'var(--cx-accent)' : 'var(--cx-info)',
                            border: `1px solid ${adm.role === 'superadmin' ? 'rgba(0, 255, 136, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {adm.role === 'superadmin' ? 'Superadmin' : 'Admin'}
                        </span>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '3px 10px',
                            borderRadius: '20px',
                            background:
                              adm.status === 'active'
                                ? 'rgba(16, 185, 129, 0.12)'
                                : adm.status === 'suspended'
                                  ? 'rgba(239, 68, 68, 0.12)'
                                  : 'rgba(245, 158, 11, 0.12)',
                            color:
                              adm.status === 'active'
                                ? 'var(--cx-accent)'
                                : adm.status === 'suspended'
                                  ? 'var(--cx-danger)'
                                  : 'var(--cx-warn)',
                            border: `1px solid ${
                              adm.status === 'active'
                                ? 'rgba(16, 185, 129, 0.25)'
                                : adm.status === 'suspended'
                                  ? 'rgba(239, 68, 68, 0.25)'
                                  : 'rgba(245, 158, 11, 0.25)'
                            }`,
                            fontSize: '0.76rem',
                            fontWeight: 600,
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background:
                                adm.status === 'active'
                                  ? 'var(--cx-accent)'
                                  : adm.status === 'suspended'
                                    ? 'var(--cx-danger)'
                                    : 'var(--cx-warn)',
                            }}
                          />
                          {adm.status.charAt(0).toUpperCase() + adm.status.slice(1)}
                        </span>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ color: 'var(--cx-text-2)', fontSize: '0.8rem' }}>
                          {adm.last_login
                            ? new Date(adm.last_login).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Never'}
                        </div>
                        <div style={{ color: 'var(--cx-text-4)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                          IP: {adm.last_ip || '127.0.0.1'}
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px', color: 'var(--cx-text)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {adm.activity_count ?? 0} actions
                      </td>

                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        {/* Can not suspend self or another superadmin directly without special confirmation */}
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          {adm.status !== 'active' && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionTarget(adm)
                                setActionType('active')
                                setActionReason('Reactivated by Superadmin')
                              }}
                              style={{
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: 'var(--cx-accent)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '6px',
                                padding: '5px 10px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Approve / Activate
                            </button>
                          )}

                          {adm.status === 'active' && adm.role !== 'superadmin' && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionTarget(adm)
                                setActionType('suspended')
                                setActionReason('Administrative security review')
                              }}
                              style={{
                                background: 'rgba(239, 68, 68, 0.12)',
                                color: 'var(--cx-danger)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '6px',
                                padding: '5px 10px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Suspend
                            </button>
                          )}

                          {adm.role !== 'superadmin' && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingAdmin(adm)
                                setDeleteReason('')
                              }}
                              title="Delete administrator account"
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: 'var(--cx-danger)',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                borderRadius: '6px',
                                padding: '5px 8px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Trash2 size={12} />
                              <span>Delete</span>
                            </button>
                          )}

                          {adm.role === 'superadmin' && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--cx-text-4)', padding: '5px 0' }}>
                              Primary Superadmin
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Status Change Confirmation Modal ── */}
        {actionTarget && actionType && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--cx-overlay)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: 'var(--cx-card-a, var(--cx-panel))',
                border: '1px solid var(--cx-border)',
                borderRadius: '14px',
                width: '100%',
                maxWidth: '460px',
                padding: '24px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background:
                      actionType === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: actionType === 'active' ? 'var(--cx-accent)' : 'var(--cx-danger)',
                  }}
                >
                  {actionType === 'active' ? <UserCheck size={18} /> : <UserX size={18} />}
                </div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--cx-text)', fontSize: '1.1rem', fontWeight: 700 }}>
                    {actionType === 'active' ? 'Activate Admin Account' : 'Suspend Admin Account'}
                  </h3>
                  <div style={{ color: 'var(--cx-text-3)', fontSize: '0.78rem' }}>
                    {actionTarget.full_name} ({actionTarget.email})
                  </div>
                </div>
              </div>

              <p style={{ color: 'var(--cx-text-2)', fontSize: '0.84rem', margin: '0 0 16px', lineHeight: 1.5 }}>
                {actionType === 'suspended'
                  ? 'Suspending this administrator will immediately revoke their access to the Admin Portal, Customer Management, and backend API endpoints.'
                  : 'Activating this account will restore full administrator access to platform administration dashboards.'}
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--cx-text-3)', marginBottom: '6px' }}>
                  Reason for Audit Trail (Required)
                </label>
                <input
                  type="text"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="e.g. Completed quarterly review / Security precaution"
                  style={{
                    width: '100%',
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border-2)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--cx-text)',
                    fontSize: '0.82rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setActionTarget(null)
                    setActionType(null)
                  }}
                  disabled={submittingAction}
                  style={{
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border)',
                    color: 'var(--cx-text-2)',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmStatusChange}
                  disabled={submittingAction}
                  style={{
                    background: actionType === 'active' ? '#10B981' : '#EF4444',
                    border: 'none',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {submittingAction
                    ? 'Updating...'
                    : actionType === 'active'
                      ? 'Confirm Activation'
                      : 'Confirm Suspension'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete Administrator Confirmation Modal ── */}
        {deletingAdmin && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--cx-overlay)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '20px',
            }}
          >
            <div
              style={{
                background: 'var(--cx-card-a, var(--cx-panel))',
                border: '1px solid color-mix(in srgb, var(--cx-danger) 30%, transparent)',
                borderRadius: '14px',
                width: '100%',
                maxWidth: '460px',
                padding: '24px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--cx-danger)',
                  }}
                >
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--cx-text)', fontSize: '1.1rem', fontWeight: 700 }}>
                    Delete Admin Account
                  </h3>
                  <div style={{ color: 'var(--cx-danger)', fontSize: '0.78rem' }}>
                    {deletingAdmin.full_name} ({deletingAdmin.email})
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                  color: 'var(--cx-danger)',
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                }}
              >
                <strong>Permanent Deletion Warning:</strong> Deleting this administrator will revoke all active sessions immediately and permanently remove their user record from Supabase. Historical audit logs will remain preserved.
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--cx-text-3)', marginBottom: '6px' }}>
                  Reason for Audit Trail (Optional)
                </label>
                <input
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="e.g. Account offboarding / Departure"
                  style={{
                    width: '100%',
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border-2)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--cx-text)',
                    fontSize: '0.82rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setDeletingAdmin(null)
                    setDeleteReason('')
                  }}
                  disabled={submittingDelete}
                  style={{
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border)',
                    color: 'var(--cx-text-2)',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  disabled={submittingDelete}
                  style={{
                    background: '#DC2626',
                    border: 'none',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Trash2 size={14} />
                  <span>{submittingDelete ? 'Deleting...' : 'Delete Administrator'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Create Admin Account Modal (Role strictly 'admin') ── */}
        {isCreateModalOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--cx-overlay)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '20px',
            }}
          >
            <form
              onSubmit={handleCreateDeveloperAdmin}
              style={{
                background: 'var(--cx-card-a, var(--cx-panel))',
                border: '1px solid var(--cx-border)',
                borderRadius: '14px',
                width: '100%',
                maxWidth: '460px',
                padding: '24px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--cx-accent)',
                  }}
                >
                  <Shield size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--cx-text)', fontSize: '1.08rem', fontWeight: 700 }}>
                    Create Platform Administrator
                  </h3>
                  <div style={{ color: 'var(--cx-text-3)', fontSize: '0.78rem' }}>
                    Provisioned in Supabase with Argon2id hashing and role <strong style={{ color: 'var(--cx-accent)' }}>admin</strong>
                  </div>
                </div>
              </div>

              {createError && (
                <div
                  style={{
                    background: 'var(--cx-danger-soft)',
                    border: '1px solid color-mix(in srgb, var(--cx-danger) 30%, transparent)',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    color: 'var(--cx-danger)',
                    fontSize: '0.8rem',
                    marginBottom: '14px',
                  }}
                >
                  {createError}
                </div>
              )}

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--cx-text-3)', marginBottom: '6px' }}>
                  Administrator Email
                </label>
                <input
                  type="email"
                  required
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="admin.user@inferxe.com"
                  style={{
                    width: '100%',
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border-2)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--cx-text)',
                    fontSize: '0.84rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--cx-text-3)', marginBottom: '6px' }}>
                  Strong Password (min 12 chars, upper/lower/digit/symbol)
                </label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="Enter strong password"
                  style={{
                    width: '100%',
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border-2)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--cx-text)',
                    fontSize: '0.84rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--cx-text-3)', marginBottom: '6px' }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmAdminPassword}
                  onChange={(e) => setConfirmAdminPassword(e.target.value)}
                  placeholder="Re-enter password"
                  style={{
                    width: '100%',
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border-2)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--cx-text)',
                    fontSize: '0.84rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false)
                    setNewAdminEmail('')
                    setNewAdminPassword('')
                    setConfirmAdminPassword('')
                    setCreateError(null)
                  }}
                  disabled={creatingAdmin}
                  style={{
                    background: 'var(--cx-surface)',
                    border: '1px solid var(--cx-border)',
                    color: 'var(--cx-text-2)',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingAdmin}
                  style={{
                    background: 'var(--cx-accent)',
                    border: 'none',
                    color: 'var(--cx-text)',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {creatingAdmin ? 'Creating...' : 'Create Administrator'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
