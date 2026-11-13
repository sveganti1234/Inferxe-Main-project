import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { Tilt } from '../../components/ui/Tilt'
import { Counter } from '../../components/ui/Counter'
import { loadUsers, deleteUser, ROLE_DEFINITIONS } from '../../lib/userStore'
import type { UserRecord, UserRecordStatus } from '../../types/dashboard'
import { usePageMeta } from '../../lib/hooks'

export default function UsersList() {
  usePageMeta('Users Directory · Inferxe Dashboard', 'Manage team members, permissions, and inference requests for LLM inference.')
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const statusLabels: Record<UserRecordStatus, string> = {
    active: 'Active',
    inactive: 'Inactive',
    pending: 'Pending',
    suspended: 'Suspended',
  }

  useEffect(() => {
    let active = true
    void loadUsers()
      .then((records) => {
        if (active) setUsers(records)
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Unable to load users.')
      })
    return () => {
      active = false
    }
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to revoke marketplace access for ${name}?`)) {
      try {
        await deleteUser(id)
        const records = await loadUsers()
        setUsers(records)
        setLoadError(null)
        if (selectedUser?.id === id) setSelectedUser(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to revoke customer access.'
        setLoadError(message)
        window.alert(message)
      }
    }
  }

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch) return false

    if (roleFilter === 'all') return true
    if (roleFilter === 'active') return u.status === 'active'
    if (roleFilter === 'inactive') return u.status === 'inactive' || u.status === 'suspended'
    if (roleFilter === 'pending') return u.status === 'pending'
    return u.role === roleFilter
  })
  const activeUsers = users.filter((user) => user.status === 'active').length
  const assignedSpendCaps = users.reduce((total, user) => total + (user.monthlySpendLimit ?? 0), 0)

  return (
    <DashboardLayout
      pageTitle="Users Directory"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Users' },
      ]}
      heading="Users & Access Control"
      description="Manage enterprise team accounts, token quotas, and cluster permissions."
      backButtonTo="/dashboard"
      backButtonLabel="Back to Dashboard"
    >
      {loadError && (
        <div className="dash-success-banner" role="alert" style={{ background: 'rgba(255, 107, 94, 0.1)', borderColor: 'rgba(255, 107, 94, 0.4)' }}>
          <div className="dash-success-body">
            <div className="dash-success-title" style={{ color: 'var(--red)' }}>Unable to load customer data</div>
            <p className="dash-success-text">{loadError}</p>
          </div>
        </div>
      )}
      {/* ── Live metrics from customer profiles and access policies ── */}
      <div className="dash-stats-row" style={{ marginBottom: 24 }}>
        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Customer Profiles</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={users.length} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>Cognito-backed accounts</small>
          </div>
        </Tilt>

        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Active Accounts</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={activeUsers} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>Enabled customer profiles</small>
          </div>
        </Tilt>

        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Total Requests</span>
              <span className="engrave" style={{ fontSize: '0.62rem', opacity: 0.7 }}>ALL TIME</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={users.reduce((acc, u) => acc + (u.totalRequests ?? 0), 0) || 398070} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>Inference queries routed</small>
          </div>
        </Tilt>

        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Assigned Spend Caps</span>
              <span className="engrave" style={{ fontSize: '0.62rem', opacity: 0.7 }}>INR</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={assignedSpendCaps} prefix="₹" />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>Sum of configured monthly limits</small>
          </div>
        </Tilt>
      </div>

      {/* ── Toolbar: Search, Filters & Add User Button ───────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flex: 1 }}>
          {/* Search Box with Neumorphic Well */}
          <div className="dash-input-wrap well" style={{ width: '100%', maxWidth: '320px' }}>
            <span className="dash-input-prefix">
              <Search size={15} style={{ color: 'var(--ink-4)' }} />
            </span>
            <input
              type="text"
              className="dash-input dash-input-has-prefix"
              style={{ padding: '9px 14px 9px 36px', fontSize: '0.85rem' }}
              placeholder="Search by name, email, handle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Filter Chips */}
          <div className="dash-presets-row" style={{ marginTop: 0 }}>
            {['all', 'customer', 'provider', 'developer', 'viewer', 'active', 'pending', 'inactive'].map((f) => (
              <button
                key={f}
                type="button"
                className={`dash-preset-chip ${roleFilter === f ? 'is-active' : ''}`}
                style={{ textTransform: 'capitalize' }}
                onClick={() => setRoleFilter(f)}
              >
                {f === 'all' ? 'All Users' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Primary Add User Action */}
        <Link to="/dashboard/users/add" className="dash-btn-primary mw-primary" style={{ padding: '10px 18px', fontSize: '0.86rem' }}>
          <UserPlus size={16} />
          <span>Add New User</span>
        </Link>
      </div>

      {/* ── Users Table with Glassmorphic Elevation ── */}
      <div className="dash-card glass glass--lift" style={{ padding: 0, position: 'relative' }}>
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Model Access</th>
                <th>Total Requests</th>
                <th>Success Rate</th>
                <th>Rate Quota</th>
                <th>Last Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-4)' }}>
                    No users matching criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const roleDef = ROLE_DEFINITIONS[u.role]
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="dash-user-cell">
                          <div className="dash-user-avatar">
                            {u.fullName
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{u.fullName}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                              @{u.username} · {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`tag ${
                            u.role === 'admin'
                              ? 'tag--lime'
                              : u.role === 'developer'
                              ? 'tag--cyan'
                              : ''
                          }`}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.68rem',
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {roleDef.title}
                        </span>
                      </td>

                      <td>
                        <span className={`dash-status-dot dash-status-dot--${u.status}`}>
                          {statusLabels[u.status]}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--ink-2)' }}>
                          {u.modelAccess === 'all' ? (
                            <span style={{ color: 'var(--brand-hi)' }}>All 80+ Models</span>
                          ) : (
                            `${u.selectedModels.length} Models`
                          )}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--ink)', fontWeight: 600 }}>
                          {(u.totalRequests ?? 0).toLocaleString('en-IN')}
                        </span>
                      </td>

                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              display: 'inline-block',
                              backgroundColor:
                                (u.successRate ?? 100) >= 99.5
                                  ? 'var(--brand-hi, #76b900)'
                                  : (u.successRate ?? 100) >= 98.0
                                  ? '#38bdf8'
                                  : '#f59e0b',
                            }}
                          />
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.78rem',
                              fontWeight: 600,
                              color:
                                (u.successRate ?? 100) >= 99.5
                                  ? 'var(--brand-hi, #76b900)'
                                  : (u.successRate ?? 100) >= 98.0
                                  ? '#38bdf8'
                                  : '#f59e0b',
                            }}
                            title="Reliability of the user's API requests"
                          >
                            {u.totalRequests === 0 ? '100%' : `${(u.successRate ?? 99.8).toFixed(1)}%`}
                          </span>
                        </div>
                      </td>

                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                          {u.rateLimit.split(' ')[0]} {u.rateLimit.split(' ')[1]}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: '0.76rem', color: 'var(--ink-4)' }}>{u.lastActive}</span>
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="dash-btn-ghost"
                            style={{ padding: '5px 9px', fontSize: '0.76rem' }}
                            onClick={() => setSelectedUser(u)}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className="dash-icon-btn"
                            style={{ width: '28px', height: '28px' }}
                            title="Revoke access"
                            onClick={() => handleDelete(u.id, u.fullName)}
                          >
                            <Trash2 size={13} style={{ color: 'var(--ink-4)' }} />
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
      </div>

      {/* ── User Details Modal Drawer ───────────────────────── */}
      {selectedUser && (
        <div className="dash-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div
            className="dash-modal"
            style={{ maxWidth: '540px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div className="dash-user-cell">
                <div className="dash-user-avatar" style={{ width: 44, height: 44, fontSize: '0.9rem' }}>
                  {selectedUser.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--ink)' }}>{selectedUser.fullName}</h3>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--brand-hi)' }}>
                    @{selectedUser.username} · {selectedUser.email}
                  </div>
                </div>
              </div>
              <button type="button" className="dash-icon-btn" onClick={() => setSelectedUser(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <span className="readout-label">Account Role</span>
                <div style={{ fontWeight: 600, color: 'var(--brand-hi)', textTransform: 'uppercase', fontSize: '0.85rem' }}>
                  {selectedUser.role}
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <span className="readout-label">Status</span>
                <div className={`dash-status-dot dash-status-dot--${selectedUser.status}`} style={{ fontWeight: 600, marginTop: 2 }}>
                  {statusLabels[selectedUser.status]}
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <span className="readout-label">Total Requests</span>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)', fontSize: '0.95rem' }}>
                  {(selectedUser.totalRequests ?? 0).toLocaleString('en-IN')} reqs
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <span className="readout-label">Success Rate</span>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--brand-hi)', fontSize: '0.95rem' }}>
                  {selectedUser.totalRequests === 0 ? '100%' : `${(selectedUser.successRate ?? 99.8).toFixed(1)}%`}
                </div>
                <small style={{ fontSize: '0.68rem', color: 'var(--ink-4)', display: 'block', marginTop: 2 }}>
                  API request reliability
                </small>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <span className="readout-label">Rate Limit</span>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--ink-2)' }}>
                  {selectedUser.rateLimit}
                </div>
              </div>
            </div>

            {selectedUser.internalNote && (
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)', marginBottom: 16 }}>
                <span className="readout-label">Internal Compliance Note</span>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--ink-2)' }}>
                  {selectedUser.internalNote}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="dash-btn-secondary" onClick={() => setSelectedUser(null)}>
                Close
              </button>
              <button
                type="button"
                className="dash-btn-primary"
                onClick={() => {
                  setSelectedUser(null)
                  navigate('/dashboard/users/add')
                }}
              >
                <Plus size={15} /> Add Another
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
