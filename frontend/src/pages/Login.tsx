import { useState, useEffect, useId, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  signIn,
  confirmSignIn,
  signOut,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  fetchAuthSession,
  fetchUserAttributes,
  signInWithRedirect,
} from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'

import { saveSession, loginAdminBackend, isAdministratorEmail } from '../lib/authStore'
import { getCognitoContext } from '../lib/cognitoContext'
import { recordCustomerActivity, syncCognitoProfile } from '../lib/customerService'
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
import { OtpVerification } from '../components/auth/OtpVerification'

interface LoginProps {
  initialMode?: 'login' | 'signup' | 'forgot'
}

function getPasswordResetError(err: unknown): string {
  if (typeof err === 'string') return err

  if (err && typeof err === 'object') {
    const cognitoError = err as { name?: unknown; message?: unknown }
    const name = typeof cognitoError.name === 'string' ? cognitoError.name : ''
    const message = typeof cognitoError.message === 'string' ? cognitoError.message : ''
    if (name && message) return `${name}: ${message}`
    if (message) return message
    if (name) return name
  }

  return 'Unable to reset your password. Please try again.'
}

const PENDING_COGNITO_USERNAME_PREFIX = 'inferxe_pending_cognito_username:'

function getPendingCognitoUsername(email: string): string {
  try {
    return window.localStorage.getItem(
      `${PENDING_COGNITO_USERNAME_PREFIX}${email.trim().toLowerCase()}`,
    ) || ''
  } catch {
    console.warn('[customer-auth] Could not read the pending Cognito username from browser storage.')
    return ''
  }
}

function storePendingCognitoUsername(email: string, username: string): boolean {
  try {
    window.localStorage.setItem(
      `${PENDING_COGNITO_USERNAME_PREFIX}${email.trim().toLowerCase()}`,
      username,
    )
    return true
  } catch {
    console.warn('[customer-auth] Could not persist the pending Cognito username; keep this signup open to verify it.')
    return false
  }
}

function clearPendingCognitoUsername(email: string): void {
  try {
    window.localStorage.removeItem(
      `${PENDING_COGNITO_USERNAME_PREFIX}${email.trim().toLowerCase()}`,
    )
  } catch {
    console.warn('[customer-auth] Could not clear the pending Cognito username from browser storage.')
  }
}

function formatPhoneNumberE164(countryCode: string, phoneNumber: string): string {
  const trimmedPhone = phoneNumber.trim()
  const digits = trimmedPhone.replace(/\D/g, '')
  const callingCode = countryCode.replace(/\D/g, '')
  const phone = trimmedPhone.startsWith('+') ? `+${digits}` : `+${callingCode}${digits}`
  if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
    throw new Error('Enter a valid phone number in international format.')
  }
  return phone
}

