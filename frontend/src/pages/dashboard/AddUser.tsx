import { useState, useId, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Sliders,
  User,
  UserCheck,
  X,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import {
  AVAILABLE_MODELS,
  AVAILABLE_PROVIDERS,
  ROLE_DEFINITIONS,
  createUserMock,
} from '../../lib/userStore'
import type {
  AccountStatus,
  AuthMethod,
  ModelAccessType,
  ProviderAccessType,
  UserFormData,
  UserRecord,
  UserRole,
} from '../../types/dashboard'
import { usePageMeta } from '../../lib/hooks'

const PRESET_AVATARS = [
  { id: '1', label: 'Neon Cyber', gradient: 'linear-gradient(135deg, #76b900, #182b0e)', initials: 'CY' },
  { id: '2', label: 'Matrix Dark', gradient: 'linear-gradient(135deg, #1f4023, #0a140d)', initials: 'MX' },
  { id: '3', label: 'Emerald Neural', gradient: 'linear-gradient(135deg, #10b981, #064e3b)', initials: 'NE' },
  { id: '4', label: 'Cyan Tensor', gradient: 'linear-gradient(135deg, #06b6d4, #083344)', initials: 'TN' },
  { id: '5', label: 'Amber Quantum', gradient: 'linear-gradient(135deg, #f59e0b, #451a03)', initials: 'QU' },
]

const SPEND_PRESETS = [
  { label: '₹10,000', value: '10000' },
  { label: '₹25,000', value: '25000' },
  { label: '₹50,000', value: '50000' },
  { label: '₹1,00,000', value: '100000' },
  { label: 'Unlimited', value: '' },
]

const RATE_LIMIT_PRESETS = [
  '60 RPM (Standard Developer)',
  '120 RPM (Production Microservice)',
  '300 RPM (High-Throughput Workload)',
  '600 RPM (Large Scale Cluster)',
  '1,200 RPM (Enterprise Dedicated)',
]

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*+'
  let pwd = 'Inf-'
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return pwd
}

