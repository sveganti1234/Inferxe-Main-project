import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Key,
  ShieldAlert,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  fetchSuperadminKeys,
  revokeSuperadminKey,
  type SuperadminKeyRecord,
} from '../../../lib/authStore'

export default function KeyManagement() {
  usePageMeta(
    'Platform Keys & SSH Management · Inferxe Superadmin',
    'Global audit and emergency revocation of platform API credentials, developer tokens, and cluster SSH keys.',
  )

  const [keys, setKeys] = useState<SuperadminKeyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'api' | 'ssh' | 'revoked'>('all')

  // Revocation Modal
  const [targetKey, setTargetKey] = useState<SuperadminKeyRecord | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revoking, setRevoking] = useState(false)

  const loadKeys = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchSuperadminKeys()
      if (res.ok && res.keys) {
        setKeys(res.keys)
      } else {
        setError(res.error || 'Failed to retrieve system credentials.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error retrieving keys.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadKeys()
  }, [])

  const handleConfirmRevocation = async () => {
    if (!targetKey) return
    setRevoking(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const keyType = targetKey.type === 'SSH Key' ? 'ssh' : 'api'
      const res = await revokeSuperadminKey(targetKey.id, keyType, revokeReason)
      if (res.ok) {
        setSuccessMsg(`Credential "${targetKey.name}" (${targetKey.id}) has been revoked.`)
        setTargetKey(null)
        setRevokeReason('')
        await loadKeys()
      } else {
        setError(res.error || 'Failed to revoke key.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during key revocation.')
    } finally {
      setRevoking(false)
    }
  }

  const filteredKeys = keys.filter((k) => {
    const matchesSearch =
      k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.owner_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.id.toLowerCase().includes(searchQuery.toLowerCase())

    if (filterType === 'all') return matchesSearch
    if (filterType === 'api') return matchesSearch && k.type === 'API Key'
    if (filterType === 'ssh') return matchesSearch && k.type === 'SSH Key'
    if (filterType === 'revoked') return matchesSearch && k.status === 'revoked'
    return matchesSearch
  })

  return (
    <DashboardLayout
      pageTitle="Platform API Keys & Cluster SSH Management"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/superadmin' },
        { label: 'Key Management' },
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
              Platform API Keys & SSH Credentials
            </h1>
            <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.84rem' }}>
              Centralized audit of all developer access credentials, cluster SSH keys, and emergency revocation controls.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadKeys()}
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
              <span>Refresh Keys</span>
            </button>
          </div>
        </div>

        {/* ── Feedback Banners ── */}
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

        {successMsg && (
          <div
            style={{
              background: '#0D2818',
              border: '1px solid #10B981',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#6EE7B7',
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
          <div style={{ position: 'relative', width: '340px', maxWidth: '100%' }}>
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
              placeholder="Filter by name, email, or key ID..."
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
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {[
              { key: 'all', label: `All Keys (${keys.length})` },
              { key: 'api', label: `API Keys (${keys.filter((k) => k.type === 'API Key').length})` },
              { key: 'ssh', label: `SSH Keys (${keys.filter((k) => k.type === 'SSH Key').length})` },
              { key: 'revoked', label: `Revoked (${keys.filter((k) => k.status === 'revoked').length})` },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterType(tab.key as any)}
                style={{
                  background: filterType === tab.key ? '#FBBF24' : '#121C16',
                  color: filterType === tab.key ? '#040D08' : '#D1D5DB',
                  border: `1px solid ${filterType === tab.key ? '#FBBF24' : '#1B2E24'}`,
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

        {/* ── Keys Table Card ── */}
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
                    Credential Name
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Type
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Owner & Role
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Prefix / Fingerprint
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Status
                  </th>
                  <th style={{ padding: '12px 18px', color: '#E5E7EB', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>
                    Emergency Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && keys.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: '#9CA3AF' }}>
                      <RefreshCw size={20} className="spin-icon" style={{ color: '#FBBF24', margin: '0 auto 8px' }} />
                      <div>Auditing system credentials...</div>
                    </td>
                  </tr>
                ) : filteredKeys.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: '#9CA3AF' }}>
                      <Key size={28} style={{ opacity: 0.4, margin: '0 auto 8px' }} />
                      <div style={{ color: '#FFFFFF', fontWeight: 600 }}>No credentials found</div>
                      <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                        No keys matching current filter selection.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredKeys.map((key) => (
                    <tr
                      key={key.id}
                      style={{
                        borderBottom: '1px solid #152219',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 600, color: '#FFFFFF', fontSize: '0.88rem' }}>
                          {key.name}
                        </div>
                        <div style={{ color: '#9CA3AF', fontSize: '0.74rem', fontFamily: 'var(--font-mono)' }}>
                          ID: {key.id}
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <span
                          style={{
                            background:
                              key.type === 'API Key' ? 'rgba(251, 191, 36, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                            color: key.type === 'API Key' ? '#FBBF24' : '#38BDF8',
                            border: `1px solid ${
                              key.type === 'API Key' ? 'rgba(251, 191, 36, 0.25)' : 'rgba(56, 189, 248, 0.25)'
                            }`,
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                          }}
                        >
                          {key.type}
                        </span>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ color: '#E5E7EB', fontWeight: 500 }}>{key.owner_name}</div>
                        <div style={{ color: '#9CA3AF', fontSize: '0.74rem' }}>{key.owner_email} ({key.role})</div>
                      </td>

                      <td style={{ padding: '14px 18px', color: '#6EE7B7', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                        {key.prefix}
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
                              key.status === 'active'
                                ? 'rgba(16, 185, 129, 0.12)'
                                : 'rgba(239, 68, 68, 0.12)',
                            color: key.status === 'active' ? '#10B981' : '#EF4444',
                            border: `1px solid ${
                              key.status === 'active'
                                ? 'rgba(16, 185, 129, 0.25)'
                                : 'rgba(239, 68, 68, 0.25)'
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
                              background: key.status === 'active' ? '#10B981' : '#EF4444',
                            }}
                          />
                          {key.status === 'active' ? 'Active' : 'Revoked'}
                        </span>
                      </td>

                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        {key.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTargetKey(key)
                              setRevokeReason('')
                            }}
                            style={{
                              background: 'rgba(239, 68, 68, 0.12)',
                              color: '#EF4444',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: '6px',
                              padding: '5px 12px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Revoke
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>Revoked</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Key Revocation Modal ── */}
        {targetKey && (
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
                maxWidth: '460px',
                padding: '24px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.95)',
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
                    color: '#EF4444',
                  }}
                >
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, color: '#FFFFFF', fontSize: '1.1rem', fontWeight: 700 }}>
                    Emergency Revoke Key
                  </h3>
                  <div style={{ color: '#9CA3AF', fontSize: '0.78rem' }}>
                    {targetKey.name} ({targetKey.id})
                  </div>
                </div>
              </div>

              <p style={{ color: '#D1D5DB', fontSize: '0.84rem', margin: '0 0 16px', lineHeight: 1.5 }}>
                Revoking this credential will immediately cut off external API queries and SSH access sessions authenticated under it. This action cannot be undone.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#9CA3AF', marginBottom: '6px' }}>
                  Mandatory Audit Reason:
                </label>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Suspected key leak / Routine security rotation"
                  style={{
                    width: '100%',
                    background: '#121C16',
                    border: '1px solid #23382C',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#FFFFFF',
                    fontSize: '0.82rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setTargetKey(null)}
                  disabled={revoking}
                  style={{
                    background: '#121C16',
                    border: '1px solid #1B2E24',
                    color: '#D1D5DB',
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
                  onClick={handleConfirmRevocation}
                  disabled={revoking || !revokeReason.trim()}
                  style={{
                    background: '#EF4444',
                    border: 'none',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: revoking || !revokeReason.trim() ? 'not-allowed' : 'pointer',
                    opacity: !revokeReason.trim() ? 0.6 : 1,
                  }}
                >
                  {revoking ? 'Revoking Key...' : 'Confirm Revocation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
