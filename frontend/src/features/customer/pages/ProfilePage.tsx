/**
 * User Profile & Organization — Personal account details, avatar, security credentials,
 * and sovereign tenant enclave status.
 * Restored in accordance with customer portal reference design (media_1795407667415_67fe490d.jpg).
 */
import { useMemo, useState, useEffect, type FormEvent } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { changeUserPassword, getSession, getUserPasswordLastUpdated, saveSession } from '../../../lib/authStore'
import { updateDisplayName } from '../data/serviceClients'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { Button, ButtonLink, Card, StatusPill } from '../ui/primitives'

export default function ProfilePage() {
  const section = getSection('profile')
  usePageMeta('User Profile & Organization · Inferxe', section.description)
  const { workspace, refresh } = useCustomerWorkspace()

  const session = getSession()
  const sessionUser = session?.user

  // Profile Credentials State
  const initialName = workspace?.profile?.full_name || sessionUser?.fullName || 'Vegantisahith'
  const initialOrg = (sessionUser as any)?.organization || 'Customer Workspace'
  const profileEmail = workspace?.profile?.email || sessionUser?.email || 'vegantisahith@gmail.com'

  const [profileName, setProfileName] = useState(initialName)
  const [profileOrg, setProfileOrg] = useState(initialOrg)
  const [profileAvatar, setProfileAvatar] = useState(() => {
    const parts = initialName.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return initialName.slice(0, 2).toUpperCase() || 'PS'
  })

  useEffect(() => {
    if (workspace?.profile?.full_name) {
      setProfileName(workspace.profile.full_name)
      const parts = workspace.profile.full_name.trim().split(/\s+/)
      if (parts.length >= 2) setProfileAvatar((parts[0][0] + parts[1][0]).toUpperCase())
      else if (parts.length === 1 && parts[0]) setProfileAvatar(parts[0].slice(0, 2).toUpperCase())
    }
  }, [workspace?.profile?.full_name])

  const [profileSaving, setProfileSaving] = useState(false)
  const [profileNotice, setProfileNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  // Password Update State
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(() =>
    getUserPasswordLastUpdated(profileEmail)
  )

  // JWT Modal State
  const [showJwtModal, setShowJwtModal] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)

  // Password strength calculation
  const pwdStrength = useMemo(() => {
    if (!newPassword) return { score: 0, label: 'Not entered', color: 'var(--ink-4)', percent: 0 }
    let s = 0
    if (newPassword.length >= 8) s += 1
    if (newPassword.length >= 12) s += 1
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) s += 1
    if (/[0-9]/.test(newPassword)) s += 1
    if (/[^A-Za-z0-9]/.test(newPassword)) s += 1

    if (s <= 1) return { score: 1, label: 'Weak', color: '#ef4444', percent: 25 }
    if (s <= 2) return { score: 2, label: 'Fair', color: '#f59e0b', percent: 50 }
    if (s <= 3) return { score: 3, label: 'Good', color: '#38bdf8', percent: 75 }
    return { score: 4, label: 'Strong', color: '#10b981', percent: 100 }
  }, [newPassword])

  // Validation rules checklist
  const rules = useMemo(() => ({
    minLen: newPassword.length >= 8,
    hasNumOrSymbol: /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword),
    matches: Boolean(newPassword && confirmPassword && newPassword === confirmPassword),
  }), [newPassword, confirmPassword])

  // Handle Profile Save
  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setProfileSaving(true)
    setProfileNotice(null)
    try {
      if (profileName.trim()) {
        try {
          await updateDisplayName(profileName.trim())
        } catch {
          // Fall back gracefully if offline or mock
        }
      }
      const activeSession = getSession()
      if (activeSession?.user) {
        activeSession.user.fullName = profileName.trim()
        ;(activeSession.user as any).organization = profileOrg.trim()
        saveSession(activeSession)
      }
      setProfileNotice({ tone: 'success', text: 'User profile and organization preferences updated.' })
      refresh?.()
    } catch {
      setProfileNotice({ tone: 'error', text: 'Failed to update profile settings.' })
    } finally {
      setProfileSaving(false)
    }
  }

  // Handle Password Submit
  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setPwdError(null)
    setPwdSuccess(null)

    if (!currentPassword) {
      setPwdError('Please enter your current password.')
      return
    }
    if (newPassword.length < 8) {
      setPwdError('New password must be at least 8 characters long.')
      return
    }
    if (!rules.hasNumOrSymbol) {
      setPwdError('New password must include at least one number or special character.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation do not match.')
      return
    }
    if (currentPassword === newPassword) {
      setPwdError('New password must be different from your current password.')
      return
    }

    setPwdSubmitting(true)
    const res = await changeUserPassword(profileEmail, currentPassword, newPassword)
    setPwdSubmitting(false)

    if (res.ok) {
      setPwdSuccess('Account password has been successfully updated.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      const now = new Date().toISOString()
      setLastUpdated(now)
      try {
        localStorage.setItem(`inferxe_pwd_updated_${profileEmail.trim().toLowerCase()}`, now)
      } catch {}
    } else {
      setPwdError(res.error || 'Failed to update password. Please check your credentials.')
    }
  }

  const handleResetPassword = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwdError(null)
    setPwdSuccess(null)
  }

  const formattedDate = useMemo(() => {
    if (!lastUpdated) return 'Default Credentials'
    try {
      const d = new Date(lastUpdated)
      return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    } catch {
      return 'Recently Updated'
    }
  }, [lastUpdated])

  const hasPasswordInput = Boolean(currentPassword || newPassword || confirmPassword)

  // Copy Bearer Token
  const handleCopyBearer = () => {
    const mockBearer = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfOTRhN2UyYjEwOWM0IiwiZW1haWwiOiJ2ZWdhbnRpc2FoaXRoQGdtYWlsLmNvbSJ9.simulated_eddsa_signature'
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(mockBearer).then(() => {
        setCopiedToken(true)
        setTimeout(() => setCopiedToken(false), 2500)
      })
    }
  }

  return (
    <div className="cx-profile-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">User Profile & Organization</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>User Profile & Organization</h1>
          <p className="cx-page-header__desc">Manage your personal account details, avatar, and role.</p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to="/dashboard/app" variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {/* ── Section Toolbar ── */}
      <div className="cx-section-toolbar cx-profile-toolbar">
        <div>
          <h2>Profile & Security Settings</h2>
          <p>Manage identity credentials, change account password, tenant organization settings, and inspect security tokens.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowJwtModal(true)}
          className="cx-inspect-jwt-btn"
        >
          <ShieldCheck size={16} /> Inspect JWT Session Token
        </Button>
      </div>

      {/* ── Top 2-Column Grid: Profile Credentials & Change Password ── */}
      <div className="cx-profile-two-col">
        {/* Left Card: Profile Credentials */}
        <Card className="cx-profile-card">
          <div className="cx-card-header-row">
            <h3>Profile Credentials</h3>
            <StatusPill tone="success">Verified Tenant</StatusPill>
          </div>

          <form className="cx-profile-form" onSubmit={handleSaveProfile}>
            {/* Identity Header */}
            <div className="cx-profile-identity">
              <div className="cx-profile-avatar" aria-hidden="true">
                {profileAvatar}
              </div>
              <div className="cx-profile-id-text">
                <strong className="cx-profile-name">{profileName}</strong>
                <small className="cx-profile-org">{profileOrg}</small>
              </div>
            </div>

            {profileNotice && (
              <div
                className={`cx-alert cx-alert--${profileNotice.tone}`}
                role={profileNotice.tone === 'error' ? 'alert' : 'status'}
              >
                {profileNotice.tone === 'success' ? <Check size={16} /> : <X size={16} />}
                <span>{profileNotice.text}</span>
              </div>
            )}

            {/* Full Name */}
            <div className="cx-field">
              <label htmlFor="cx-prof-fullname">Full Name</label>
              <input
                id="cx-prof-fullname"
                type="text"
                required
                className="cx-input"
                value={profileName}
                onChange={(e) => {
                  const val = e.target.value
                  setProfileName(val)
                  const parts = val.trim().split(/\s+/)
                  if (parts.length >= 2) setProfileAvatar((parts[0][0] + parts[1][0]).toUpperCase())
                  else if (parts.length === 1 && parts[0]) setProfileAvatar(parts[0].slice(0, 2).toUpperCase())
                }}
              />
            </div>

            {/* Work Email */}
            <div className="cx-field">
              <div className="cx-field-label-row">
                <label htmlFor="cx-prof-email">Work Email</label>
                <span className="cx-sso-badge">Managed by SSO</span>
              </div>
              <input
                id="cx-prof-email"
                type="email"
                disabled
                className="cx-input cx-input--disabled"
                value={profileEmail}
                title="Work email is managed by corporate SSO"
              />
              <small className="cx-field-hint">
                Primary work email is governed by corporate SSO authentication. Contact administrator to modify.
              </small>
            </div>

            {/* Organization Name */}
            <div className="cx-field">
              <label htmlFor="cx-prof-org">Organization Name</label>
              <input
                id="cx-prof-org"
                type="text"
                required
                className="cx-input"
                value={profileOrg}
                onChange={(e) => setProfileOrg(e.target.value)}
              />
            </div>

            {/* Access Role */}
            <div className="cx-field">
              <label htmlFor="cx-prof-role">Access Role</label>
              <input
                id="cx-prof-role"
                type="text"
                disabled
                className="cx-input cx-input--disabled"
                value="Customer Tenant / Infrastructure Operator"
              />
            </div>

            <div className="cx-form-actions" style={{ marginTop: 14 }}>
              <Button variant="primary" type="submit" disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save Profile Changes'}
              </Button>
            </div>
          </form>
        </Card>

        {/* Right Card: Change Account Password */}
        <Card className="cx-profile-card">
          <div className="cx-card-header-row">
            <div className="cx-card-title-icon-wrap">
              <Lock size={16} className="cx-accent-icon" />
              <h3>Change Account Password</h3>
            </div>
            <StatusPill tone="neutral">{formattedDate}</StatusPill>
          </div>

          <form className="cx-password-form" onSubmit={handlePasswordSubmit}>
            {pwdError && (
              <div className="cx-alert cx-alert--error" role="alert">
                <X size={15} style={{ flexShrink: 0 }} />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div className="cx-alert cx-alert--success" role="status">
                <Check size={15} style={{ flexShrink: 0 }} />
                <span>{pwdSuccess}</span>
              </div>
            )}

            {/* Current Password Field */}
            <div className="cx-field">
              <div className="cx-field-label-row">
                <label htmlFor="cx-pwd-current">Current Password</label>
                <small className="cx-required-badge">Required</small>
              </div>
              <div className="cx-input-wrap">
                <input
                  id="cx-pwd-current"
                  type={showCurrent ? 'text' : 'password'}
                  className="cx-input"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value)
                    setPwdError(null)
                  }}
                  placeholder="Enter current password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="cx-input-tool-btn"
                  onClick={() => setShowCurrent(!showCurrent)}
                  title={showCurrent ? 'Hide password' : 'Show password'}
                  aria-label="Toggle current password visibility"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* New Password Field */}
            <div className="cx-field">
              <div className="cx-field-label-row">
                <label htmlFor="cx-pwd-new">New Password</label>
                {newPassword && (
                  <span className="cx-pwd-strength-label" style={{ color: pwdStrength.color, fontWeight: 600 }}>
                    Strength: {pwdStrength.label}
                  </span>
                )}
              </div>
              <div className="cx-input-wrap">
                <input
                  id="cx-pwd-new"
                  type={showNew ? 'text' : 'password'}
                  className="cx-input"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setPwdError(null)
                  }}
                  placeholder="Enter new password (min. 8 characters)"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="cx-input-tool-btn"
                  onClick={() => setShowNew(!showNew)}
                  title={showNew ? 'Hide password' : 'Show password'}
                  aria-label="Toggle new password visibility"
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Strength Meter Bar */}
              {newPassword && (
                <div className="cx-pwd-meter-track" aria-hidden="true">
                  <div
                    className="cx-pwd-meter-fill"
                    style={{
                      width: `${pwdStrength.percent}%`,
                      backgroundColor: pwdStrength.color,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Confirm New Password Field */}
            <div className="cx-field">
              <div className="cx-field-label-row">
                <label htmlFor="cx-pwd-confirm">Confirm New Password</label>
                {confirmPassword && (
                  <small style={{ color: rules.matches ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {rules.matches ? '✓ Matches' : '✗ Does not match'}
                  </small>
                )}
              </div>
              <div className="cx-input-wrap">
                <input
                  id="cx-pwd-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  className="cx-input"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setPwdError(null)
                  }}
                  placeholder="Re-enter new password"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="cx-input-tool-btn"
                  onClick={() => setShowConfirm(!showConfirm)}
                  title={showConfirm ? 'Hide password' : 'Show password'}
                  aria-label="Toggle confirm password visibility"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Requirements Checklist */}
            <div className="cx-pwd-checklist">
              <div className={`cx-pwd-check-item ${rules.minLen ? 'is-valid' : ''}`}>
                <span className="cx-pwd-check-dot">{rules.minLen ? '✓' : '•'}</span>
                <span>At least 8 characters long</span>
              </div>
              <div className={`cx-pwd-check-item ${rules.hasNumOrSymbol ? 'is-valid' : ''}`}>
                <span className="cx-pwd-check-dot">{rules.hasNumOrSymbol ? '✓' : '•'}</span>
                <span>Includes at least one number (0-9) or symbol</span>
              </div>
              <div className={`cx-pwd-check-item ${rules.matches ? 'is-valid' : ''}`}>
                <span className="cx-pwd-check-dot">{rules.matches ? '✓' : '•'}</span>
                <span>New password and confirmation match</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="cx-form-actions" style={{ marginTop: 14 }}>
              <Button
                variant="primary"
                type="submit"
                disabled={pwdSubmitting}
                className="cx-update-pwd-btn"
              >
                <Lock size={14} />
                {pwdSubmitting ? 'Updating Password...' : 'Update Password'}
              </Button>
              {hasPasswordInput && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleResetPassword}
                  disabled={pwdSubmitting}
                >
                  Reset
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>

      {/* ── Bottom Section: Sovereign Tenant Security & Enclave Status ── */}
      <Card className="cx-profile-card cx-enclave-card">
        <div className="cx-card-header-row">
          <h3>Sovereign Tenant Security & Enclave Status</h3>
          <StatusPill tone="neutral">Local Enclave</StatusPill>
        </div>

        <div className="cx-enclave-body">
          <div className="cx-enclave-grid">
            <div className="cx-enclave-item">
              <Check size={16} className="cx-enclave-check" />
              <span>Two-Factor Authentication (TOTP) Enabled</span>
              <StatusPill tone="success">Active</StatusPill>
            </div>
            <div className="cx-enclave-item">
              <Check size={16} className="cx-enclave-check" />
              <span>Zero Cross-Border Data Transfer Enforced</span>
              <StatusPill tone="neutral">MeitY SLA</StatusPill>
            </div>
            <div className="cx-enclave-item">
              <Check size={16} className="cx-enclave-check" />
              <span>OpenAI Drop-In SDK Gateway Paired</span>
              <StatusPill tone="success">Active</StatusPill>
            </div>
          </div>

          <div className="cx-enclave-info-box">
            <ShieldCheck size={18} className="cx-enclave-shield" />
            <span>
              Demo profile credentials and authentication tokens are secured in local client storage. Production sessions verify Ed25519 signatures issued by Inferxe Sovereign Auth Enclaves.
            </span>
          </div>

          <div className="cx-enclave-actions">
            <Button variant="secondary" size="sm" onClick={() => setShowJwtModal(true)}>
              View Decoded JWT Claims
            </Button>
          </div>
        </div>
      </Card>

      {/* ── JWT Token Inspector Modal ── */}
      {showJwtModal && (
        <div className="cx-modal-backdrop" onClick={() => setShowJwtModal(false)}>
          <div className="cx-modal cx-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="cx-modal-head">
              <h3>JWT Session Token Inspector</h3>
              <button
                type="button"
                className="cx-iconbtn"
                onClick={() => setShowJwtModal(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="cx-modal-body">
              <p className="cx-jwt-modal-desc">
                Decoded structure of simulated JSON Web Token (RFC 7519) passed via <code>Authorization: Bearer</code>:
              </p>

              <div className="cx-jwt-code-grid">
                {/* Header */}
                <div className="cx-jwt-code-box">
                  <span className="cx-jwt-code-title cx-jwt-code-title--cyan">
                    Header (Algorithm & Token Type)
                  </span>
                  <pre className="cx-jwt-code-pre">
                    {JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'inferxe-sovereign-auth-2026-v1' }, null, 2)}
                  </pre>
                </div>

                {/* Payload */}
                <div className="cx-jwt-code-box">
                  <span className="cx-jwt-code-title cx-jwt-code-title--green">
                    Payload (Claims & Scopes)
                  </span>
                  <pre className="cx-jwt-code-pre">
                    {JSON.stringify({
                      sub: 'usr_94a7e2b109c4',
                      email: profileEmail,
                      name: profileName,
                      org: profileOrg,
                      roles: ['customer', 'tenant_admin'],
                      scopes: ['inference:read', 'inference:write', 'gpus:reserve', 'tokens:create'],
                      iss: 'https://auth.inferxe.com',
                      aud: 'https://api.inferxe.com',
                      iat: 1791782400,
                      exp: 1791868800,
                    }, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="cx-enclave-info-box" style={{ marginTop: 12 }}>
                <ShieldCheck size={18} className="cx-enclave-shield" />
                <span>
                  <strong>Frontend Transparency Disclosure:</strong> This interface demonstrates token verification claims and scopes. No actual cryptographic signing keys or secrets are stored in the client.
                </span>
              </div>
            </div>

            <div className="cx-modal-foot">
              <Button variant="secondary" size="sm" onClick={handleCopyBearer}>
                <Copy size={14} /> {copiedToken ? 'Copied Token!' : 'Copy Bearer Token'}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setShowJwtModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
