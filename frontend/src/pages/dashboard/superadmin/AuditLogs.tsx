import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText,
  Search,
  RefreshCw,
  Download,
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Eye,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  fetchSuperadminAuditLogs,
  type SuperadminAuditLog,
} from '../../../lib/authStore'

export default function AuditLogs() {
  usePageMeta(
    'Audit Logs & Activity Trail · Inferxe Superadmin Governance',
    'Immutable platform audit logs, admin authentication history, customer management actions, and security events.',
  )

  const [logs, setLogs] = useState<SuperadminAuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters & Pagination
  const [category, setCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // Selected Log Drawer/Modal
  const [selectedLog, setSelectedLog] = useState<SuperadminAuditLog | null>(null)

  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const offset = (page - 1) * pageSize
      const res = await fetchSuperadminAuditLogs({
        category: category === 'all' ? undefined : category,
        search: searchQuery || undefined,
        limit: pageSize,
        offset,
      })
      if (res.ok && res.logs) {
        setLogs(res.logs)
        setTotal(res.total ?? res.logs.length)
      } else {
        setError(res.error || 'Failed to retrieve audit trail logs.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading audit logs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
  }, [category, page])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    void loadLogs()
  }

  const handleExportCsv = () => {
    if (logs.length === 0) return
    const headers = ['ID', 'Timestamp', 'Admin Email', 'Action', 'Category', 'Target Type', 'Target ID', 'IP Address', 'Details']
    const rows = logs.map((l) => [
      l.id,
      l.created_at,
      l.admin_email,
      l.action,
      l.category,
      l.target_type || '',
      l.target_id || '',
      l.ip_address || '',
      JSON.stringify(l.details).replace(/"/g, '""'),
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((x) => `"${x}"`).join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `inferxe_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <DashboardLayout
      pageTitle="Platform Audit Logs & Activity Trail"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/superadmin' },
        { label: 'Audit Trail' },
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
                  color: '#9CA3AF',
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
                color: '#FFFFFF',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              System Audit Logs & Security Trail
            </h1>
            <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.84rem' }}>
              Comprehensive tamper-proof record of admin logins, customer edits, status transitions, and infrastructure modifications.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              style={{
                background: '#121C16',
                border: '1px solid #1B2E24',
                color: '#E5E7EB',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadLogs()}
              disabled={loading}
              style={{
                background: '#121C16',
                border: '1px solid #1B2E24',
                color: '#E5E7EB',
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
              <span>Refresh Logs</span>
            </button>
          </div>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div
            style={{
              background: '#2B1214',
              border: '1px solid #7F1D1D',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#FCA5A5',
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

        {/* ── Search & Filter Toolbar ── */}
        <div
          style={{
            background: '#0F1612',
            border: '1px solid #1B2E24',
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
          <form onSubmit={handleSearchSubmit} style={{ position: 'relative', width: '340px', maxWidth: '100%' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#6B7280',
              }}
            />
            <input
              type="text"
              placeholder="Filter by admin, action, target..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: '#121C16',
                border: '1px solid #23382C',
                borderRadius: '6px',
                padding: '8px 12px 8px 36px',
                color: '#FFFFFF',
                fontSize: '0.84rem',
                outline: 'none',
              }}
            />
          </form>

          {/* Category Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'All Events' },
              { key: 'auth', label: 'Auth & Sessions' },
              { key: 'customer', label: 'Customer Actions' },
              { key: 'admin', label: 'Admin Governance' },
              { key: 'infra', label: 'Infrastructure' },
              { key: 'keys', label: 'API Keys' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setCategory(tab.key)
                  setPage(1)
                }}
                style={{
                  background: category === tab.key ? '#38BDF8' : '#121C16',
                  color: category === tab.key ? '#040D08' : '#D1D5DB',
                  border: `1px solid ${category === tab.key ? '#38BDF8' : '#1B2E24'}`,
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

        {/* ── Audit Logs Table Card ── */}
        <div
          style={{
            background: '#0F1612',
            border: '1px solid #1B2E24',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: '#0B130F', borderBottom: '1px solid #1B2E24' }}>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Timestamp
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Category
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Action
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Actor (Admin Email)
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Target / IP
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: '#9CA3AF' }}>
                      <RefreshCw size={20} className="spin-icon" style={{ color: '#38BDF8', margin: '0 auto 8px' }} />
                      <div>Querying immutable audit records...</div>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: '#9CA3AF' }}>
                      <FileText size={28} style={{ opacity: 0.4, margin: '0 auto 8px' }} />
                      <div style={{ color: '#FFFFFF', fontWeight: 600 }}>No audit records found</div>
                      <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                        No events matching the active filter criteria.
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: '1px solid #152219',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '14px 18px', color: '#E5E7EB', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                        <div>{new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div style={{ color: '#9CA3AF', fontSize: '0.72rem' }}>
                          {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <span
                          style={{
                            background:
                              log.category === 'auth'
                                ? 'rgba(56, 189, 248, 0.12)'
                                : log.category === 'customer'
                                  ? 'rgba(16, 185, 129, 0.12)'
                                  : log.category === 'admin'
                                    ? 'rgba(0, 255, 136, 0.12)'
                                    : 'rgba(251, 191, 36, 0.12)',
                            color:
                              log.category === 'auth'
                                ? '#38BDF8'
                                : log.category === 'customer'
                                  ? '#10B981'
                                  : log.category === 'admin'
                                    ? '#00FF88'
                                    : '#FBBF24',
                            border: `1px solid ${
                              log.category === 'auth'
                                ? 'rgba(56, 189, 248, 0.25)'
                                : log.category === 'customer'
                                  ? 'rgba(16, 185, 129, 0.25)'
                                  : log.category === 'admin'
                                    ? 'rgba(0, 255, 136, 0.25)'
                                    : 'rgba(251, 191, 36, 0.25)'
                            }`,
                            borderRadius: '4px',
                            padding: '2px 8px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          {log.category}
                        </span>
                      </td>

                      <td style={{ padding: '14px 18px', color: '#FFFFFF', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                        {log.action}
                      </td>

                      <td style={{ padding: '14px 18px', color: '#D1D5DB' }}>
                        {log.admin_email}
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ color: '#E5E7EB', fontSize: '0.78rem' }}>
                          {log.target_type ? `${log.target_type}: ` : ''}{log.target_id || 'System'}
                        </div>
                        <div style={{ color: '#6B7280', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                          IP: {log.ip_address || '127.0.0.1'}
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          style={{
                            background: '#121C16',
                            border: '1px solid #1B2E24',
                            color: '#E5E7EB',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '0.74rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid #1B2E24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8rem',
              color: '#9CA3AF',
            }}
          >
            <div>
              Showing {logs.length} of {total} records
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  background: '#121C16',
                  border: '1px solid #1B2E24',
                  color: page <= 1 ? '#4B5563' : '#FFFFFF',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  background: '#121C16',
                  border: '1px solid #1B2E24',
                  color: page >= totalPages ? '#4B5563' : '#FFFFFF',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Log Detail Modal ── */}
        {selectedLog && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.85)',
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
                background: '#0F1612',
                border: '1px solid #1B2E24',
                borderRadius: '14px',
                width: '100%',
                maxWidth: '600px',
                padding: '24px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.95)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#FFFFFF', fontSize: '1.15rem', fontWeight: 700 }}>
                    Audit Event Details
                  </h3>
                  <div style={{ color: '#9CA3AF', fontSize: '0.76rem', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                    ID: {selectedLog.id}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#9CA3AF',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px', fontSize: '0.82rem' }}>
                <div>
                  <span style={{ color: '#9CA3AF' }}>Action:</span>{' '}
                  <strong style={{ color: '#FFFFFF' }}>{selectedLog.action}</strong>
                </div>
                <div>
                  <span style={{ color: '#9CA3AF' }}>Category:</span>{' '}
                  <strong style={{ color: '#38BDF8', textTransform: 'uppercase' }}>{selectedLog.category}</strong>
                </div>
                <div>
                  <span style={{ color: '#9CA3AF' }}>Actor:</span>{' '}
                  <strong style={{ color: '#FFFFFF' }}>{selectedLog.admin_email}</strong>
                </div>
                <div>
                  <span style={{ color: '#9CA3AF' }}>IP Address:</span>{' '}
                  <strong style={{ color: '#FFFFFF', fontFamily: 'var(--font-mono)' }}>{selectedLog.ip_address || '127.0.0.1'}</strong>
                </div>
                <div>
                  <span style={{ color: '#9CA3AF' }}>Target:</span>{' '}
                  <strong style={{ color: '#FFFFFF' }}>{selectedLog.target_type ? `${selectedLog.target_type}: ` : ''}{selectedLog.target_id || 'System'}</strong>
                </div>
                <div>
                  <span style={{ color: '#9CA3AF' }}>Recorded At:</span>{' '}
                  <strong style={{ color: '#FFFFFF' }}>{new Date(selectedLog.created_at).toLocaleString()}</strong>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#9CA3AF', marginBottom: '6px' }}>
                  Event Payload (Metadata JSON):
                </label>
                <pre
                  style={{
                    background: '#080D0A',
                    border: '1px solid #152219',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#10B981',
                    fontSize: '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    overflowX: 'auto',
                    maxHeight: '220px',
                    margin: 0,
                  }}
                >
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>

              <div style={{ marginTop: '20px', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  style={{
                    background: '#10B981',
                    border: 'none',
                    color: '#040D08',
                    fontWeight: 600,
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
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