async function runCognitoOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    console.error('[cognito-auth] Operation failed.', {
      operation,
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    throw error
  }
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
  const [passwordChallengePending, setPasswordChallengePending] = useState(false)
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
      if (params.get('registered') === '1') {
        return 'Account registered successfully! You can now sign in with your email and password.'
      }
      if (params.get('passwordReset') === '1') {
        return 'Your password has been reset successfully. You can now sign in.'
      }
    }
    return null
  })
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
  const [pendingCognitoUsername, setPendingCognitoUsername] = useState(
    () => getPendingCognitoUsername(email),
  )
  const [confirmationCode, setConfirmationCode] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  const completeCognitoSignIn = async () => {
    const authSession = await runCognitoOperation('fetchAuthSession', () =>
      fetchAuthSession(getCognitoContext()),
    )
    const idToken = authSession.tokens?.idToken
    if (!idToken) throw new Error('Cognito did not return a signed-in customer token.')

    const attributes = await runCognitoOperation('fetchUserAttributes', () =>
      fetchUserAttributes(getCognitoContext()),
    )
    await syncCognitoProfile(idToken.toString())

    const emailAddress = attributes.email || String(idToken.payload.email || '')
    if (!emailAddress) throw new Error('Cognito did not return the signed-in customer email.')
    const customerName =
      attributes.name ||
      attributes.preferred_username ||
      emailAddress.split('@')[0]

    saveSession({
      token: idToken.toString(),
      user: {
        id: attributes.sub || String(idToken.payload.sub || ''),
        fullName: customerName,
        email: emailAddress,
        username: attributes.preferred_username || emailAddress.split('@')[0],
        role: 'customer',
        organization: 'Customer Workspace',
      },
      expiresAt:
        ((idToken.payload.exp as number) || 0) * 1000 ||
        Date.now() + 60 * 60 * 1000,
    })

    void recordCustomerActivity({
      cognito_sub: attributes.sub || String(idToken.payload.sub || ''),
      full_name: customerName,
      email: emailAddress,
      organization: 'Customer Workspace',
      isLogin: true,
    }).catch(() => {
      console.warn('[customer-auth] Could not record customer login activity.')
    })
  }

  // Handle Cognito Hosted UI redirects for federated providers.
  useEffect(() => {
    let active = true
    let completionStarted = false
    const finishFederatedSignIn = async () => {
      if (completionStarted) return
      completionStarted = true
      setIsSubmitting(true)
      setError(null)
      try {
        await completeCognitoSignIn()
        if (active) navigate('/dashboard/customer')
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Federated sign-in could not be verified.',
          )
        }
      } finally {
        if (active) setIsSubmitting(false)
      }
    }

    const stopListening = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') void finishFederatedSignIn()
      if (payload.event === 'signInWithRedirect_failure' && active) {
        setError('GitHub or Google sign-in failed. Please try again.')
        setIsSubmitting(false)
      }
    })

    if (new URLSearchParams(location.search).has('code')) {
      void finishFederatedSignIn()
    }

    return () => {
      active = false
      stopListening()
    }
  }, [location.search, navigate])

  const emailId = useId()
  const passwordId = useId()
  const nameId = useId()
  const orgId = useId()
  const challengePasswordId = useId()
  const confirmChallengePasswordId = useId()
  const confirmResetPasswordId = useId()

  // Sign in through AWS Cognito

  const handleCognitoLogin = async () => {
    setError(null)
    setSuccess(null)

    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }

    if (password.length < 6) {
      setError('Password must contain at least 6 characters.')
      return
    }

    setIsSubmitting(true)
    const cleanEmail = email.trim().toLowerCase()

    try {
      // 1. Attempt AWS Cognito authentication
      try {
        await signOut(getCognitoContext())
      } catch { }

      const result = await runCognitoOperation('signIn', () =>
        signIn(getCognitoContext(), {
          username: cleanEmail,
          password,
        }),
      )

      if (result.isSignedIn) {
        await completeCognitoSignIn()
        navigate('/dashboard/customer')
        return
      }

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        const pendingUsername = getPendingCognitoUsername(cleanEmail)
        if (!pendingUsername) {
          setError('This account still needs email verification. Please restart signup in the browser used to register so its Cognito verification username can be recovered.')
          return
        }
        setPendingCognitoUsername(pendingUsername)
        setConfirmationPending(true)
        setError('Your account is not confirmed yet in AWS Cognito. Please enter the verification code sent to your email.')
        return
      }

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setPasswordChallengePending(true)
        setPassword('')
        setError('Your administrator requires you to set a new password before continuing.')
        return
      }
    } catch (err: any) {
      const errName = err?.name || ''
      if (errName === 'ProfileSyncError') {
        setError(err.message)
      } else if (errName === 'NotAuthorizedException') {
        setError('Incorrect email or password. Please verify your credentials.')
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to sign in. Please verify your credentials and try again.',
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendCode = async () => {
    setError(null)

    const usernameToResend = pendingCognitoUsername || getPendingCognitoUsername(email)
    if (!usernameToResend) {
      throw new Error('The pending Cognito username could not be found. Please restart signup in this browser.')
    }
    if (!pendingCognitoUsername) setPendingCognitoUsername(usernameToResend)

    setIsSubmitting(true)

    try {
      await runCognitoOperation('resendSignUpCode', () =>
        resendSignUpCode(getCognitoContext(), {
          username: usernameToResend,
        }),
      )

      setError(
        'A new verification code has been requested. Check your email and spam folder.',
      )
    } catch (err) {
      console.error('[customer-auth] Verification code resend failed.', {
        name: err instanceof Error ? err.name : 'UnknownError',
      })

      setError(err instanceof Error ? err.message : "Unable to resend the verification code.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSocialLogin = async (provider: 'GitHub' | 'Google') => {
    setError(null)
    setIsSubmitting(true)
    try {
      await runCognitoOperation('signInWithRedirect', () =>
        signInWithRedirect(getCognitoContext(), {
          provider: provider === 'GitHub' ? { custom: 'GitHub' } : 'Google',
        }),
      )
    } catch (err) {
      console.error('[customer-auth] Federated sign-in could not be started.', {
        provider,
        name: err instanceof Error ? err.name : 'UnknownError',
      })
      setError(`${provider} sign-in is unavailable. Check the Cognito Hosted UI configuration.`)
      setIsSubmitting(false)
    }
  }

  // Submit handler for Cognito sign-in, self-registration, confirmation, and password reset.
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const username = email.trim().toLowerCase()

      if (mode === 'login') {
        if (passwordChallengePending) {
          if (newPassword.length < 8) {
            setError('Your new password must contain at least 8 characters.')
            return
          }
          if (newPassword !== confirmNewPassword) {
            setError('The new passwords do not match.')
            return
          }

          const result = await runCognitoOperation('confirmSignIn', () =>
            confirmSignIn(getCognitoContext(), { challengeResponse: newPassword }),
          )
          if (!result.isSignedIn) {
            setError('Cognito requires an additional sign-in step that is not supported here.')
            return
          }

          await completeCognitoSignIn()
          setPasswordChallengePending(false)
          setNewPassword('')
          setConfirmNewPassword('')
          navigate('/dashboard/customer')
          return
        }

        if (!username || !password) {
          setError('Please enter your email and password.')
          return
        }

        const isAdminEmail = isAdministratorEmail(username)

        // Validate credentials against the server-side admin authentication endpoint
        const adminResult = await loginAdminBackend(username, password)

        if (adminResult.isAdmin || isAdminEmail) {
          if (adminResult.ok) {
            // Valid admin credentials: authenticate and open Admin Portal
            navigate('/dashboard')
            return
          } else {
            // Invalid admin credentials or rate-limited: display server error
            setError(adminResult.error || 'Incorrect email or password for administrator account.')
            setIsSubmitting(false)
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
          if (password.length < 6) {
            setError('Password must contain at least 6 characters.')
            return
          }
          if (!agreeTerms) {
            setError('Please agree to the Inferxe Terms of Service to continue.')
            return
          }

          const cleanEmail = email.trim().toLowerCase()
          const cognitoUsername = `inferxe_${window.crypto.randomUUID()}`
          let fullPhone: string
          try {
            fullPhone = formatPhoneNumberE164(countryCode, phoneNumber)
          } catch (phoneError) {
            setError(phoneError instanceof Error ? phoneError.message : 'Enter a valid phone number in international format.')
            return
          }

          try {
            const userAttrs: Record<string, string> = {
              email: cleanEmail,
              name: fullName.trim(),
              preferred_username: cleanEmail.split('@')[0],
              phone_number: fullPhone,
            }

            const result = await runCognitoOperation('signUp', () =>
              signUp(getCognitoContext(), {
                username: cognitoUsername,
                password,
                options: {
                  userAttributes: userAttrs,
                },
              }),
            )

            if (result.nextStep?.signUpStep === 'CONFIRM_SIGN_UP') {
              setPendingCognitoUsername(cognitoUsername)
              storePendingCognitoUsername(cleanEmail, cognitoUsername)
              setConfirmationPending(true)
              setError(null)
              setSuccess('Account created in AWS Cognito! Please enter the verification code sent to your email.')
              return
            }
          } catch (cognitoErr: any) {
            console.error('[customer-auth] Cognito signup failed.', {
              name: cognitoErr instanceof Error ? cognitoErr.name : 'UnknownError',
            })

            if (cognitoErr?.name === 'UsernameExistsException') {
              setError('An account with this email already exists in AWS Cognito. Please sign in instead.')
            } else {
              setError(
                cognitoErr instanceof Error
                  ? `${cognitoErr.name}: ${cognitoErr.message}`
                  : 'Unable to create your Cognito account.'
              )
            }

            return
          }

          // 3. Navigate cleanly to login with success notice
          navigate(`/login?registered=1&email=${encodeURIComponent(cleanEmail)}`)
          return
        } else {
          // Confirm code
          if (!confirmationCode.trim()) {
            setError('Enter the verification code sent to your email.')
            return
          }
          try {
            const usernameToConfirm = pendingCognitoUsername || getPendingCognitoUsername(email)
            if (!usernameToConfirm) {
              throw new Error('The pending Cognito username could not be found. Please restart signup in this browser.')
            }
            await runCognitoOperation('confirmSignUp', () =>
              confirmSignUp(getCognitoContext(), {
                username: usernameToConfirm,
                confirmationCode: confirmationCode.trim(),
              }),
            )
          } catch (e: any) {
            console.error('[customer-auth] Cognito email verification failed.', {
              name: e instanceof Error ? e.name : 'UnknownError',
            })

            setError(
              e instanceof Error
                ? `${e.name}: ${e.message}`
                : 'OTP verification failed. Please try again.'
            )

            return
          }

          setConfirmationPending(false)
          setConfirmationCode('')
          setPassword('')
          clearPendingCognitoUsername(email)
          setPendingCognitoUsername('')
          navigate(`/login?registered=1&email=${encodeURIComponent(email.trim())}`)
          return
        }
      }

      if (mode === 'forgot') {
        if (!resetSent) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(username)) {
            setError('Please enter a valid email address.')
            return
          }
          await runCognitoOperation('resetPassword', () =>
            resetPassword(getCognitoContext(), { username }),
          )
          setResetSent(true)
          setSuccess('If an account exists for this email, password reset instructions have been sent.')
        } else {
          if (!resetCode.trim()) {
            setError('Enter the password reset code sent to your email.')
            return
          }
          if (newPassword.length < 8) {
            setError('Your new password must contain at least 8 characters.')
            return
          }
          if (newPassword !== confirmNewPassword) {
            setError('The new passwords do not match.')
            return
          }
          await runCognitoOperation('confirmResetPassword', () =>
            confirmResetPassword(getCognitoContext(), {
              username,
              confirmationCode: resetCode.trim(),
              newPassword,
            }),
          )
          setResetSent(false)
          setResetCode('')
          setNewPassword('')
          setConfirmNewPassword('')
          navigate(`/login?passwordReset=1&email=${encodeURIComponent(username)}`)
        }
      }
    } catch (err: any) {
      const errName = err?.name || ''
      if (mode === 'forgot') {
        setError(getPasswordResetError(err))
      } else if (errName === 'ProfileSyncError') {
        setError(err.message)
      } else if (errName === 'NotAuthorizedException' || errName === 'UserNotFoundException') {
        setError('Incorrect email or password. Please verify your credentials.')
      } else if (errName === 'UsernameExistsException') {
        setError('An account with this email already exists. Please sign in instead.')
      } else if (errName === 'InvalidPasswordException') {
        setError('Password does not meet security requirements (minimum 6 characters).')
      } else if (errName === 'CodeMismatchException') {
        setError('Invalid verification code. Please check your email and try again.')
      } else if (errName === 'ExpiredCodeException') {
        setError('Verification code has expired. Please request a new one.')
      } else if (errName === 'ResourceNotFoundException') {
        setError('Authentication service is synchronizing. Please try signing in again.')
      } else {
        setError(err instanceof Error && !err.name.includes('Exception') ? err.message : 'Authentication failed. Please verify your credentials.')
      }
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
                const usernameToConfirm = pendingCognitoUsername || getPendingCognitoUsername(email)
                if (!usernameToConfirm) {
                  throw new Error('Pending signup not found. Please complete the registration form first.')
                }
                if (!pendingCognitoUsername) setPendingCognitoUsername(usernameToConfirm)
                await runCognitoOperation('confirmSignUp', () =>
                  confirmSignUp(getCognitoContext(), {
                    username: usernameToConfirm,
                    confirmationCode: code.trim(),
                  }),
                )
              }}
              onResend={handleResendCode}
              isSubmitting={isSubmitting}
              error={error}
              setError={setError}
              onSuccessRedirect={() => {
                setConfirmationPending(false)
                setConfirmationCode('')
                setPassword('')
                clearPendingCognitoUsername(email)
                setPendingCognitoUsername('')
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
                    readOnly={confirmationPending || resetSent || passwordChallengePending}
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
              {((mode === 'signup' && !confirmationPending) ||
                (mode === 'login' && !passwordChallengePending)) && (
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

              {mode === 'login' && passwordChallengePending && (
                <>
                  <div className="auth-field">
                    <label htmlFor={challengePasswordId} className="auth-label">
                      New password
                    </label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input
                        id={challengePasswordId}
                        type="password"
                        className="auth-input"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <div className="auth-field">
                    <label htmlFor={confirmChallengePasswordId} className="auth-label">
                      Confirm new password
                    </label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input
                        id={confirmChallengePasswordId}
                        type="password"
                        className="auth-input"
                        value={confirmNewPassword}
                        onChange={(event) => setConfirmNewPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </>
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
                  <div className="auth-field">
                    <label htmlFor={confirmResetPasswordId} className="auth-label">Confirm new password</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input id={confirmResetPasswordId} type="password" className="auth-input" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} autoComplete="new-password" />
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
                          : passwordChallengePending
                            ? 'Set New Password'
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
              {mode === 'login' && !passwordChallengePending && (
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