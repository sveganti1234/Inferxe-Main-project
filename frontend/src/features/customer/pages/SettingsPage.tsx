/**
 * Settings & Quotas — Configure demo preferences, quotas and workspace details.
 * Restored in accordance with customer portal reference design (media_1795424859722_922e09bd.jpg).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  Check,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { changeUserPassword } from '../../../lib/authStore'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import { DISPLAY_NAME_MAX, updateDisplayName } from '../data/serviceClients'
import { formatDate, formatInteger, humaniseCode, selectProfileSummary, toFiniteNumber } from '../data/selectors'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { CONSOLE_BASE, getSection } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { Field, InlineStatus, TextInput } from '../ui/controls'
import { Button, ButtonLink, Card, CardHeader, StatusPill } from '../ui/primitives'
import { ErrorState, LoadingBlock } from '../ui/states'

export const SETTINGS_STORAGE_KEY = 'inferxe_workspace_settings_v1'

export interface WorkspaceSettingsData {
  spendingLimit: string
  corsOrigins: string
  spendingAlerts: boolean
  weeklyReport: boolean
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsData = {
  spendingLimit: '10000',
  corsOrigins: 'https://app.novatech.ai, http://localhost:3000',
  spendingAlerts: true,
  weeklyReport: false,
}

export function getLocalWorkspaceSettings(): WorkspaceSettingsData {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_WORKSPACE_SETTINGS
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS
  }
}

export function saveLocalWorkspaceSettings(settings: WorkspaceSettingsData): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent('inferxe_workspace_settings_changed', { detail: settings }))
  } catch {}
}

export default function SettingsPage() {
  const section = getSection('settings')
  usePageMeta('Settings & Quotas · Inferxe', section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()

  // ── Workspace Preferences State ──
  const [prefs, setPrefs] = useState<WorkspaceSettingsData>(() => getLocalWorkspaceSettings())
  const [spendingLimit, setSpendingLimit] = useState(prefs.spendingLimit)
  const [corsOrigins, setCorsOrigins] = useState(prefs.corsOrigins)
  const [spendingAlerts, setSpendingAlerts] = useState(prefs.spendingAlerts)
  const [weeklyReport, setWeeklyReport] = useState(prefs.weeklyReport)
  const [prefsSuccess, setPrefsSuccess] = useState<string | null>(null)

  // ── Password Form State ──
  const profileEmail = workspace?.profile.email ?? 'vegantisahith@gmail.com'
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)

  // ── Legacy Profile State (for backwards-compatibility & tests) ──
  const profile = workspace ? selectProfileSummary(workspace) : null
  const savedName = workspace?.profile.full_name ?? ''
  const [displayName, setDisplayName] = useState(savedName)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileResult, setProfileResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => setDisplayName(savedName), [savedName])

  // Password validation rules
  const pwdRules = useMemo(() => {
    const minLen = newPassword.length >= 8
    const hasNumOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword)
    const matches = Boolean(confirmPassword && newPassword === confirmPassword)
    return { minLen, hasNumOrSymbol, matches }
  }, [newPassword, confirmPassword])

  // Handle Save Preferences
  const handleSavePreferences = (e: FormEvent) => {
    e.preventDefault()
    const updated: WorkspaceSettingsData = {
      spendingLimit: spendingLimit.trim() || '10000',
      corsOrigins: corsOrigins.trim() || 'https://app.novatech.ai, http://localhost:3000',
      spendingAlerts,
      weeklyReport,
    }
    setPrefs(updated)
    saveLocalWorkspaceSettings(updated)
    setPrefsSuccess('Workspace preferences saved successfully.')
    setTimeout(() => setPrefsSuccess(null), 4000)
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
    if (newPassword !== confirmPassword) {
      setPwdError('The new passwords do not match.')
      return
    }
    if (!pwdRules.minLen) {
      setPwdError('New password must be at least 8 characters long.')
      return
    }
    if (!pwdRules.hasNumOrSymbol) {
      setPwdError('New password must include at least one number (0-9) or symbol.')
      return
    }
    if (currentPassword === newPassword) {
      setPwdError('New password must be different from current password.')
      return
    }

    setPwdSubmitting(true)
    const res = await changeUserPassword(profileEmail, currentPassword, newPassword)
    setPwdSubmitting(false)

    if (res.ok) {
      setPwdSuccess('Password changed. Use your new password next time you sign in.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      setPwdError(res.error || 'Failed to update password. Please check your credentials.')
    }
  }

  // Handle Profile Display Name Submit (for stage3 compatibility)
  const trimmedName = displayName.trim()
  const nameInvalid =
    trimmedName.length === 0
      ? 'Display name cannot be empty.'
      : trimmedName.length > DISPLAY_NAME_MAX
      ? `Use ${DISPLAY_NAME_MAX} characters or fewer.`
      : null
  const nameDirty = trimmedName !== savedName.trim()

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (nameInvalid || !nameDirty) return
    setSavingProfile(true)
    setProfileResult(null)
    try {
      await updateDisplayName(trimmedName)
      setProfileResult({ tone: 'success', text: 'Display name updated.' })
      refresh()
    } catch (err) {
      setProfileResult({
        tone: 'error',
        text: err instanceof CustomerApiError ? err.message : 'Your display name could not be updated.',
      })
    } finally {
      setSavingProfile(false)
    }
  }

  const org = profile?.organization ?? null
  const policy = workspace?.user_access_policies[0] ?? null
  const spendLimit = toFiniteNumber(policy?.monthly_spend_limit)
  const rateLimit = toFiniteNumber(policy?.rate_limit)

  return (
    <div className="cx-settings-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">Settings &amp; Quotas</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>Settings &amp; Quotas</h1>
          <p className="cx-page-header__desc">
            Configure demo preferences, quotas and workspace details.
          </p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to={CONSOLE_BASE} variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {state.status === 'error' && !workspace ? (
        <Card>
          <ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="your settings" />
        </Card>
      ) : (
        <>
          {/* ── Main Two-Column Grid: Workspace Preferences & Password (media_1795424859722_922e09bd.jpg) ── */}
          <div className="cx-settings-grid">
            {/* Left Card: Workspace Preferences & Security */}
            <Card className="cx-settings-card">
              <div className="cx-card-header-row">
                <div className="cx-card-title-icon-wrap">
                  <h3>Workspace Preferences &amp; Security</h3>
                </div>
                <StatusPill tone="neutral">Local settings</StatusPill>
              </div>

              {prefsSuccess && (
                <div className="cx-alert cx-alert--success" role="status">
                  <Check size={15} style={{ flexShrink: 0 }} />
                  <span>{prefsSuccess}</span>
                </div>
              )}

              <form className="cx-settings-form" onSubmit={handleSavePreferences}>
                <div className="cx-settings-row-2col">
                  {/* Monthly Spending Limit */}
                  <div className="cx-field">
                    <label htmlFor="cx-monthly-limit">Monthly Spending Limit (₹)</label>
                    <input
                      id="cx-monthly-limit"
                      type="text"
                      className="cx-input"
                      value={spendingLimit}
                      onChange={(e) => setSpendingLimit(e.target.value)}
                      placeholder="10000"
                    />
                  </div>

                  {/* Allowed API CORS Origins */}
                  <div className="cx-field">
                    <label htmlFor="cx-cors-origins">Allowed API CORS Origins</label>
                    <input
                      id="cx-cors-origins"
                      type="text"
                      className="cx-input"
                      value={corsOrigins}
                      onChange={(e) => setCorsOrigins(e.target.value)}
                      placeholder="https://app.novatech.ai, http://localhost:3000"
                    />
                  </div>
                </div>

                {/* Spending & Over-quota Notifications */}
                <div className="cx-settings-check-box">
                  <div className="cx-settings-check-info">
                    <h4>Spending &amp; Over-quota Notifications</h4>
                    <p>Receive email alerts when usage approaches 80% and 100% of budget.</p>
                  </div>
                  <input
                    type="checkbox"
                    id="cx-spending-alerts"
                    checked={spendingAlerts}
                    onChange={(e) => setSpendingAlerts(e.target.checked)}
                    className="cx-settings-checkbox"
                    aria-label="Spending & Over-quota Notifications"
                  />
                </div>

                {/* Weekly Summary Telemetry Report */}
                <div className="cx-settings-check-box">
                  <div className="cx-settings-check-info">
                    <h4>Weekly Summary Telemetry Report</h4>
                    <p>Aggregated latency, token counts and spend emailed weekly.</p>
                  </div>
                  <input
                    type="checkbox"
                    id="cx-weekly-report"
                    checked={weeklyReport}
                    onChange={(e) => setWeeklyReport(e.target.checked)}
                    className="cx-settings-checkbox"
                    aria-label="Weekly Summary Telemetry Report"
                  />
                </div>

                {/* Notice linking to Users Directory */}
                <div className="cx-settings-notice">
                  <ShieldCheck size={16} className="cx-accent-icon" />
                  <span>
                    Organization user accounts and role definitions can be managed in the{' '}
                    <Link to="/dashboard/users" className="cx-link-underlined">
                      Users Directory
                    </Link>.
                  </span>
                </div>

                {/* Action Button */}
                <div className="cx-form-actions" style={{ marginTop: 14 }}>
                  <Button variant="primary" type="submit" className="cx-save-prefs-btn">
                    Save Preferences
                  </Button>
                </div>
              </form>
            </Card>

            {/* Right Card: Change Account Password */}
            <Card className="cx-settings-card">
              <div className="cx-card-header-row">
                <div className="cx-card-title-icon-wrap">
                  <Lock size={16} className="cx-accent-icon" />
                  <h3>Change Account Password</h3>
                </div>
                <StatusPill tone="neutral">Default Credentials</StatusPill>
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
                    <label htmlFor="cx-settings-pwd-current">Current Password</label>
                    <small className="cx-required-badge">Required</small>
                  </div>
                  <div className="cx-input-wrap">
                    <input
                      id="cx-settings-pwd-current"
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
                    <label htmlFor="cx-settings-pwd-new">New Password</label>
                  </div>
                  <div className="cx-input-wrap">
                    <input
                      id="cx-settings-pwd-new"
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
                </div>

                {/* Confirm New Password Field */}
                <div className="cx-field">
                  <div className="cx-field-label-row">
                    <label htmlFor="cx-settings-pwd-confirm">Confirm New Password</label>
                  </div>
                  <div className="cx-input-wrap">
                    <input
                      id="cx-settings-pwd-confirm"
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
                  <div className={`cx-pwd-check-item ${pwdRules.minLen ? 'is-valid' : ''}`}>
                    <span className="cx-pwd-check-dot">{pwdRules.minLen ? '✓' : '•'}</span>
                    <span>At least 8 characters long</span>
                  </div>
                  <div className={`cx-pwd-check-item ${pwdRules.hasNumOrSymbol ? 'is-valid' : ''}`}>
                    <span className="cx-pwd-check-dot">{pwdRules.hasNumOrSymbol ? '✓' : '•'}</span>
                    <span>Includes at least one number (0-9) or symbol</span>
                  </div>
                  <div className={`cx-pwd-check-item ${pwdRules.matches ? 'is-valid' : ''}`}>
                    <span className="cx-pwd-check-dot">{pwdRules.matches ? '✓' : '•'}</span>
                    <span>New password and confirmation match</span>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="cx-form-actions" style={{ marginTop: 14 }}>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={pwdSubmitting}
                    className="cx-update-pwd-btn"
                  >
                    <Lock size={14} />
                    {pwdSubmitting ? 'Updating Password…' : 'Update password'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {/* ── Organization & Profile Overview (for complete platform management & test compatibility) ── */}
          <div className="cx-grid cx-grid--2" style={{ marginTop: 20 }}>
            {/* Display Name Card */}
            <Card aria-labelledby="cx-profile-title">
              <CardHeader
                id="cx-profile-title"
                title={<span className="cx-title-icon"><UserRound size={17} aria-hidden="true" /> Profile Details</span>}
                description="How you appear across the Inferxe console"
              />
              {!profile ? (
                <LoadingBlock lines={3} label="Loading profile" />
              ) : (
                <form className="cx-form" onSubmit={handleProfileSubmit} noValidate>
                  <Field label="Display name" error={nameDirty ? nameInvalid : null} hint="Shown in the console and on your organization.">
                    {({ inputId, describedBy, invalid: isInvalid }) => (
                      <TextInput
                        id={inputId}
                        value={displayName}
                        onChange={(e) => {
                          setDisplayName(e.target.value)
                          setProfileResult(null)
                        }}
                        maxLength={DISPLAY_NAME_MAX}
                        autoComplete="name"
                        aria-describedby={describedBy}
                        aria-invalid={isInvalid}
                      />
                    )}
                  </Field>
                  <Field label="Email" hint="Your sign-in email is managed by your Inferxe account.">
                    {({ inputId, describedBy }) => (
                      <TextInput id={inputId} value={profile.email ?? ''} readOnly aria-describedby={describedBy} />
                    )}
                  </Field>
                  {profileResult ? <InlineStatus tone={profileResult.tone}>{profileResult.text}</InlineStatus> : null}
                  <div className="cx-form__actions">
                    <Button variant="primary" type="submit" disabled={savingProfile || !nameDirty || Boolean(nameInvalid)}>
                      {savingProfile ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                </form>
              )}
            </Card>

            {/* Organization & Account Status Card */}
            <Card aria-labelledby="cx-org-title">
              <CardHeader
                id="cx-org-title"
                title={<span className="cx-title-icon"><Building2 size={17} aria-hidden="true" /> Organization &amp; Account</span>}
                description="Status and limits"
              />
              {!workspace ? (
                <LoadingBlock lines={3} label="Loading organization" />
              ) : (
                <dl className="cx-kv">
                  <dt>Organization Name</dt>
                  <dd>{org?.name ?? 'Customer Workspace'}</dd>
                  <dt>Status</dt>
                  <dd>
                    <StatusPill tone={profile?.isActive ? 'success' : 'warning'} dot>
                      {profile?.isActive ? 'Active' : humaniseCode(profile?.status) || 'Inactive'}
                    </StatusPill>
                  </dd>
                  <dt>Account limits</dt>
                  <dd>
                    {!policy
                      ? 'Default limits'
                      : [
                          spendLimit !== null ? `Monthly spend limit ${formatInteger(spendLimit)}` : null,
                          rateLimit !== null ? `Rate limit ${formatInteger(rateLimit)}` : null,
                        ].filter(Boolean).join(' · ') || 'Default limits'}
                  </dd>
                  <dt>Created</dt>
                  <dd>{org?.created_at ? formatDate(org.created_at) : 'Active'}</dd>
                </dl>
              )}
              <div className="cx-form__actions cx-form__actions--start" style={{ marginTop: 14 }}>
                <Button
                  variant="danger"
                  disabled={signingOut}
                  onClick={() => {
                    setSigningOut(true)
                    void signOutToLogin()
                  }}
                >
                  <LogOut size={15} /> {signingOut ? 'Signing out…' : 'Sign out'}
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