export default function AddUser() {
  usePageMeta('Add New User · Inferxe Dashboard', 'Create an enterprise user account, configure LLM model access, and provision GPU inference marketplace permissions.')
  const navigate = useNavigate()

  // Form State
  const [formData, setFormData] = useState<UserFormData>({
    fullName: '',
    email: '',
    username: '',
    avatarUrl: '',
    role: 'developer',
    status: 'active',
    authMethod: 'invite',
    temporaryPassword: generateSecurePassword(),
    sendInviteEmail: true,
    requirePasswordChange: true,
    modelAccess: 'all',
    selectedModels: ['deepseek-r1-671b', 'llama-3.3-70b', 'qwen-2.5-coder-32b'],
    providerAccess: 'all',
    selectedProviders: ['yotta-nm1', 'e2e-delhi'],
    apiAccess: true,
    analyticsAccess: true,
    monthlySpendLimit: '50000',
    rateLimit: '120 RPM (Production Microservice)',
    internalNote: '',
  })

  // Selected avatar style
  const [selectedAvatarPreset, setSelectedAvatarPreset] = useState<string>('1')

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Form submission state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState<UserRecord | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  // Password UI
  const [showPassword, setShowPassword] = useState(false)
  const [copiedPwd, setCopiedPwd] = useState(false)

  // Unsaved changes confirmation dialog
  const [showConfirmLeave, setShowConfirmLeave] = useState(false)
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null)

  // Track if user modified any field
  const [isDirty, setIsDirty] = useState(false)

  // Unique IDs for accessibility
  const fullNameId = useId()
  const emailId = useId()
  const usernameId = useId()
  const spendLimitId = useId()
  const rateLimitId = useId()
  const noteId = useId()

  const handleFieldChange = <K extends keyof UserFormData>(field: K, value: UserFormData[K]) => {
    setIsDirty(true)
    const next = { ...formData, [field]: value }
    setFormData(next)

    // Clear error for field if fixed
    if (touched[field]) {
      const fieldErrors = validateField(field, value)
      setErrors((prev) => {
        const copy = { ...prev }
        if (!fieldErrors) {
          delete copy[field]
        } else {
          copy[field] = fieldErrors
        }
        return copy
      })
    }
  }

  const handleBlur = (field: keyof UserFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    const err = validateField(field, formData[field])
    if (err) {
      setErrors((prev) => ({ ...prev, [field]: err }))
    } else {
      setErrors((prev) => {
        const copy = { ...prev }
        delete copy[field]
        return copy
      })
    }
  }

  const validateField = (field: keyof UserFormData, value: unknown): string | null => {
    if (field === 'fullName') {
      if (typeof value !== 'string' || !value.trim()) return 'Full name is required.'
      if (value.trim().length < 2) return 'Full name must be at least 2 characters.'
    }
    if (field === 'email') {
      if (typeof value !== 'string' || !value.trim()) return 'Work email address is required.'
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
      if (!emailRegex.test(value.trim())) return 'Please provide a valid email format (e.g., name@company.com).'
    }
    if (field === 'monthlySpendLimit') {
      if (typeof value === 'string' && value.trim() !== '') {
        const clean = Number(value.replace(/[^0-9.]/g, ''))
        if (isNaN(clean) || clean < 0) return 'Spending limit must be a valid positive amount.'
      }
    }
    return null
  }

  const validateAll = (): boolean => {
    const newErrors: Record<string, string> = {}
    const nameErr = validateField('fullName', formData.fullName)
    if (nameErr) newErrors.fullName = nameErr

    const emailErr = validateField('email', formData.email)
    if (emailErr) newErrors.email = emailErr

    const spendErr = validateField('monthlySpendLimit', formData.monthlySpendLimit)
    if (spendErr) newErrors.monthlySpendLimit = spendErr

    setErrors(newErrors)
    setTouched({
      fullName: true,
      email: true,
      monthlySpendLimit: true,
    })
    return Object.keys(newErrors).length === 0
  }

  // Handle Create User
  const handleSubmit = async (e: FormEvent, addAnother = false) => {
    e.preventDefault()
    setApiError(null)

    if (!validateAll()) {
      // Scroll to the first error
      const firstErr = document.querySelector('.dash-input.is-error')
      firstErr?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setIsSubmitting(true)

    try {
      const res = await createUserMock(formData)
      if (res.ok && res.user) {
        setSubmitSuccess(res.user)
        setIsDirty(false)

        if (addAnother) {
          // Reset form for adding another user
          setFormData({
            fullName: '',
            email: '',
            username: '',
            avatarUrl: '',
            role: 'developer',
            status: 'active',
            authMethod: 'invite',
            temporaryPassword: generateSecurePassword(),
            sendInviteEmail: true,
            requirePasswordChange: true,
            modelAccess: 'all',
            selectedModels: ['deepseek-r1-671b', 'llama-3.3-70b', 'qwen-2.5-coder-32b'],
            providerAccess: 'all',
            selectedProviders: ['yotta-nm1', 'e2e-delhi'],
            apiAccess: true,
            analyticsAccess: true,
            monthlySpendLimit: '50000',
            rateLimit: '120 RPM (Production Microservice)',
            internalNote: '',
          })
          setErrors({})
          setTouched({})
          // Keep submitSuccess toast visible
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } else {
          // Normal submit: stay or allow navigating to users
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      } else {
        setApiError(res.error || 'Failed to create user. Please verify organization capacity.')
      }
    } catch {
      setApiError('An unexpected server error occurred while processing your request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Cancel / Back Navigation
  const requestLeave = (action: () => void) => {
    if (isDirty) {
      setPendingLeaveAction(() => action)
      setShowConfirmLeave(true)
    } else {
      action()
    }
  }

  // Toggle model selection
  const toggleModel = (modelId: string) => {
    const list = formData.selectedModels
    if (list.includes(modelId)) {
      handleFieldChange(
        'selectedModels',
        list.filter((m) => m !== modelId),
      )
    } else {
      handleFieldChange('selectedModels', [...list, modelId])
    }
  }

  // Toggle provider selection
  const toggleProvider = (providerId: string) => {
    const list = formData.selectedProviders
    if (list.includes(providerId)) {
      handleFieldChange(
        'selectedProviders',
        list.filter((p) => p !== providerId),
      )
    } else {
      handleFieldChange('selectedProviders', [...list, providerId])
    }
  }

  // Copy password to clipboard
  const handleCopyPassword = () => {
    navigator.clipboard.writeText(formData.temporaryPassword)
    setCopiedPwd(true)
    setTimeout(() => setCopiedPwd(false), 2000)
  }

  // Calculate password strength
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, label: 'Empty', color: 'transparent' }
    let score = 0
    if (pwd.length >= 8) score++
    if (pwd.length >= 14) score++
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++
    if (/[0-9]/.test(pwd)) score++
    if (/[^A-Za-z0-9]/.test(pwd)) score++

    if (score <= 2) return { score: 25, label: 'Weak', color: '#ff6b5e' }
    if (score <= 3) return { score: 60, label: 'Fair', color: '#f2b84b' }
    if (score <= 4) return { score: 85, label: 'Strong', color: '#9be015' }
    return { score: 100, label: 'Enterprise Strong', color: '#76b900' }
  }

  const pwdStrength = getPasswordStrength(formData.temporaryPassword)

  // Current active avatar preset styling
  const activeAvatar = PRESET_AVATARS.find((a) => a.id === selectedAvatarPreset) || PRESET_AVATARS[0]

  return (
    <DashboardLayout
      pageTitle="Add New User"
      breadcrumb={[
        { label: 'Dashboard', to: '/dashboard' },
        { label: 'Users', to: '/dashboard/users' },
        { label: 'Add User' },
      ]}
      heading="Add New User"
      description="Create a user account and configure marketplace access."
      backButtonTo="/dashboard/users"
      backButtonLabel="Back to Users"
      onBackClick={() => requestLeave(() => navigate('/dashboard/users'))}
    >
      {/* ── Success Notification ────────────────────────────── */}
      {submitSuccess && (
        <div className="dash-success-banner" role="status" aria-live="polite">
          <div className="dash-success-icon">
            <CheckCircle2 />
          </div>
          <div className="dash-success-body">
            <h2 className="dash-success-title">
              User account successfully created!
            </h2>
            <p className="dash-success-text">
              <strong>{submitSuccess.fullName}</strong> ({submitSuccess.email}) has been provisioned as{' '}
              <span className="dash-topbar__badge" style={{ padding: '1px 8px', textTransform: 'capitalize' }}>
                {submitSuccess.role}
              </span>{' '}
              with User ID <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand-hi)' }}>{submitSuccess.id}</code>.
              {submitSuccess.authMethod === 'invite'
                ? ' An onboarding invitation email with access tokens has been dispatched.'
                : ' A temporary password was created.'}
            </p>
            <div className="dash-success-actions">
              <button
                type="button"
                className="dash-success-link"
                onClick={() => navigate('/dashboard/users')}
              >
                <span>View in Users Directory</span>
                <ArrowRight size={13} />
              </button>
              <button
                type="button"
                className="dash-btn-ghost"
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={() => setSubmitSuccess(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            className="dash-icon-btn"
            onClick={() => setSubmitSuccess(null)}
            aria-label="Close notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Server / API Error Alert ────────────────────────── */}
      {apiError && (
        <div
          className="dash-success-banner"
          style={{
            background: 'rgba(255, 107, 94, 0.1)',
            borderColor: 'rgba(255, 107, 94, 0.4)',
            boxShadow: 'none',
          }}
          role="alert"
        >
          <div className="dash-success-icon" style={{ background: 'var(--red)', color: '#fff' }}>
            <AlertTriangle />
          </div>
          <div className="dash-success-body">
            <div className="dash-success-title" style={{ color: 'var(--red)' }}>
              Action could not be completed
            </div>
            <p className="dash-success-text">{apiError}</p>
          </div>
          <button
            type="button"
            className="dash-icon-btn"
            onClick={() => setApiError(null)}
            aria-label="Close alert"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Add User Form Card ──────────────────────────────── */}
      <form
        className="dash-card glass glass--lift"
        style={{ position: 'relative' }}
        onSubmit={(e) => handleSubmit(e, false)}
        noValidate
        aria-label="Add User Form"
      >

        {/* ── SECTION 1: Basic Information ─────────────────── */}
        <section className="dash-form-section" aria-labelledby="sec-basic-info">
          <div className="dash-section-head">
            <div className="dash-section-icon icon-tile">
              <User />
            </div>
            <div className="dash-section-title-wrap">
              <h2 id="sec-basic-info" className="dash-section-title">
                Basic Information
              </h2>
              <p className="dash-section-desc">
                Identify the team member and set their organization persona.
              </p>
            </div>
          </div>

          <div className="dash-form-grid">
            {/* Full Name */}
            <div className="dash-field">
              <label htmlFor={fullNameId} className="dash-label">
                <span>
                  Full Name <span className="dash-label__req">*</span>
                </span>
              </label>
              <input
                id={fullNameId}
                type="text"
                className={`dash-input ${errors.fullName ? 'is-error' : ''}`}
                placeholder="e.g. Vikram Malhotra"
                value={formData.fullName}
                onChange={(e) => handleFieldChange('fullName', e.target.value)}
                onBlur={() => handleBlur('fullName')}
                aria-required="true"
                aria-invalid={!!errors.fullName}
              />
              {errors.fullName && (
                <div className="dash-field-error">
                  <AlertTriangle /> <span>{errors.fullName}</span>
                </div>
              )}
            </div>

            {/* Email Address */}
            <div className="dash-field">
              <label htmlFor={emailId} className="dash-label">
                <span>
                  Email Address <span className="dash-label__req">*</span>
                </span>
              </label>
              <input
                id={emailId}
                type="email"
                className={`dash-input ${errors.email ? 'is-error' : ''}`}
                placeholder="e.g. vikram.m@enterprise.ai"
                value={formData.email}
                onChange={(e) => {
                  handleFieldChange('email', e.target.value)
                  // Auto-suggest username if blank
                  if (!formData.username && e.target.value.includes('@')) {
                    handleFieldChange('username', e.target.value.split('@')[0])
                  }
                }}
                onBlur={() => handleBlur('email')}
                aria-required="true"
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <div className="dash-field-error">
                  <AlertTriangle /> <span>{errors.email}</span>
                </div>
              )}
            </div>

            {/* Username (Optional) */}
            <div className="dash-field">
              <label htmlFor={usernameId} className="dash-label">
                <span>Username</span>
                <span className="dash-label__opt">(optional)</span>
              </label>
              <div className="dash-input-wrap">
                <span className="dash-input-prefix">@</span>
                <input
                  id={usernameId}
                  type="text"
                  className="dash-input dash-input-has-prefix"
                  placeholder="vikram.m"
                  value={formData.username}
                  onChange={(e) => handleFieldChange('username', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                />
              </div>
              <span className="dash-field-hint">
                Unique system handle used in CLI tokens and inference audit logs.
              </span>
            </div>

            {/* Profile Avatar Picker (Optional) */}
            <div className="dash-field">
              <label className="dash-label">
                <span>Profile Avatar</span>
                <span className="dash-label__opt">(optional)</span>
              </label>
              <div className="dash-avatar-row">
                <div
                  className="dash-avatar-preview"
                  style={{ background: activeAvatar.gradient }}
                  title={activeAvatar.label}
                >
                  {formData.fullName
                    ? formData.fullName
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()
                    : activeAvatar.initials}
                </div>

                <div className="dash-avatar-presets">
                  {PRESET_AVATARS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`dash-avatar-preset-btn ${selectedAvatarPreset === preset.id ? 'is-selected' : ''}`}
                      style={{ background: preset.gradient }}
                      onClick={() => {
                        setSelectedAvatarPreset(preset.id)
                        handleFieldChange('avatarUrl', preset.id)
                      }}
                      title={`Select ${preset.label} avatar`}
                      aria-label={`Select ${preset.label} avatar style`}
                    >
                      {preset.initials}
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: '0.74rem', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                  Preset style
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 2: Account Access ─────────────────────── */}
        <section className="dash-form-section" aria-labelledby="sec-account-access">
          <div className="dash-section-head">
            <div className="dash-section-icon">
              <Lock />
            </div>
            <div className="dash-section-title-wrap">
              <h2 id="sec-account-access" className="dash-section-title">
                Account Access
              </h2>
              <p className="dash-section-desc">
                Define security privileges, role boundaries, and login credentials.
              </p>
            </div>
          </div>

          {/* Role Dropdown / Selector Cards */}
          <div className="dash-field mb-4">
            <label className="dash-label">
              <span>
                Account Role <span className="dash-label__req">*</span>
              </span>
              <span className="dash-label__opt">Select authorization tier</span>
            </label>

            <div className="dash-roles-grid" role="radiogroup" aria-label="Role Selection">
              {(['admin', 'developer', 'viewer'] as UserRole[]).map((role) => {
                const def = ROLE_DEFINITIONS[role]
                const isSelected = formData.role === role
                return (
                  <div
                    key={role}
                    className={`dash-role-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleFieldChange('role', role)}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault()
                        handleFieldChange('role', role)
                      }
                    }}
                  >
                    <div>
                      <div className="dash-role-card__top">
                        <span className="dash-role-card__title">{def.title}</span>
                        <div className="dash-role-card__radio">
                          {isSelected && <span className="dash-role-card__radio-inner" />}
                        </div>
                      </div>
                      <p className="dash-role-card__desc">{def.description}</p>
                    </div>

                    <div className="dash-role-card__perms">
                      {def.permissions.map((p) => (
                        <div key={p} className="dash-role-card__perm-item">
                          <Check />
                          <span>{p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="dash-form-grid mt-4">
            {/* Account Status: Active or Inactive */}
            <div className="dash-field">
              <label className="dash-label">
                <span>Account Status</span>
              </label>
              <div className="dash-segment" role="group" aria-label="Account Status">
                <button
                  type="button"
                  className={`dash-segment-btn ${formData.status === 'active' ? 'is-active' : ''}`}
                  onClick={() => handleFieldChange('status', 'active' as AccountStatus)}
                >
                  <span>Active</span>
                </button>
                <button
                  type="button"
                  className={`dash-segment-btn ${formData.status === 'inactive' ? 'is-active' : ''}`}
                  onClick={() => handleFieldChange('status', 'inactive' as AccountStatus)}
                >
                  <span>Inactive</span>
                </button>
              </div>
              <span className="dash-field-hint">
                Inactive accounts are prevented from authenticating or running inference endpoints.
              </span>
            </div>

            {/* Authentication Method: Email Invitation vs Temporary Password */}
            <div className="dash-field">
              <label className="dash-label">
                <span>Authentication Method</span>
              </label>
              <div className="dash-segment" role="group" aria-label="Authentication Method">
                <button
                  type="button"
                  className={`dash-segment-btn ${formData.authMethod === 'invite' ? 'is-active' : ''}`}
                  onClick={() => handleFieldChange('authMethod', 'invite' as AuthMethod)}
                >
                  <span>Email Invitation</span>
                </button>
                <button
                  type="button"
                  className={`dash-segment-btn ${formData.authMethod === 'password' ? 'is-active' : ''}`}
                  onClick={() => handleFieldChange('authMethod', 'password' as AuthMethod)}
                >
                  <span>Temporary Password</span>
                </button>
              </div>
              <span className="dash-field-hint">
                {formData.authMethod === 'invite'
                  ? 'A cryptographic magic link with 48h validity is sent to activate credentials.'
                  : 'Specify a temporary passphrase for manual delivery or initial machine setup.'}
              </span>
            </div>

            {/* Temporary Password Field (if authMethod is password) */}
            {formData.authMethod === 'password' && (
              <div className="dash-field dash-form-full">
                <label className="dash-label">
                  <span>
                    Temporary Password <span className="dash-label__req">*</span>
                  </span>
                  <button
                    type="button"
                    className="dash-btn-ghost"
                    style={{ padding: '2px 8px', fontSize: '0.7rem', color: 'var(--brand-hi)' }}
                    onClick={() => handleFieldChange('temporaryPassword', generateSecurePassword())}
                  >
                    <RefreshCw size={12} style={{ marginRight: 4 }} /> Generate new
                  </button>
                </label>
                <div className="dash-input-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="dash-input"
                    value={formData.temporaryPassword}
                    onChange={(e) => handleFieldChange('temporaryPassword', e.target.value)}
                    style={{ paddingRight: '76px', fontFamily: 'var(--font-mono)' }}
                  />
                  <div className="dash-pwd-tools">
                    <button
                      type="button"
                      className="dash-icon-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                    <button
                      type="button"
                      className="dash-icon-btn"
                      onClick={handleCopyPassword}
                      title="Copy temporary password"
                      aria-label="Copy temporary password"
                    >
                      {copiedPwd ? <Check style={{ color: 'var(--brand-hi)' }} /> : <Copy />}
                    </button>
                  </div>
                </div>

                {/* Password Strength Meter */}
                <div className="dash-pwd-meter">
                  <div className="dash-pwd-bar-track">
                    <div
                      className="dash-pwd-bar-fill"
                      style={{
                        width: `${pwdStrength.score}%`,
                        backgroundColor: pwdStrength.color,
                      }}
                    />
                  </div>
                  <span className="dash-pwd-strength-label" style={{ color: pwdStrength.color }}>
                    {pwdStrength.label}
                  </span>
                </div>

                <label className="dash-checkbox-label mt-2">
                  <input
                    type="checkbox"
                    className="dash-checkbox-input"
                    checked={formData.requirePasswordChange}
                    onChange={(e) => handleFieldChange('requirePasswordChange', e.target.checked)}
                  />
                  <span className="dash-checkbox-custom">
                    {formData.requirePasswordChange && <Check className="dash-checkbox-check" />}
                  </span>
                  <span>Require user to set a new password on first login</span>
                </label>
              </div>
            )}

            {/* Send Invitation Email Checkbox */}
            <div className="dash-field dash-form-full">
              <label className="dash-checkbox-label">
                <input
                  type="checkbox"
                  className="dash-checkbox-input"
                  checked={formData.sendInviteEmail}
                  onChange={(e) => handleFieldChange('sendInviteEmail', e.target.checked)}
                />
                <span className="dash-checkbox-custom">
                  {formData.sendInviteEmail && <Check className="dash-checkbox-check" />}
                </span>
                <span>Send invitation email with onboarding instructions immediately upon creation</span>
              </label>
            </div>
          </div>
        </section>

        {/* ── SECTION 3: Marketplace Permissions ───────────── */}
        <section className="dash-form-section" aria-labelledby="sec-marketplace-perms">
          <div className="dash-section-head">
            <div className="dash-section-icon">
              <Layers />
            </div>
            <div className="dash-section-title-wrap">
              <h2 id="sec-marketplace-perms" className="dash-section-title">
                Marketplace Permissions
              </h2>
              <p className="dash-section-desc">
                Configure LLM model routing, hardware providers, and API access privileges.
              </p>
            </div>
          </div>

          <div className="dash-form-grid">
            {/* Model Access */}
            <div className="dash-field dash-form-full">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="dash-label">
                  <span>Model Access</span>
                </label>
                <div className="dash-segment" role="group" aria-label="Model Access Tier">
                  <button
                    type="button"
                    className={`dash-segment-btn ${formData.modelAccess === 'all' ? 'is-active' : ''}`}
                    onClick={() => handleFieldChange('modelAccess', 'all' as ModelAccessType)}
                  >
                    <span>All Models</span>
                  </button>
                  <button
                    type="button"
                    className={`dash-segment-btn ${formData.modelAccess === 'selected' ? 'is-active' : ''}`}
                    onClick={() => handleFieldChange('modelAccess', 'selected' as ModelAccessType)}
                  >
                    <span>Selected Models</span>
                  </button>
                </div>
              </div>

              {formData.modelAccess === 'all' ? (
                <div className="dash-field-hint">
                  User has full access to all 80+ hosted models including DeepSeek R1, Llama 3.3, Qwen 2.5, and embedding models.
                </div>
              ) : (
                <div>
                  <div className="dash-pills-wrap">
                    {AVAILABLE_MODELS.map((model) => {
                      const isSelected = formData.selectedModels.includes(model.id)
                      return (
                        <div
                          key={model.id}
                          className={`dash-pill-item ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => toggleModel(model.id)}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              toggleModel(model.id)
                            }
                          }}
                        >
                          {isSelected && <Check size={12} />}
                          <span>{model.name}</span>
                          <span className="dash-pill-tag">{model.tag}</span>
                        </div>
                      )
                    })}
                  </div>
                  <span className="dash-field-hint mt-2">
                    Click models to toggle access. Only enabled models will respond to this user's API calls.
                  </span>
                </div>
              )}
            </div>

            {/* Provider Access */}
            <div className="dash-field dash-form-full">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="dash-label">
                  <span>Provider Access</span>
                </label>
                <div className="dash-segment" role="group" aria-label="Provider Access Tier">
                  <button
                    type="button"
                    className={`dash-segment-btn ${formData.providerAccess === 'all' ? 'is-active' : ''}`}
                    onClick={() => handleFieldChange('providerAccess', 'all' as ProviderAccessType)}
                  >
                    <span>All Providers</span>
                  </button>
                  <button
                    type="button"
                    className={`dash-segment-btn ${formData.providerAccess === 'selected' ? 'is-active' : ''}`}
                    onClick={() => handleFieldChange('providerAccess', 'selected' as ProviderAccessType)}
                  >
                    <span>Selected Providers</span>
                  </button>
                </div>
              </div>

              {formData.providerAccess === 'all' ? (
                <div className="dash-field-hint">
                  Workloads are dynamically scheduled across all verified data centers (Yotta NM1, E2E Cloud, Lambda, RunPod, CoreWeave) based on lowest latency and spot price.
                </div>
              ) : (
                <div>
                  <div className="dash-pills-wrap">
                    {AVAILABLE_PROVIDERS.map((prov) => {
                      const isSelected = formData.selectedProviders.includes(prov.id)
                      return (
                        <div
                          key={prov.id}
                          className={`dash-pill-item ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => toggleProvider(prov.id)}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              toggleProvider(prov.id)
                            }
                          }}
                        >
                          {isSelected && <Check size={12} />}
                          <span>{prov.name}</span>
                          <span className="dash-pill-tag">{prov.latency}</span>
                          <span style={{ fontSize: '0.62rem', color: 'var(--ink-4)' }}>({prov.region.split(',')[0]})</span>
                        </div>
                      )
                    })}
                  </div>
                  <span className="dash-field-hint mt-2">
                    Restrict inference execution to specific sovereign or low-latency cluster partners.
                  </span>
                </div>
              )}
            </div>

            {/* API Access Switch */}
            <div className="dash-switch-row">
              <div className="dash-switch-info">
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <KeyRound size={16} style={{ color: 'var(--brand-hi)' }} />
                  <span className="dash-switch-title">API Access</span>
                </div>
                <span className="dash-switch-desc">
                  Allow user to create API keys (`ix-sk-...`) and invoke `/v1/chat/completions`.
                </span>
              </div>
              <label className="dash-switch">
                <input
                  type="checkbox"
                  checked={formData.apiAccess}
                  onChange={(e) => handleFieldChange('apiAccess', e.target.checked)}
                />
                <span className="dash-switch-slider" />
              </label>
            </div>

            {/* Usage and Analytics Access Switch */}
            <div className="dash-switch-row">
              <div className="dash-switch-info">
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <Globe size={16} style={{ color: 'var(--brand-hi)' }} />
                  <span className="dash-switch-title">Usage & Analytics Access</span>
                </div>
                <span className="dash-switch-desc">
                  Grant visibility into token throughput, p95 TTFT metrics, and team billing.
                </span>
              </div>
              <label className="dash-switch">
                <input
                  type="checkbox"
                  checked={formData.analyticsAccess}
                  onChange={(e) => handleFieldChange('analyticsAccess', e.target.checked)}
                />
                <span className="dash-switch-slider" />
              </label>
            </div>
          </div>
        </section>

        {/* ── SECTION 4: Optional Configuration ─────────────── */}
        <section className="dash-form-section" aria-labelledby="sec-optional-config">
          <div className="dash-section-head">
            <div className="dash-section-icon">
              <Sliders />
            </div>
            <div className="dash-section-title-wrap">
              <h2 id="sec-optional-config" className="dash-section-title">
                Optional Configuration
              </h2>
              <p className="dash-section-desc">
                Set budget guardrails, rate limits, and team administrative notes.
              </p>
            </div>
          </div>

          <div className="dash-form-grid">
            {/* Monthly Spending Limit (₹) */}
            <div className="dash-field">
              <label htmlFor={spendLimitId} className="dash-label">
                <span>Monthly Spending Limit</span>
                <span className="dash-label__opt">INR (₹)</span>
              </label>
              <div className="dash-input-wrap">
                <span className="dash-input-prefix">₹</span>
                <input
                  id={spendLimitId}
                  type="text"
                  className={`dash-input dash-input-has-prefix ${errors.monthlySpendLimit ? 'is-error' : ''}`}
                  placeholder="e.g. 50000"
                  value={formData.monthlySpendLimit}
                  onChange={(e) => handleFieldChange('monthlySpendLimit', e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={() => handleBlur('monthlySpendLimit')}
                />
              </div>

              {/* Spend Presets */}
              <div className="dash-presets-row">
                {SPEND_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`dash-preset-chip ${formData.monthlySpendLimit === p.value ? 'is-active' : ''}`}
                    onClick={() => handleFieldChange('monthlySpendLimit', p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {errors.monthlySpendLimit && (
                <div className="dash-field-error">
                  <AlertTriangle /> <span>{errors.monthlySpendLimit}</span>
                </div>
              )}
              <span className="dash-field-hint">
                Inference queries will pause or trigger alerting if this threshold is hit within a calendar month.
              </span>
            </div>

            {/* Rate Limit or Request Quota */}
            <div className="dash-field">
              <label htmlFor={rateLimitId} className="dash-label">
                <span>Rate Limit Quota</span>
                <span className="dash-label__opt">Requests per minute</span>
              </label>
              <select
                id={rateLimitId}
                className="select"
                value={formData.rateLimit}
                onChange={(e) => handleFieldChange('rateLimit', e.target.value)}
              >
                {RATE_LIMIT_PRESETS.map((rl) => (
                  <option key={rl} value={rl}>
                    {rl}
                  </option>
                ))}
              </select>
              <span className="dash-field-hint">
                Controls the maximum concurrent token throughput and requests allowed per minute.
              </span>
            </div>

            {/* Short Internal Note */}
            <div className="dash-field dash-form-full">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor={noteId} className="dash-label">
                  <span>Internal Administrative Note</span>
                  <span className="dash-label__opt">(optional)</span>
                </label>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--ink-4)' }}>
                  {formData.internalNote.length} / 500
                </span>
              </div>
              <textarea
                id={noteId}
                className="textarea"
                style={{ minHeight: '90px' }}
                placeholder="e.g. Onboarded for RAG pipeline evaluation on Yotta H100 cluster. Sponsored by AI Platform Team."
                value={formData.internalNote}
                maxLength={500}
                onChange={(e) => handleFieldChange('internalNote', e.target.value)}
              />
              <span className="dash-field-hint">
                Only visible to organization administrators in team audits and compliance reports.
              </span>
            </div>
          </div>
        </section>

        {/* ── SECTION 5: Buttons and Actions ────────────────── */}
        <div className="dash-actions-bar">
          <button
            type="button"
            className="dash-btn-ghost"
            onClick={() => requestLeave(() => navigate('/dashboard/users'))}
          >
            Cancel
          </button>

          <div className="dash-actions-group">
            <button
              type="button"
              className="dash-btn-secondary"
              disabled={isSubmitting}
              onClick={(e) => handleSubmit(e, true)}
            >
              <Plus size={16} />
              <span>Create & Add Another</span>
            </button>

            <button
              type="submit"
              className="dash-btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Provisioning Account...</span>
                </>
              ) : (
                <>
                  <UserCheck size={16} />
                  <span>Create User</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ── Unsaved Changes Confirmation Modal ────────────── */}
      {showConfirmLeave && (
        <div className="dash-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="dash-modal">
            <div className="dash-modal__header">
              <div className="dash-modal__icon-warn">
                <AlertTriangle size={20} />
              </div>
              <h2 id="modal-title" className="dash-modal__title">
                Discard unsaved changes?
              </h2>
            </div>
            <p className="dash-modal__desc">
              You have entered information in the Add User form. If you navigate away now, all changes and configured permissions will be discarded.
            </p>
            <div className="dash-modal__actions">
              <button
                type="button"
                className="dash-btn-secondary"
                onClick={() => {
                  setShowConfirmLeave(false)
                  setPendingLeaveAction(null)
                }}
              >
                Keep Editing
              </button>
              <button
                type="button"
                className="dash-btn-danger"
                onClick={() => {
                  setShowConfirmLeave(false)
                  setIsDirty(false)
                  if (pendingLeaveAction) pendingLeaveAction()
                }}
              >
                Discard & Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
