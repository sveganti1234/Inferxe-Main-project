import { useState, useId, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  signIn,
  signOut,
  getCurrentUser,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  fetchAuthSession,
  fetchUserAttributes,
} from 'aws-amplify/auth'

import { saveSession, loginAdminBackend } from '../lib/authStore'
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
  KeyRound,
  Loader2,
  Lock,
  Mail,
  User,
} from 'lucide-react'
import { Logo } from '../components/Logo'
import { usePageMeta } from '../lib/hooks'
import { OtpVerification } from '../components/auth/OtpVerification'

interface LoginProps {
  initialMode?: 'login' | 'signup' | 'forgot'
}

function getCognitoErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'NotAuthorizedException') {
      return 'Incorrect email or password. Please verify your AWS Cognito credentials.'
    }
    if (err.name === 'UserNotFoundException') {
      return 'User does not exist in AWS Cognito. Please check your email or sign up.'
    }
    if (err.name === 'UserNotConfirmedException') {
      return 'Your account has not been confirmed yet. Please verify your email code.'
    }
    return `${err.name}: ${err.message}`
  }
  return 'Unknown authentication error'
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
  const [email, setEmail] = useState('')
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
  const [confirmationPending, setConfirmationPending] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return (
        params.get('verify') === '1' ||
        params.get('verify') === 'true' ||
        params.get('step') === 'verify'
      )
    }
    return false
  })
  const [pendingCognitoUsername, setPendingCognitoUsername] = useState('')
  const [confirmationCode, setConfirmationCode] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const emailId = useId()
  const passwordId = useId()
  const nameId = useId()
  const orgId = useId()

  // Sign in through AWS Cognito

  const handleCognitoLogin = async () => {
    setError(null)

    if (!import.meta.env.VITE_COGNITO_CLIENT_ID) {
      setError('AWS Cognito App Client ID is missing. Please set VITE_COGNITO_CLIENT_ID in your .env file.')
      return
    }

    if (!email.trim() || !password) {
      setError('Please enter your email and password.')

      return
    }

    setIsSubmitting(true)

    try {
      // Clear an existing Cognito session before signing in again.
      try {
        const user = await getCurrentUser()
        console.log('Existing Cognito session:', user)
        await signOut()
        console.log('Existing session signed out')
      } catch (err) {
        console.log('No active Cognito session:', err)
      }

      const result = await signIn({
        username: email.trim(),
        password,
      })

      if (result.isSignedIn) {
        const authSession = await fetchAuthSession()
        const attributes = await fetchUserAttributes()
        const idToken = authSession.tokens?.idToken

        if (!idToken) {
          setError('Login succeeded, but user session details could not be loaded.')
          return
        }
        const emailAddress = attributes.email || email.trim()
        const fullName =
          attributes.name ||
          attributes.preferred_username ||
          emailAddress.split('@')[0]

        saveSession({
          token: idToken.toString(),
          user: {
            id: attributes.sub || emailAddress,
            fullName,
            email: emailAddress,
            username: attributes.preferred_username || emailAddress.split('@')[0],
            role: 'customer',
          },
          expiresAt:
            (authSession.tokens?.idToken?.payload.exp as number || 0) * 1000,
        })

        navigate('/dashboard/customer')
      }


    } catch (err) {
      console.error('Cognito sign-in error:', err)

      setError(getCognitoErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendCode = async () => {
    setError(null)

    if (!pendingCognitoUsername) {
      setError(
        'Your pending signup could not be found. Please sign up again.',
      )
      return
    }

    setIsSubmitting(true)

    try {
      await resendSignUpCode({
        username: pendingCognitoUsername,
      })

      setError(
        'A new verification code has been requested. Check your email and spam folder.',
      )
    } catch (err) {
      console.error('Resend verification code error:', err)

      setError(err instanceof Error ? err.message : "Unable to resend the verification code.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSocialLogin = async (provider: 'GitHub' | 'Google') => {
    setError(`${provider} sign-in requires configuring an Identity Provider in AWS Cognito. Please sign in with your email and password.`)
  }

  // Submit handler for Cognito sign-in, self-registration, confirmation, and password reset.
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

        // Non-admin users: Authenticate strictly via AWS Cognito
        await handleCognitoLogin()
        return
      }

      if (mode === 'signup') {
        if (!confirmationPending) {
          if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(username)) {
            setError('Please provide a valid email address.')
            return
          }
          if (!fullName.trim()) {
            setError('Full name is required.')
            return
          }
          if (password.length < 8) {
            setError('Password must contain at least 8 characters.')
            return
          }
          if (!agreeTerms) {
            setError('Please agree to the Inferxe Terms of Service to continue.')
            return
          }

          if (!import.meta.env.VITE_COGNITO_CLIENT_ID) {
            setError('AWS Cognito App Client ID is missing. Please set VITE_COGNITO_CLIENT_ID in your .env file.')
            return
          }

          const cognitoUsername = `user_${crypto.randomUUID().replace(/-/g, '')}` // Unique username for Cognito
          setPendingCognitoUsername(cognitoUsername)

          const result = await signUp({
            username: cognitoUsername,
            password,
            options: {
              userAttributes: {
                email: email.trim(),
                preferred_username: fullName.trim(),
                phone_number: `${countryCode.startsWith('+1-') ? '+1' : countryCode}${phoneNumber.trim()}`,
                name: fullName.trim(),
              },
            },
          })

          if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
            setConfirmationPending(true)
            setError('Account created. Enter the verification code sent to your email.')
          } else {
            setError('Account created. You can now sign in.')
            navigate('/login')
          }
        } else {
          if (!confirmationCode.trim()) {
            setError('Enter the verification code sent to your email.')
            return
          }
          await confirmSignUp({
            username: pendingCognitoUsername,
            confirmationCode: confirmationCode.trim(),
          })
          setConfirmationPending(false)
          setConfirmationCode('')
          setPassword('')
          setError('Email confirmed successfully. You can now sign in.')
          navigate('/login')
        }
        return
      }

      if (mode === 'forgot') {
        if (!resetSent) {
          if (!username) {
            setError('Enter your email address first.')
            return
          }
          if (!import.meta.env.VITE_COGNITO_CLIENT_ID) {
            setError('AWS Cognito App Client ID is missing. Please set VITE_COGNITO_CLIENT_ID in your .env file.')
            return
          }
          const result = await resetPassword({ username })
          if (result.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') {
            setResetSent(true)
            setError('A password reset code has been sent if this account exists.')
          } else {
            setError('Follow the next password-reset step shown by Cognito.')
          }
        } else {
          if (!resetCode.trim() || newPassword.length < 8) {
            setError('Enter the reset code and a new password of at least 8 characters.')
            return
          }
          await confirmResetPassword({
            username,
            confirmationCode: resetCode.trim(),
            newPassword,
          })
          setResetSent(false)
          setResetCode('')
          setNewPassword('')
          setError('Password reset successfully. You can now sign in.')
          navigate('/login')
        }
      }
    } catch (err) {
      console.error('Cognito authentication error:', err)
      setError(err instanceof Error ? `${err.name}: ${err.message}` : 'Authentication failed. Please try again.')
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

          {!(mode === 'signup' && confirmationPending) && (
            <>
              <h1 className="auth-title">
                {mode === 'signup'
                  ? 'Create your account'
                  : mode === 'forgot'
                    ? 'Reset your password'
                    : 'Sign in to Inferxe'}
              </h1>

              <p className="auth-subtitle">
                {mode === 'signup'
                  ? 'Create your organization account to get started.'
                  : mode === 'forgot'
                    ? 'Password recovery will be handled through AWS Cognito.'
                    : 'Sign in securely to access your Inferxe dashboard.'}
              </p>
            </>
          )}
        </div>

        {/* Card */}
        <div className="auth-card">
          {mode === 'signup' && confirmationPending ? (
            <OtpVerification
              email={email}
              phoneNumber={phoneNumber}
              countryCode={countryCode}
              pendingUsername={pendingCognitoUsername}
              onVerify={async (code) => {
                if (!pendingCognitoUsername) {
                  throw new Error('Pending signup not found. Please complete the registration form first.')
                }
                await confirmSignUp({
                  username: pendingCognitoUsername,
                  confirmationCode: code.trim(),
                })
              }}
              onResend={handleResendCode}
              isSubmitting={isSubmitting}
              error={error}
              setError={setError}
              onSuccessRedirect={() => {
                setConfirmationPending(false)
                setConfirmationCode('')
                setPassword('')
                setError('Email confirmed successfully. You can now sign in.')
                navigate('/login')
              }}
              onBackToSignup={() => {
                setConfirmationPending(false)
                setError(null)
              }}
            />
          ) : false ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: 'rgba(118, 185, 0, 0.12)',
                  border: '1px solid var(--brand)',
                  color: 'var(--brand-hi)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <CheckCircle2 size={24} />
              </div>

              <h2
                style={{
                  fontSize: '1.1rem',
                  color: 'var(--ink)',
                  marginBottom: 8,
                }}
              >
                Check your inbox
              </h2>

              <p
                style={{
                  fontSize: '0.86rem',
                  color: 'var(--ink-2)',
                  lineHeight: 1.5,
                  marginBottom: 20,
                }}
              >
                Follow the password recovery instructions sent to{' '}
                <strong>{email}</strong>.
              </p>

              <Link
                to="/login"
                className="auth-btn-submit"
                style={{ textDecoration: 'none' }}
              >
                Return to Sign In
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="auth-form"
              noValidate
            >
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
              {mode === 'signup' && !confirmationPending && (
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
                    readOnly={confirmationPending || resetSent}
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
              {mode === 'signup' && !confirmationPending && (
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

              {/* Password: signup only.
                  Cognito collects login passwords on its hosted page. */}
              {((mode === 'signup' && !confirmationPending) || mode === 'login') && (
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

              {mode === 'signup' && confirmationPending && (
                <>
                  <div className="auth-field">
                    <label htmlFor="confirmation-code" className="auth-label">
                      Email verification code
                    </label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Mail /></span>
                      <input
                        id="confirmation-code"
                        type="text"
                        inputMode="numeric"
                        className="auth-input"
                        placeholder="Enter the code from your email"
                        value={confirmationCode}
                        onChange={(e) => setConfirmationCode(e.target.value)}
                        autoComplete="one-time-code"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="dash-btn-ghost"
                    onClick={() => void handleResendCode()}
                    disabled={isSubmitting}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Resend verification code
                  </button>
                </>
              )}

              {mode === 'forgot' && resetSent && (
                <>
                  <div className="auth-field">
                    <label htmlFor="reset-code" className="auth-label">Password reset code</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Mail /></span>
                      <input id="reset-code" type="text" className="auth-input" value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder="Code from your email" autoComplete="one-time-code" />
                    </div>
                  </div>
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
              {mode === 'signup' && !confirmationPending && (
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
                        ? confirmationPending ? 'Verify Email' : 'Create Account'
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

              {/* Social sign-in options.
                  These start Cognito sign-in; provider buttons only work
                  if GitHub/Google are configured in Cognito. */}
              {mode === 'login' && (
                <>
                  <div className="auth-divider">
                    <span>or continue with</span>
                  </div>

                  <div className="auth-social-btns">
                    <button
                      type="button"
                      className="auth-social-btn"
                      onClick={() => void handleSocialLogin('GitHub')}
                      disabled={isSubmitting}
                    >
                      <Github size={15} />
                      <span>GitHub</span>
                    </button>

                    <button
                      type="button"
                      className="auth-social-btn"
                      onClick={() => void handleSocialLogin('Google')}
                      disabled={isSubmitting}
                    >
                      <KeyRound size={15} />
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
          )}
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
