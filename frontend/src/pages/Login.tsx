import { useState, useEffect, useId, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'

import { saveSession, loginAdminBackend } from '../lib/authStore'
import { recordUserRegistration } from '../lib/userStore'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Github,
  Loader2,
  Lock,
  Mail,
  User,
} from 'lucide-react'
import { Logo } from '../components/Logo'
import { usePageMeta } from '../lib/hooks'

interface LoginProps {
  initialMode?: 'login' | 'signup' | 'forgot'
}



export default function Login({ initialMode }: LoginProps) {
  const location = useLocation()
  const navigate = useNavigate()


  // Determine mode from the current route
  const currentPath = location.pathname
  const mode: 'login' | 'signup' | 'forgot' =
    initialMode ||
    (currentPath === '/signup'
      ? 'signup'
      : currentPath === '/forgot-password'
        ? 'forgot'
        : 'login')

  usePageMeta(
    mode === 'signup'
      ? 'Create Organization Account · Inferxe'
      : mode === 'forgot'
        ? 'Reset Password · Inferxe'
        : 'Sign in to Inferxe Console',
    'Sign in to your Inferxe enterprise dashboard to manage GPU deployments and LLM inference marketplace workloads.',
  )

  // Form fields
  const [email, setEmail] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return params.get('email') || ''
    }
    return ''
  })
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [organization, setOrganization] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [rememberMe, setRememberMe] = useState(true)
  const [agreeTerms, setAgreeTerms] = useState(true)

  // UI state
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('verified') === '1') {
        return 'Email verified successfully! You can now sign in with your email and password.'
      }
      if (params.get('registered') === '1') {
        return 'Account registered successfully! You can now sign in with your email and password.'
      }
    }
    return null
  })
  const [resetSent, setResetSent] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  // Handle SSO OAuth callback redirects (?sso=1&provider=github/google)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('sso') === '1' || params.get('sso') === 'github' || params.get('sso') === 'google') {
      const provider = params.get('provider') || params.get('sso') || 'SSO'
      const ssoEmail = params.get('email') || `${provider.toLowerCase()}.user@inferxe.com`
      const ssoName = params.get('name') || `${provider.toUpperCase()} User`
      const ssoToken = params.get('token') || `ix-sso-${Math.random().toString(36).substring(2, 10)}`

      saveSession({
        token: ssoToken,
        user: {
          id: `usr_${ssoEmail.split('@')[0]}`,
          fullName: ssoName,
          email: ssoEmail,
          username: ssoEmail.split('@')[0],
          role: 'customer',
          organization: `${provider.toUpperCase()} Workspace`,
        },
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      })

      navigate('/dashboard/customer')
    }
  }, [navigate])

  const emailId = useId()
  const passwordId = useId()
  const nameId = useId()
  const orgId = useId()

  const handleDemoLogin = async () => {
    setError(null)
    setSuccess(null)

    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError('Please provide a valid email address.')
      return
    }
    if (password.length < 6) {
      setError('Password must contain at least 6 characters.')
      return
    }

    let registeredUsers: Record<string, { passwordHash?: string; fullName?: string; organization?: string }> = {}
    try {
      const raw = localStorage.getItem('inferxe_registered_users')
      if (raw) registeredUsers = JSON.parse(raw)
    } catch (err) {
      console.error('Unable to read local demo accounts:', err)
      setError('Unable to read local accounts in this browser.')
      return
    }

    const existingUser = registeredUsers[cleanEmail]
    if (existingUser?.passwordHash && existingUser.passwordHash !== password) {
      setError('Incorrect password for this local demo account.')
      return
    }

    const accountName = existingUser?.fullName || cleanEmail.split('@')[0]
    if (!existingUser) {
      registeredUsers[cleanEmail] = {
        fullName: accountName,
        passwordHash: password,
        organization: 'Demo Workspace',
      }
      try {
        localStorage.setItem('inferxe_registered_users', JSON.stringify(registeredUsers))
      } catch (err) {
        console.error('Unable to save local demo account:', err)
        setError('Unable to save this demo account in your browser.')
        return
      }
    }

    saveSession({
      token: `ix-demo-${Math.random().toString(36).substring(2, 10)}`,
      user: {
        id: `usr_${cleanEmail.split('@')[0]}`,
        fullName: accountName,
        email: cleanEmail,
        username: cleanEmail.split('@')[0],
        role: 'customer',
        organization: existingUser?.organization || 'Demo Workspace',
      },
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
    navigate('/dashboard/customer')
  }

  const handleSocialLogin = (provider: 'GitHub' | 'Google') => {
    setError(null)
    setIsSubmitting(true)

    if (provider === 'GitHub') {
      const customClientId = (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined)?.trim()
      if (customClientId) {
        const callbackUrl = `${window.location.origin}/api/auth/callback/github`
        window.location.href = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
          customClientId,
        )}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read:user%20user:email`
      } else {
        window.location.href = '/api/auth/github'
      }
      return
    }

    if (provider === 'Google') {
      const customClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()
      if (customClientId) {
        const callbackUrl = `${window.location.origin}/api/auth/callback/google`
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
          customClientId,
        )}&redirect_uri=${encodeURIComponent(
          callbackUrl,
        )}&response_type=code&scope=openid%20profile%20email&prompt=select_account`
      } else {
        window.location.href = '/api/auth/google'
      }
      return
    }
  }

  // Demo customer accounts are kept in this browser; admin credentials stay server-validated.
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const username = email.trim().toLowerCase()

      if (mode === 'login') {
        if (!username || !password) {
          setError('Please enter your email and password.')
          return
        }

        // Validate credentials against the server-side admin authentication endpoint
        const adminResult = await loginAdminBackend(username, password)

        if (adminResult.isAdmin) {
          if (adminResult.ok) {
            // Valid admin credentials: authenticate and open Admin Portal
            navigate('/dashboard')
            return
          } else {
            // Invalid admin credentials or rate-limited: display server error
            setError(adminResult.error || 'Incorrect email or password.')
            return
          }
        }

        await handleDemoLogin()
        return
      }

      if (mode === 'signup') {
        if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(username)) {
          setError('Please provide a valid email address.')
          return
        }
        if (!fullName.trim()) {
          setError('Full name is required.')
          return
        }
        if (password.length < 6) {
          setError('Password must contain at least 6 characters.')
          return
        }
        if (!agreeTerms) {
          setError('Please agree to the Inferxe Terms of Service to continue.')
          return
        }

        const cleanEmail = email.trim().toLowerCase()

        try {
          const raw = localStorage.getItem('inferxe_registered_users')
          const registered = raw ? JSON.parse(raw) : {}
          registered[cleanEmail] = {
            fullName: fullName.trim(),
            email: cleanEmail,
            passwordHash: password,
            organization: organization.trim() || 'Customer Workspace',
            phone: `${countryCode}${phoneNumber.trim()}`,
            createdAt: new Date().toISOString(),
          }
          localStorage.setItem('inferxe_registered_users', JSON.stringify(registered))
          recordUserRegistration({
            fullName: fullName.trim(),
            email: cleanEmail,
            username: cleanEmail.split('@')[0],
            organization: organization.trim() || 'Customer Workspace',
          })
        } catch (err) {
          console.error('Failed to store customer locally:', err)
          setError('Unable to create a demo account in this browser.')
          return
        }
        navigate(`/login?registered=1&email=${encodeURIComponent(cleanEmail)}`)
        return
      }

      if (mode === 'forgot') {
        if (!resetSent) {
          if (!username) {
            setError('Enter your email address first.')
            return
          }
          let registered: Record<string, { passwordHash?: string }> = {}
          try {
            const raw = localStorage.getItem('inferxe_registered_users')
            registered = raw ? JSON.parse(raw) : {}
          } catch (err) {
            console.error('Unable to read local demo accounts:', err)
            setError('Unable to read local accounts in this browser.')
            return
          }
          if (!registered[username]) {
            setError('No local demo account exists for this email.')
            return
          }
          setResetSent(true)
          setSuccess('Choose a new password for this local demo account.')
        } else {
          if (newPassword.length < 6) {
            setError('Enter a new password of at least 6 characters.')
            return
          }
          try {
            const raw = localStorage.getItem('inferxe_registered_users')
            const registered = raw ? JSON.parse(raw) as Record<string, { passwordHash?: string }> : {}
            if (!registered[username]) {
              setError('No local demo account exists for this email.')
              return
            }
            registered[username].passwordHash = newPassword
            localStorage.setItem('inferxe_registered_users', JSON.stringify(registered))
          } catch (err) {
            console.error('Unable to update local demo password:', err)
            setError('Unable to update the password in this browser.')
            return
          }
          setResetSent(false)
          setNewPassword('')
          navigate(`/login?registered=1&email=${encodeURIComponent(username)}`)
        }
      }
    } catch (err: any) {
      console.error('Authentication error:', err)
      setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <img
        className="auth-page__bg"
        src="/images/gpu-cards.webp"
        alt=""
        loading="lazy"
        aria-hidden="true"
      />
      <div className="auth-page__shade" />

      <div className="auth-container">
        {/* Header / Brand */}
        <div className="auth-header">
          <Link
            to="/"
            className="row"
            style={{ justifyContent: 'center', marginBottom: 14 }}
          >
            <Logo size={34} />
          </Link>

          <h1 className="auth-title">
            {mode === 'signup'
              ? 'Create your account'
              : mode === 'forgot'
                ? 'Reset your password'
                : 'Sign in to Inferxe'}
          </h1>

          <p className="auth-subtitle">
            {mode === 'signup'
              ? 'Create a local demo account in this browser.'
              : mode === 'forgot'
                ? 'Reset the password for a local demo account.'
                : 'Demo mode: enter any valid email and password to continue.'}
          </p>
        </div>

        {/* Card */}
        <div className="auth-card">
          <form
            onSubmit={handleSubmit}
            className="auth-form"
            noValidate
          >
              {/* Success message */}
              {success && !error && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 9,
                    background: 'rgba(74, 222, 128, 0.1)',
                    border: '1px solid rgba(74, 222, 128, 0.4)',
                    color: '#4ade80',
                    fontSize: '0.82rem',
                    marginBottom: 12,
                  }}
                  role="status"
                >
                  <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                  <span>{success}</span>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 9,
                    background: 'rgba(255, 107, 94, 0.1)',
                    border: '1px solid rgba(255, 107, 94, 0.4)',
                    color: 'var(--red)',
                    fontSize: '0.82rem',
                  }}
                  role="alert"
                >
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              {/* Signup: Full name */}
              {mode === 'signup' && (
                <div className="auth-field">
                  <label htmlFor={nameId} className="auth-label">
                    Full Name
                  </label>

                  <div className="auth-input-wrap">
                    <span className="auth-input-icon">
                      <User />
                    </span>

                    <input
                      id={nameId}
                      type="text"
                      className="auth-input"
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </div>
              )}

              {/* Email address */}
              <div className="auth-field">
                <label htmlFor={emailId} className="auth-label">
                  Work Email
                </label>

                <div className="auth-input-wrap">
                  <span className="auth-input-icon">
                    <Mail />
                  </span>

                  <input
                    id={emailId}
                    type="email"
                    className="auth-input"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    readOnly={resetSent}
                  />
                </div>
              </div>


              {mode === 'signup' && (
                <div className="auth-field">
                  <label htmlFor="phoneNumber" className="auth-label">
                    Phone Number
                  </label>

                  <div className="auth-phone-wrap">
                    <select
                      className="auth-country-code"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      aria-label="Country calling code"
                    >
                      <option value="+91">🇮🇳 +91</option>
                      <option value="+1">🇺🇸 +1</option>
                      <option value="+44">🇬🇧 +44</option>
                      <option value="+61">🇦🇺 +61</option>
                      <option value="+971">🇦🇪 +971</option>
                      <option value="+49">🇩🇪 +49</option>
                      <option value="+33">🇫🇷 +33</option>
                      <option value="+81">🇯🇵 +81</option>
                      <option value="+65">🇸🇬 +65</option>
                    </select>

                    <input
                      id="phoneNumber"
                      type="tel"
                      className="auth-input auth-phone-number"
                      placeholder="9876543210"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      autoComplete="tel-national"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Signup: Organization */}
              {mode === 'signup' && (
                <div className="auth-field">
                  <label htmlFor={orgId} className="auth-label">
                    Organization / Company
                  </label>

                  <div className="auth-input-wrap">
                    <span className="auth-input-icon">
                      <Building2 />
                    </span>

                    <input
                      id={orgId}
                      type="text"
                      className="auth-input"
                      placeholder="e.g. NovaTech AI"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      autoComplete="organization"
                    />
                  </div>
                </div>
              )}

              {/* Password */}
              {(mode === 'signup' || mode === 'login') && (
                <div className="auth-field">
                  <div className="auth-label">
                    <label htmlFor={passwordId}>Password</label>
                    {mode === 'login' && (
                      <Link to="/forgot-password" className="auth-forgot-link">
                        Forgot password?
                      </Link>
                    )}
                  </div>

                  <div className="auth-input-wrap">
                    <span className="auth-input-icon">
                      <Lock />
                    </span>

                    <input
                      id={passwordId}
                      type={showPassword ? 'text' : 'password'}
                      className="auth-input"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    />

                    <button
                      type="button"
                      className="auth-input-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'forgot' && resetSent && (
                <>
                  <div className="auth-field">
                    <label htmlFor="new-password" className="auth-label">New password</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input id="new-password" type="password" className="auth-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
                    </div>
                  </div>
                </>
              )}

              {/* Remember me */}
              {mode === 'login' && (
                <div className="auth-row">
                  <label className="auth-checkbox-label">
                    <input
                      type="checkbox"
                      className="auth-checkbox-input"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />

                    <span className="auth-checkbox-custom">
                      {rememberMe && <Check />}
                    </span>

                    <span>Remember me for 30 days</span>
                  </label>
                </div>
              )}

              {/* Signup terms */}
              {mode === 'signup' && (
                <div className="auth-row">
                  <label
                    className="auth-checkbox-label"
                    style={{ fontSize: '0.78rem' }}
                  >
                    <input
                      type="checkbox"
                      className="auth-checkbox-input"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                    />

                    <span className="auth-checkbox-custom">
                      {agreeTerms && <Check />}
                    </span>

                    <span>
                      I agree to the{' '}
                      <Link
                        to="/terms"
                        style={{ color: 'var(--brand-hi)' }}
                      >
                        Terms of Service
                      </Link>{' '}
                      and{' '}
                      <Link
                        to="/privacy"
                        style={{ color: 'var(--brand-hi)' }}
                      >
                        Privacy Policy
                      </Link>
                    </span>
                  </label>
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                className="auth-btn-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Please wait...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {mode === 'signup'
                        ? 'Create Account'
                        : mode === 'forgot'
                          ? 'Password Recovery'
                          : 'Continue to Sign In'}
                    </span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>

              {/* Forgot password back link */}
              {mode === 'forgot' && (
                <Link
                  to="/login"
                  className="dash-btn-ghost"
                  style={{
                    width: '100%',
                    marginTop: 4,
                    fontSize: '0.84rem',
                    justifyContent: 'center',
                  }}
                >
                  <ArrowLeft size={14} style={{ marginRight: 6 }} />
                  Back to Sign In
                </Link>
              )}

              {/* Social sign-in options use the configured OAuth callback routes. */}
              {mode === 'login' && (
                <>
                  <div className="auth-divider">
                    <span>or continue with</span>
                  </div>

                  <div className="auth-social-btns">
                    <button
                      type="button"
                      className="auth-social-btn"
                      onClick={() => handleSocialLogin('GitHub')}
                      disabled={isSubmitting}
                      title="Continue with GitHub"
                    >
                      <Github size={15} />
                      <span>GitHub</span>
                    </button>

                    <button
                      type="button"
                      className="auth-social-btn"
                      onClick={() => handleSocialLogin('Google')}
                      disabled={isSubmitting}
                      title="Continue with Google SSO"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                          fill="#EA4335"
                        />
                      </svg>
                      <span>Google SSO</span>
                    </button>
                  </div>
                </>
              )}

              {/* Signup/signin links */}
              <div
                style={{
                  textAlign: 'center',
                  marginTop: 14,
                  fontSize: '0.84rem',
                  color: 'var(--ink-3)',
                }}
              >
                {mode === 'login' ? (
                  <span>
                    Don&apos;t have an account?{' '}
                    <Link
                      to="/signup"
                      style={{ color: 'var(--brand-hi)', fontWeight: 600 }}
                    >
                      Sign up
                    </Link>
                  </span>
                ) : mode === 'signup' ? (
                  <span>
                    Already have an account?{' '}
                    <Link
                      to="/login"
                      style={{ color: 'var(--brand-hi)', fontWeight: 600 }}
                    >
                      Sign in
                    </Link>
                  </span>
                ) : null}
              </div>
          </form>
        </div>

        {/* Footer */}
        <div className="auth-footer">
          <Link
            to="/"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowLeft size={13} />
            <span>Return to public website</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
