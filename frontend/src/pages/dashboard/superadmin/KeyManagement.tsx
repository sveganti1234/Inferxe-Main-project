import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Key,
  ShieldAlert,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Eye,
  LogIn,
  ShieldCheck,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  clearSession,
  fetchSuperadminKeys,
  revokeSuperadminKey,
  type SuperadminKeyRecord,
} from '../../../lib/authStore'

export default function KeyManagement() {
  usePageMeta(
    'Platform Keys & SSH Management · Inferxe Superadmin',
    'Global audit and emergency revocation of platform API credentials, developer tokens, and cluster SSH keys.',
  )

  const navigate = useNavigate()
  const [keys, setKeys] = useState<SuperadminKeyRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
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
    setAuthError(false)
    try {
      const res = await fetchSuperadminKeys()
      if (res.ok && res.keys) {
        setKeys(res.keys)
        setLoaded(true)
      } else {
        setKeys([])
        setLoaded(false)
        setAuthError(Boolean(res.unauthorized || res.forbidden || res.status === 401 || res.status === 403))
        setError(res.error || 'Failed to retrieve system credentials.')
      }
    } catch (err) {
      setKeys([])
      setLoaded(false)
      setError(err instanceof Error ? err.message : 'Error retrieving keys.')
    } finally {
      setLoading(false)
    }
  }

  const handleSignInAgain = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    void loadKeys()
  }, [])

  const handleConfirmRevocation = async () => {
    if (!targetKey) return
    const trimmedReason = revokeReason.trim()
    if (trimmedReason.length < 3) {
      setError('Please provide an audit reason of at least 3 characters.')
      return
    }
    setRevoking(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const keyType = targetKey.key_type ?? (targetKey.type === 'SSH Key' ? 'ssh' : 'api')
      const res = await revokeSuperadminKey(targetKey.id, keyType, trimmedReason)
      if (res.ok) {
        const detachNote =
          keyType === 'ssh' && typeof res.detached_sessions === 'number' && res.detached_sessions > 0
            ? ` Detached ${res.detached_sessions} linked GPU notebook session${res.detached_sessions === 1 ? '' : 's'}.`
            : ''
        setSuccessMsg(
          (res.message ||
            (keyType === 'ssh'
              ? `SSH key "${targetKey.name}" (${targetKey.id}) has been permanently deleted.`
              : `API key "${targetKey.name}" (${targetKey.id}) has been revoked.`)) + detachNote,
        )
        setTargetKey(null)
        setRevokeReason('')
        await loadKeys()
      } else {
        setError(res.error || 'Failed to revoke key.')
        if (res.status === 404 || res.status === 409) {
          setTargetKey(null)
          await loadKeys()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during key revocation.')
    } finally {
      setRevoking(false)
    }
  }

  const formatTimestamp = (value?: string | null) => {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const filteredKeys = keys.filter((k) => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      k.name.toLowerCase().includes(q) ||
      k.owner_email.toLowerCase().includes(q) ||
      k.owner_name.toLowerCase().includes(q) ||
      k.id.toLowerCase().includes(q) ||
      (k.fingerprint || '').toLowerCase().includes(q)

    if (filterType === 'all') return matchesSearch
    if (filterType === 'api') return matchesSearch && k.type === 'API Key'
    if (filterType === 'ssh') return matchesSearch && k.type === 'SSH Key'
    if (filterType === 'revoked') return matchesSearch && k.status !== 'active'
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
              Platform API Keys & SSH Credentials
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--cx-text-3)', fontSize: '0.84rem' }}>
              Centralized audit of all developer access credentials, cluster SSH keys, and emergency revocation controls.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <Link
              to="/dashboard/keys"
              style={{
                background: 'var(--cx-surface)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                color: 'var(--cx-accent)',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
              }}
            >
              <Eye size={14} />
              <span>Admin Key Monitoring</span>
            </Link>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadKeys()}
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
              <span>Refresh Keys</span>
            </button>
          </div>
        </div>

        {/* ── Privileged Governance Scope Banner ── */}
        <div
          style={{
            background: 'var(--cx-accent-soft)',
            border: '1px solid color-mix(in srgb, var(--cx-accent) 20%, transparent)',
            borderRadius: '10px',
            padding: '13px 16px',
            marginBottom: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                borderRadius: '999px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'var(--cx-accent-soft)',
                color: 'var(--cx-accent)',
                border: '1px solid transparent',
              }}
            >
              <ShieldCheck size={12} /> Super Admin Privileged Tier
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--cx-text-2)' }}>
              Emergency API key revocation &amp; permanent SSH public-key deletion with mandatory audited reasons. Use{' '}
              <Link to="/dashboard/keys" style={{ color: 'var(--cx-accent)', textDecoration: 'underline' }}>
                Admin Key Monitoring
              </Link>{' '}
              for read-only usage analytics, security alerts, and audit history.
            </span>
          </div>
        </div>

        {/* ── Feedback Banners ── */}
        {error && !loaded && (
          <div
            role="alert"
            style={{
              background: authError ? 'var(--cx-info-soft)' : 'var(--cx-danger-soft)',
              border: `1px solid ${authError ? 'color-mix(in srgb, var(--cx-info) 30%, transparent)' : 'color-mix(in srgb, var(--cx-danger) 30%, transparent)'}`,
              borderRadius: '10px',
              padding: '20px 22px',
              color: authError ? 'var(--cx-info)' : 'var(--cx-danger)',
              fontSize: '0.85rem',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--cx-text)' }}>
                  {authError ? 'Super Admin Authentication Required' : 'Key Governance Backend Unavailable'}
                </div>
                <div style={{ marginTop: 4 }}>{error}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {authError && (
                <button
                  type="button"
                  onClick={handleSignInAgain}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--cx-accent)',
                    color: 'var(--cx-accent-ink)',
                    border: 'none',
                    borderRadius: '7px',
                    padding: '7px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <LogIn size={14} />
                  <span>Sign In Again</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadKeys()}
                disabled={loading}
                style={{
                  background: 'var(--cx-surface)',
                  border: '1px solid var(--cx-border-2)',
                  color: 'var(--cx-text-2)',
                  borderRadius: '7px',
                  padding: '7px 14px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {error && loaded && (
          <div
            role="alert"
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

        {/* ── Search & Filter Toolbar (Shown when loading or data loaded) ── */}
        {(!error || loaded) && (
        <>
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
          <div style={{ position: 'relative', width: '340px', maxWidth: '100%' }}>
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
              placeholder="Filter by name, email, or key ID..."
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

          {/* Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {[
              { key: 'all', label: `All Keys (${keys.length})` },
              { key: 'api', label: `API Keys (${keys.filter((k) => k.type === 'API Key').length})` },
              { key: 'ssh', label: `SSH Keys (${keys.filter((k) => k.type === 'SSH Key').length})` },
              { key: 'revoked', label: `Revoked / Inactive (${keys.filter((k) => k.status !== 'active').length})` },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterType(tab.key as any)}
                style={{
                  background: filterType === tab.key ? 'var(--cx-accent)' : 'var(--cx-surface)',
                  color: filterType === tab.key ? 'var(--cx-accent-ink)' : 'var(--cx-text-2)',
                  border: `1px solid ${filterType === tab.key ? 'var(--cx-accent)' : 'var(--cx-border)'}`,
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
                    Credential Name
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Type
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Owner & Role
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Prefix / Fingerprint
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Status
                  </th>
                  <th style={{ padding: '12px 18px', color: 'var(--cx-text-2)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>
                    Emergency Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && keys.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: 'var(--cx-text-3)' }}>
                      <RefreshCw size={20} className="spin-icon" style={{ color: 'var(--cx-accent)', margin: '0 auto 8px' }} />
                      <div>Auditing system credentials...</div>
                    </td>
                  </tr>
                ) : filteredKeys.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: 'var(--cx-text-3)' }}>
                      <Key size={28} style={{ opacity: 0.4, margin: '0 auto 8px' }} />
                      <div style={{ color: 'var(--cx-text)', fontWeight: 600 }}>No credentials found</div>
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
                        borderBottom: '1px solid var(--cx-border)',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--cx-text)', fontSize: '0.88rem' }}>
                          {key.name}
                        </div>
                        <div style={{ color: 'var(--cx-text-3)', fontSize: '0.74rem', fontFamily: 'var(--font-mono)' }}>
                          ID: {key.id}
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <span
                          style={{
                            background:
                              key.type === 'API Key' ? 'var(--cx-accent-soft)' : 'rgba(56, 189, 248, 0.12)',
                            color: key.type === 'API Key' ? 'var(--cx-accent)' : 'var(--cx-info)',
                            border: `1px solid ${
                              key.type === 'API Key' ? 'transparent' : 'rgba(56, 189, 248, 0.25)'
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
                        <div style={{ color: 'var(--cx-text-2)', fontWeight: 500 }}>{key.owner_name}</div>
                        <div style={{ color: 'var(--cx-text-3)', fontSize: '0.74rem' }}>{key.owner_email} ({key.role})</div>
                      </td>

                      <td style={{ padding: '14px 18px', color: 'var(--cx-accent)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                        <div>{key.fingerprint || key.prefix}</div>
                        <div style={{ color: 'var(--cx-text-3)', fontSize: '0.7rem', marginTop: '2px' }}>
                          {key.type === 'API Key'
                            ? `${(key.environment || 'live').toUpperCase()} · ${key.usage_count ?? 0} reqs · Last used: ${formatTimestamp(key.last_used)}`
                            : `${key.ssh_algorithm || 'ssh'} · Added: ${formatTimestamp(key.created_at)}`}
                        </div>
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
                            color: key.status === 'active' ? 'var(--cx-accent)' : 'var(--cx-danger)',
                            border: `1px solid ${
                              key.status === 'active'
                                ? 'rgba(16, 185, 129, 0.25)'
                                : 'rgba(239, 68, 68, 0.25)'
                            }`,
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            textTransform: 'capitalize',
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: key.status === 'active' ? 'var(--cx-accent)' : 'var(--cx-danger)',
                            }}
                          />
                          {key.status}
                        </span>
                        {key.revoked_at && (
                          <div style={{ color: 'var(--cx-text-3)', fontSize: '0.68rem', marginTop: '3px' }}>
                            {formatTimestamp(key.revoked_at)}
                          </div>
                        )}
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
                              color: 'var(--cx-danger)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: '6px',
                              padding: '5px 12px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {key.type === 'SSH Key' ? 'Delete SSH Key' : 'Revoke'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--cx-text-4)', textTransform: 'capitalize' }}>
                            {key.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

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
                background: 'var(--cx-card-a, var(--cx-panel))',
                border: '1px solid var(--cx-border)',
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
                    color: 'var(--cx-danger)',
                  }}
                >
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--cx-text)', fontSize: '1.1rem', fontWeight: 700 }}>
                    {targetKey.type === 'SSH Key'
                      ? 'Emergency Delete SSH Public Key'
                      : 'Emergency Revoke API Key'}
                  </h3>
                  <div style={{ color: 'var(--cx-text-3)', fontSize: '0.78rem' }}>
                    {targetKey.name} ({targetKey.id})
                  </div>
                </div>
              </div>

              <p style={{ color: 'var(--cx-text-2)', fontSize: '0.84rem', margin: '0 0 16px', lineHeight: 1.5 }}>
                {targetKey.type === 'SSH Key'
                  ? 'Permanently deletes this SSH public key from the platform, detaches any linked GPU notebook sessions, and removes SSH authorization immediately. This action cannot be undone and is recorded in the audit log.'
                  : 'Immediately marks this API key as revoked in the database so all inference and API requests authenticated under it are rejected. This action cannot be undone and is recorded in the audit log.'}
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: 'var(--cx-text-3)', marginBottom: '6px' }}>
                  Mandatory Audit Reason (min. 3 characters):
                </label>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Suspected key leak / Emergency security revocation"
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
                  onClick={() => setTargetKey(null)}
                  disabled={revoking}
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
                  onClick={handleConfirmRevocation}
                  disabled={revoking || revokeReason.trim().length < 3}
                  style={{
                    background: '#EF4444',
                    border: 'none',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: revoking || revokeReason.trim().length < 3 ? 'not-allowed' : 'pointer',
                    opacity: revokeReason.trim().length < 3 ? 0.6 : 1,
                  }}
                >
                  {revoking
                    ? targetKey.type === 'SSH Key'
                      ? 'Deleting SSH Key...'
                      : 'Revoking Key...'
                    : targetKey.type === 'SSH Key'
                      ? 'Confirm Permanent Delete'
                      : 'Confirm Revocation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
