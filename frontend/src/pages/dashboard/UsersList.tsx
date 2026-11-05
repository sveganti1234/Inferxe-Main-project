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
import { loadUsers, deleteUser, toggleUserStatus, ROLE_DEFINITIONS } from '../../lib/userStore'
import type { UserRecord } from '../../types/dashboard'
import { usePageMeta } from '../../lib/hooks'

export default function UsersList() {
  usePageMeta('Users Directory · Inferxe Dashboard', 'Manage team members, permissions, and spending quotas for LLM inference.')
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)

  useEffect(() => {
    const refresh = () => setUsers(loadUsers())
    refresh()
    window.addEventListener('inferxe_users_change', refresh)
    window.addEventListener('inferxe_auth_change', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('inferxe_users_change', refresh)
      window.removeEventListener('inferxe_auth_change', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const handleToggleStatus = (id: string) => {
    const updated = toggleUserStatus(id)
    setUsers(loadUsers())
    if (selectedUser?.id === id && updated) {
      setSelectedUser(updated)
    }
  }

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to revoke marketplace access for ${name}?`)) {
      deleteUser(id)
      setUsers(loadUsers())
      if (selectedUser?.id === id) {
        setSelectedUser(null)
      }
    }
  }

  const filteredUsers = users
    .filter((u) => {
      const matchesSearch =
        u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(searchQuery.toLowerCase())

      if (!matchesSearch) return false

      if (roleFilter === 'all') return true
      if (roleFilter === 'active') return u.status === 'active'
      // Strictly only users kept as inactive in their status are shown in the inactive list
      if (roleFilter === 'inactive') return u.status === 'inactive'
      if (roleFilter === 'customer') return (u.role === 'customer' || u.role === 'developer') && u.status === 'active'
      return u.role === roleFilter
    })
    .sort((a, b) => {
      // Prioritize customers who signed in latest (lastActive === 'Just now') at the top of the list
      if (a.lastActive === 'Just now' && b.lastActive !== 'Just now') return -1
      if (b.lastActive === 'Just now' && a.lastActive !== 'Just now') return 1
      return 0
    })

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
      {/* ── Bento Metrics Row (Glassmorphic + Claymorphic + LCD Readouts) ── */}
      <div className="dash-stats-row" style={{ marginBottom: 24 }}>
        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Team Members</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={users.length} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#76b900', fontWeight: 600 }}>● {users.filter((u) => u.status === 'active').length} Active</span>
              <span>·</span>
              <span style={{ color: 'var(--ink-3)' }}>○ {users.filter((u) => u.status === 'inactive').length} Inactive</span>
            </small>
          </div>
        </Tilt>

        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Privileged Admins</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={users.filter((u) => u.role === 'admin').length || 2} />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>Super Admin RBAC</small>
          </div>
        </Tilt>

        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Monthly Quota Pool</span>
              <span className="engrave" style={{ fontSize: '0.62rem', opacity: 0.7 }}>INR</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={150000} prefix="₹" />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>Automated spend caps</small>
          </div>
        </Tilt>

        <Tilt max={5} className="dash-stat-tilt">
          <div className="dash-stat-card glass glass--lift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="dash-stat-label engrave">Policy Compliance</span>
            </div>
            <div className="dash-stat-value readout">
              <Counter to={99.9} decimals={1} suffix="%" />
            </div>
            <small style={{ color: 'var(--ink-4)', fontSize: '0.72rem', marginTop: 4 }}>SOC2 Type II · MeitY</small>
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
            {[
              { key: 'all', label: `All (${users.length})` },
              { key: 'active', label: `Active (${users.filter((u) => u.status === 'active').length})` },
              { key: 'inactive', label: `Inactive (${users.filter((u) => u.status === 'inactive').length})` },
              { key: 'customer', label: `Clients (${users.filter((u) => (u.role === 'customer' || u.role === 'developer') && u.status === 'active').length})` },
              { key: 'admin', label: 'Admins' },
              { key: 'developer', label: 'Developers' },
              { key: 'viewer', label: 'Viewers' },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                className={`dash-preset-chip ${roleFilter === f.key ? 'is-active' : ''}`}
                onClick={() => setRoleFilter(f.key)}
              >
                {f.label}
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
                <th>Monthly Limit</th>
                <th>Rate Quota</th>
                <th>Last Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-4)' }}>
                    No users matching criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const roleDef = ROLE_DEFINITIONS[u.role] || {
                    title: u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : 'Customer',
                    description: 'User access',
                    badgeClass: 'chip--cyan',
                    permissions: ['Platform Access'],
                  }
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
                        <span
                          className={`dash-status-dot dash-status-dot--${u.status}`}
                          style={{
                            color: u.status === 'active' ? '#76b900' : 'var(--ink-4)',
                            fontWeight: u.status === 'active' ? 600 : 400,
                          }}
                        >
                          {u.status === 'active' ? 'Active' : 'Inactive'}
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
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                          {u.monthlySpendLimit ? `₹${u.monthlySpendLimit.toLocaleString('en-IN')}` : 'Unlimited'}
                        </span>
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
                            className="dash-btn-ghost"
                            style={{
                              padding: '5px 8px',
                              fontSize: '0.72rem',
                              color: u.status === 'active' ? 'var(--ink-3)' : '#76b900',
                            }}
                            title={u.status === 'active' ? 'Mark user as inactive' : 'Mark user as active'}
                            onClick={() => handleToggleStatus(u.id)}
                          >
                            {u.status === 'active' ? 'Set Inactive' : 'Set Active'}
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                  <div
                    className={`dash-status-dot dash-status-dot--${selectedUser.status}`}
                    style={{ fontWeight: 600, color: selectedUser.status === 'active' ? '#76b900' : 'var(--ink-4)' }}
                  >
                    {selectedUser.status === 'active' ? 'Active' : 'Inactive'}
                  </div>
                  <button
                    type="button"
                    className="dash-btn-ghost"
                    style={{ padding: '2px 8px', fontSize: '0.72rem', color: selectedUser.status === 'active' ? 'var(--ink-3)' : '#76b900' }}
                    onClick={() => handleToggleStatus(selectedUser.id)}
                  >
                    Mark as {selectedUser.status === 'active' ? 'Inactive' : 'Active'}
                  </button>
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <span className="readout-label">Monthly Spending Cap</span>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)' }}>
                  {selectedUser.monthlySpendLimit ? `₹${selectedUser.monthlySpendLimit.toLocaleString('en-IN')}` : 'Unlimited'}
                </div>
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
