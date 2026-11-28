import { useState, useEffect, useId, useRef, type FormEvent } from 'react'
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
  signInWithRedirect,
} from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'

import { saveSession, loginAdminBackend, syncCustomerProfile, ensureFreshSession, getPortalRole } from '../lib/authStore'
import { CUSTOMER_HOME_PATH } from '../features/customer/home'
import {
  clearPendingVerification,
  loadPendingVerification,
  maskEmail,
  savePendingVerification,
  type PendingVerification,
} from '../lib/pendingVerification'
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
  if (typeof err === 'string') {
    return err
  }

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

/** Organization typed at sign-up: kept per email (never secrets) until the first sign-in syncs it to the profile. */
const pendingOrgKey = (email: string) => `inferxe_pending_org_${email.trim().toLowerCase()}`

function takePendingOrganization(email: string): { organization: string } | undefined {
  try {
    const key = pendingOrgKey(email)
    const organization = localStorage.getItem(key)?.trim()
    if (organization) {
      localStorage.removeItem(key)
      return { organization }
    }
  } catch {
    // storage unavailable: the organization can still be set later in Settings
  }
  return undefined
}

/** Mirrors the user pool policy (8+ chars, upper, lower, digit). Cognito re-checks and reports any other rule. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 8) return 'Password must contain at least 8 characters.'
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) {
    return 'Password must include an uppercase letter, a lowercase letter and a number.'
  }
  return null
}

/** Rejects when Cognito has not answered in time, so a stalled request can never leave the form spinning forever. */
export function withTimeout<T>(promise: Promise<T>, ms = 30000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error('AWS Cognito did not respond within 30 seconds. Check your internet connection, VPN or firewall and try again.'), { name: 'TimeoutError' })),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Cognito username to try first: the generated one from an unfinished sign-up of this email, else the email. */
export function signInUsernameFor(email: string, pending: { email?: string; username?: string } | null): string {
  return pending && pending.email === email && pending.username ? pending.username : email
}

/** Retry with the email only when the generated username no longer exists (never after other failures). */
export function shouldRetrySignInWithEmail(candidate: string, email: string, err: unknown): boolean {
  return candidate !== email && (err as { name?: unknown } | null)?.name === 'UserNotFoundException'
}

/** Translate an AWS Cognito / Amplify sign-in error into a message the customer can act on. */
function describeCognitoSignInError(err: unknown): string {
  const cognitoError = (err && typeof err === 'object' ? err : {}) as { name?: unknown; message?: unknown }
  const name = typeof cognitoError.name === 'string' ? cognitoError.name : ''
  const message = typeof cognitoError.message === 'string' ? cognitoError.message : ''
  const lowerMessage = message.toLowerCase()

  switch (name) {
    case 'NotAuthorizedException':
      if (lowerMessage.includes('disabled')) {
        return 'This account has been disabled. Please contact Inferxe support.'
      }
      if (lowerMessage.includes('attempts exceeded')) {
        return 'Too many failed sign-in attempts. Please wait a few minutes before trying again.'
      }
      return 'Incorrect email or password. If you signed up recently, make sure you verified your email address first.'
    case 'UserNotFoundException':
      return 'Incorrect email or password. If you signed up recently, make sure you verified your email address first.'
    case 'UserNotConfirmedException':
      return 'Your email address has not been verified yet. Please complete email verification before signing in.'
    case 'PasswordResetRequiredException':
      return 'A password reset is required for this account. Use "Forgot password" to set a new password.'
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return 'Too many sign-in attempts. Please wait a few minutes before trying again.'
    case 'NetworkError':
      return 'Unable to reach AWS Cognito. Check your internet connection and try again.'
    case 'TimeoutError':
    case 'ProfileSyncError':
      return message
    case 'InvalidParameterException':
    case 'ResourceNotFoundException':
    case 'AuthUserPoolException':
    case 'InvalidUserPoolConfigurationException':
      return `Sign-in is not configured correctly (${name}${message ? `: ${message}` : ''}). Please contact Inferxe support.`
    default:
      break
  }

  if (err instanceof TypeError && lowerMessage.includes('fetch')) {
    return 'Unable to reach AWS Cognito. Check your internet connection and try again.'
  }
  if (name && message) return `Sign-in failed (${name}): ${message}`
  if (message) return message
  return 'Unable to sign in with AWS Cognito. Please try again.'
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

  // Pending Cognito email verification (persisted so it survives refreshes and navigation).
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(() =>
    loadPendingVerification(),
  )
  // On the sign-up page, resume verification automatically when a pending sign-up exists.
  const [resumeVerification] = useState(() => {
    if (mode !== 'signup' || !pendingVerification) return false
    const emailParam = new URLSearchParams(window.location.search).get('email')
    return !emailParam || emailParam.trim().toLowerCase() === pendingVerification.email
  })

  // Form fields
  const [email, setEmail] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return params.get('email') || (resumeVerification && pendingVerification ? pendingVerification.email : '')
    }
    return ''
  })
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
    // Set only by the verification flow after Cognito confirmed the account (router state,
    // so it cannot be produced by a crafted link).
    if ((location.state as { emailVerified?: boolean } | null)?.emailVerified) {
      return 'Email verified successfully. You can now sign in with your email and password.'
    }
    if ((location.state as { passwordReset?: boolean } | null)?.passwordReset) {
      return 'Your password has been reset successfully. Sign in with your new password.'
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('registered') === '1') {
        return 'Account registered successfully! You can now sign in with your email and password.'
      }
    }
    return null
  })
  const [confirmationPending, setConfirmationPending] = useState(resumeVerification)
  const [pendingCognitoUsername, setPendingCognitoUsername] = useState(() =>
    resumeVerification && pendingVerification ? pendingVerification.username : '',
  )
  const [resetSent, setResetSent] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  // The /login and /signup routes reuse this component instance, so state initialisers do not
  // re-run on navigation. Re-evaluate verification state whenever the location changes.
  useEffect(() => {
    if ((location.state as { emailVerified?: boolean } | null)?.emailVerified) {
      setError(null)
      setSuccess('Email verified successfully. You can now sign in with your email and password.')
    }
    if ((location.state as { passwordReset?: boolean } | null)?.passwordReset) {
      setError(null)
      setSuccess('Your password has been reset successfully. Sign in with your new password.')
    }
    const stored = loadPendingVerification()
    setPendingVerification(stored)
    if (mode !== 'signup' || !stored) return
    const emailParam = new URLSearchParams(location.search).get('email')
    if (emailParam && emailParam.trim().toLowerCase() !== stored.email) return
    setEmail(stored.email)
    setPendingCognitoUsername(stored.username)
    setConfirmationPending(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // A customer who is already signed in (valid, refreshable Cognito session) goes straight to the console.
  useEffect(() => {
    if (mode !== 'login') return
    let active = true
    void ensureFreshSession().then((existing) => {
      if (active && existing?.token && getPortalRole(existing.user?.role) === 'customer') {
        navigate(CUSTOMER_HOME_PATH, { replace: true })
      }
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cognito Hosted UI validates OAuth state and completes the provider exchange.
  useEffect(() => {
    let active = true
    const finishFederatedSignIn = async () => {
      setIsSubmitting(true)
      try {
        const authSession = await fetchAuthSession()
        const idToken = authSession.tokens?.idToken?.toString()
        if (!idToken) throw new Error('Cognito did not return a signed-in customer token.')
        const profile = await syncCustomerProfile(idToken)
        if (!active) return
        saveSession({
          token: idToken,
          user: {
            id: profile.id,
            fullName: profile.fullName,
            email: profile.email,
            username: profile.username,
            role: profile.role,
          },
          expiresAt: (authSession.tokens?.idToken?.payload.exp as number) * 1000,
        })
        navigate(CUSTOMER_HOME_PATH, { replace: true })
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Federated sign-in could not be verified.')
        }
      } finally {
        if (active) setIsSubmitting(false)
      }
    }

    const stopListening = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') void finishFederatedSignIn()
      if (payload.event === 'signInWithRedirect_failure') {
        setError('GitHub or Google sign-in failed. Please try again.')
      }
    })

    const params = new URLSearchParams(location.search)
    if (params.has('code')) void finishFederatedSignIn()

    return () => {
      active = false
      stopListening()
    }
  }, [location.search, navigate])

  const emailId = useId()
  const adminBackendErrorRef = useRef<string | null>(null)
  const passwordId = useId()
  const nameId = useId()
  const orgId = useId()

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
      try {
        await signOut()
      } catch (err) {
        console.warn('Could not clear previous Cognito session before sign-in:', err)
      }

      // An account from an unfinished sign-up in this browser may only be reachable by its generated
      // Cognito username, so try that first. Fall back to the email only when Cognito reports that user
      // does not exist; a wrong password, throttling or a timeout is never retried.
      const candidateUsername = signInUsernameFor(cleanEmail, loadPendingVerification())
      let result: Awaited<ReturnType<typeof signIn>>
      try {
        result = await withTimeout(signIn({ username: candidateUsername, password }))
      } catch (firstErr) {
        if (!shouldRetrySignInWithEmail(candidateUsername, cleanEmail, firstErr)) throw firstErr
        result = await withTimeout(signIn({ username: cleanEmail, password }))
      }

      if (result.isSignedIn) {
        const authSession = await fetchAuthSession()
        const idToken = authSession.tokens?.idToken?.toString()
        if (!idToken) throw new Error('Cognito did not return a signed-in customer token.')
        const profile = await syncCustomerProfile(idToken, takePendingOrganization(cleanEmail))
        saveSession({
          token: idToken,
          user: {
            id: profile.id,
            fullName: profile.fullName,
            email: profile.email,
            username: profile.username,
            role: profile.role,
            organization: profile.organization || undefined,
          },
          expiresAt: (authSession.tokens?.idToken?.payload.exp as number) * 1000,
        })
        navigate(CUSTOMER_HOME_PATH, { replace: true })
        return
      }

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        // Cognito accepted this identifier but the account is unconfirmed: resume the single
        // verification flow on the sign-up page (no password or token is stored).
        savePendingVerification({
          username: candidateUsername,
          email: cleanEmail,
        })
        setPendingVerification(loadPendingVerification())
        setPendingCognitoUsername(candidateUsername)
        setConfirmationPending(true)
        navigate(`/signup?email=${encodeURIComponent(cleanEmail)}`)
        return
      }

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setPasswordChallengePending(true)
        setPassword('')
        setSuccess('Your administrator invited you to Inferxe. Set a new password to finish signing in.')
        return
      }

      setError('Cognito requires an additional sign-in step that is not supported here.')
    } catch (err: any) {
      const errName = err?.name || ''
      const errMsg = err?.message || ''
      console.error('Cognito sign-in failed:', errName, errMsg, err)

      // No client-side login fallback: a locally invented session for known emails or on Cognito errors would
      // bypass authentication (removed in the security hardening; backends reject such tokens anyway).
      const pending = loadPendingVerification()
      if (pending && pending.email === cleanEmail && (errName === 'NotAuthorizedException' || errName === 'UserNotFoundException' || errName === 'UserNotConfirmedException')) {
        // An unverified email alias cannot be used to sign in yet.
        setError('This email address has not been verified yet. Use "Enter verification code" below to finish verifying your account.')
      } else {
        setError(describeCognitoSignInError(err))
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Request a new sign-up verification code from Cognito for the pending username.
   * Throws on failure so OtpVerification can show a meaningful error (and keep its cooldown).
   */
  const handleResendCode = async () => {
    if (!pendingCognitoUsername) {
      throw new Error('We could not find your pending sign-up. Please create your account again.')
    }
    setIsSubmitting(true)
    try {
      await resendSignUpCode({ username: pendingCognitoUsername })
    } catch (err) {
      console.error('Resend verification code failed:', (err as { name?: string })?.name || 'UnknownError')
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }

  /** Confirm the pending sign-up with Cognito. Resolves only when Cognito confirms the account. */
  const handleConfirmSignUp = async (code: string) => {
    if (!pendingCognitoUsername) {
      throw new Error('We could not find your pending sign-up. Please create your account again.')
    }
    const result = await confirmSignUp({
      username: pendingCognitoUsername,
      confirmationCode: code.trim(),
    })
    const step = result.nextStep?.signUpStep
    if (!result.isSignUpComplete && step !== 'DONE' && step !== 'COMPLETE_AUTO_SIGN_IN') {
      throw new Error('Email verification is not complete yet. Please try again.')
    }
    clearPendingVerification()
    setPendingVerification(null)
  }

  /** Leave the verification screen after Cognito confirmed the account (or reported it already confirmed). */
  const finishVerification = () => {
    clearPendingVerification()
    setPendingVerification(null)
    setPendingCognitoUsername('')
    setConfirmationPending(false)
    setPassword('')
    setError(null)
    navigate(`/login?email=${encodeURIComponent(email.trim())}`, { state: { emailVerified: true } })
  }

  const handleSocialLogin = async (provider: 'GitHub' | 'Google') => {
    setError(null)
    setIsSubmitting(true)
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined
    if (cognitoDomain) {
      try {
        await signInWithRedirect({
          provider: provider === 'GitHub' ? { custom: 'GitHub' } : 'Google',
        })
        return
      } catch (err) {
        console.warn(`${provider} Cognito sign-in failed:`, err)
      }
    }

    // Social sign-in only works through the Cognito hosted domain (federated identity). A direct provider redirect
    // has no callback that creates an Inferxe session, so it would strand the user on the provider's site.
    setError(`${provider} sign-in is not available right now. Please sign in with your email and password.`)
    setIsSubmitting(false)
  }

  const handleResendResetCode = async () => {
    setError(null)
    setSuccess(null)

    const username = email.trim().toLowerCase()
    if (!username) {
      setError('Enter your email address first.')
      return
    }

    setIsSubmitting(true)
    try {
      await resetPassword({ username })
      setSuccess('If an account exists for this email, a new password reset code has been sent.')
    } catch (err) {
      console.error('Cognito reset code resend failed:', err)
      setError(getPasswordResetError(err))
    } finally {
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
          const policyError = passwordPolicyError(newPassword)
          if (policyError) {
            setError(policyError)
            return
          }
          if (newPassword !== confirmNewPassword) {
            setError('The new passwords do not match.')
            return
          }
          const result = await confirmSignIn({ challengeResponse: newPassword })
          if (!result.isSignedIn) {
            setError('Cognito requires an additional sign-in step that is not supported here.')
            return
          }
          const authSession = await fetchAuthSession()
          const idToken = authSession.tokens?.idToken?.toString()
          if (!idToken) throw new Error('Cognito did not return a signed-in customer token.')
          const profile = await syncCustomerProfile(idToken, takePendingOrganization(username))
          saveSession({
            token: idToken,
            user: {
              id: profile.id,
              fullName: profile.fullName,
              email: profile.email,
              username: profile.username,
              role: profile.role,
              organization: profile.organization || undefined,
            },
            expiresAt: (authSession.tokens?.idToken?.payload.exp as number) * 1000,
          })
          setPasswordChallengePending(false)
          setNewPassword('')
          setConfirmNewPassword('')
          navigate(CUSTOMER_HOME_PATH, { replace: true })
          return
        }
        if (!username || !password) {
          setError('Please enter your email and password.')
          return
        }

        // Validate credentials against the server-side admin authentication endpoint
        const adminResult = await loginAdminBackend(username, password)
        adminBackendErrorRef.current = (adminResult.isAdmin && adminResult.backendError) ? adminResult.error ?? null : null

        if (adminResult.isAdmin) {
          if (adminResult.ok) {
            // Valid admin credentials: superadmins land on their own dashboard, admins on the Admin Portal
            navigate(getPortalRole(adminResult.session?.user?.role) === 'superadmin' ? '/dashboard/super-admin' : '/dashboard')
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
        // Email verification is handled exclusively by <OtpVerification> (handleConfirmSignUp).
        if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(username)) {
          setError('Please provide a valid email address.')
          return
        }
        if (!fullName.trim()) {
          setError('Full name is required.')
          return
        }
        const policyError = passwordPolicyError(password)
        if (policyError) {
          setError(policyError)
          return
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.')
          return
        }
        if (!agreeTerms) {
          setError('Please agree to the Inferxe Terms of Service to continue.')
          return
        }

        const cleanEmail = email.trim().toLowerCase()
        if (organization.trim()) {
          try {
            localStorage.setItem(pendingOrgKey(cleanEmail), organization.trim())
          } catch {
            // storage unavailable: the organization can be set later in Settings
          }
        }

        // Cognito User Pool is configured with email as a sign-in alias, not the username attribute.
        // The Username parameter must be a non-email unique identifier; the email is stored as a user attribute.
        const cognitoUsername = `cust_${crypto.randomUUID().replace(/-/g, '')}`

        try {
          const userAttrs: Record<string, string> = {
            email: cleanEmail,
            name: fullName.trim(),
            preferred_username: cognitoUsername,
          }
          if (phoneNumber.trim()) {
            const fullPhone = `${countryCode.startsWith('+1-') ? '+1' : countryCode}${phoneNumber.trim()}`.replace(/\s+/g, '')
            if (/^\+[1-9]\d{1,14}$/.test(fullPhone)) {
              userAttrs.phone_number = fullPhone
            }
          }

          const result = await withTimeout(signUp({
            username: cognitoUsername,
            password,
            options: {
              userAttributes: userAttrs,
            },
          }))

          if (result.nextStep?.signUpStep === 'CONFIRM_SIGN_UP') {
            // Persist only the generated username and email so verification can be resumed.
            savePendingVerification({ username: cognitoUsername, email: cleanEmail })
            setPendingVerification(loadPendingVerification())
            setPendingCognitoUsername(cognitoUsername)
            setConfirmationPending(true)
            setPassword('')
            setConfirmPassword('')
            setError(null)
            return
          }
        } catch (cognitoErr: any) {
          console.error('Cognito sign-up failed:', cognitoErr?.name)
          if (cognitoErr?.name === 'UsernameExistsException') {
            setError('An account with this email already exists in AWS Cognito. Please sign in instead.')
            return
          }
          setError(cognitoErr instanceof Error ? cognitoErr.message : 'Unable to create the Cognito account.')
          return
        }

        // Account was confirmed without a verification step: no pending verification remains.
        clearPendingVerification()
        navigate(`/login?registered=1&email=${encodeURIComponent(cleanEmail)}`)
        return
      }

      if (mode === 'forgot') {
        if (!resetSent) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(username)) {
            setError('Please enter a valid email address.')
            return
          }
          await withTimeout(resetPassword({ username }))
          setResetSent(true)
          setSuccess('If an account exists for this email, password reset instructions have been sent.')
        } else {
          if (!resetCode.trim()) {
            setError('Enter the password reset code sent to your email.')
            return
          }
          const policyError = passwordPolicyError(newPassword)
          if (policyError) {
            setError(policyError)
            return
          }
          if (newPassword !== confirmNewPassword) {
            setError('The new passwords do not match.')
            return
          }
          await withTimeout(confirmResetPassword({
            username,
            confirmationCode: resetCode.trim(),
            newPassword,
          }))
          setResetSent(false)
          setResetCode('')
          setNewPassword('')
          setConfirmNewPassword('')
          navigate(`/login?email=${encodeURIComponent(username)}`, { replace: true, state: { passwordReset: true } })
        }
      }
    } catch (err: any) {
      console.error('Authentication error:', err)
      const errName = err?.name || ''
      if (mode === 'forgot') {
        setError(getPasswordResetError(err))
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
                    : passwordChallengePending
                      ? 'Choose a new password'
                      : 'Sign in to Inferxe'}
              </h1>

              <p className="auth-subtitle">
                {mode === 'signup'
                  ? 'Create your organization account to get started.'
                  : mode === 'forgot'
                    ? 'Enter your email address to receive a password reset code.'
                    : passwordChallengePending
                      ? 'Choose a new password to complete your invitation and sign in.'
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
              onVerify={handleConfirmSignUp}
              onResend={handleResendCode}
              isSubmitting={isSubmitting}
              error={error}
              setError={setError}
              onSuccessRedirect={finishVerification}
              onBackToSignup={() => {
                // Keep the pending record so the customer can still return to verification later.
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
                    background: 'rgba(14, 165, 233, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#38bdf8',
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

              {/* Pending email verification: let the customer return to the verification step */}
              {mode === 'login' && pendingVerification && !passwordChallengePending && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderRadius: 9,
                    background: 'rgba(14, 165, 233, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#38bdf8',
                    fontSize: '0.82rem',
                    marginTop: 12,
                  }}
                  role="status"
                >
                  <Mail size={15} style={{ flexShrink: 0 }} />
                  <span>
                    {maskEmail(pendingVerification.email)} is waiting for email verification.{' '}
                    <Link
                      to={`/signup?email=${encodeURIComponent(pendingVerification.email)}`}
                      style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}
                    >
                      Enter verification code
                    </Link>
                  </span>
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
                    readOnly={confirmationPending || passwordChallengePending || (mode === 'forgot' && resetSent)}
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
              {((mode === 'signup' && !confirmationPending) || (mode === 'login' && !passwordChallengePending)) && (
                <div className="auth-field">
                  <div className="auth-label">
                    <label htmlFor={passwordId}>Password</label>
                    {mode === 'login' && !passwordChallengePending && (
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

              {mode === 'signup' && !confirmationPending && (
                <div className="auth-field">
                  <label htmlFor="confirm-password" className="auth-label">Confirm Password</label>
                  <div className="auth-input-wrap">
                    <span className="auth-input-icon"><Lock /></span>
                    <input
                      id="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      className="auth-input"
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                    At least 8 characters with uppercase, lowercase and a number.
                  </p>
                </div>
              )}

              {mode === 'login' && passwordChallengePending && (
                <>
                  <div className="auth-field">
                    <label htmlFor="invited-new-password" className="auth-label">New password</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input
                        id="invited-new-password"
                        type="password"
                        className="auth-input"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </div>
                  </div>
                  <div className="auth-field">
                    <label htmlFor="confirm-invited-password" className="auth-label">Confirm new password</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input
                        id="confirm-invited-password"
                        type="password"
                        className="auth-input"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Re-enter your new password"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dash-btn-ghost"
                    onClick={() => {
                      setPasswordChallengePending(false)
                      setNewPassword('')
                      setConfirmNewPassword('')
                      setError(null)
                      setSuccess(null)
                    }}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Cancel password setup
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
                      <input id="new-password" type={showPassword ? 'text' : 'password'} className="auth-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
                      <button
                        type="button"
                        className="auth-input-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </button>
                    </div>
                  </div>
                  <div className="auth-field">
                    <label htmlFor="confirm-new-password" className="auth-label">Confirm new password</label>
                    <div className="auth-input-wrap">
                      <span className="auth-input-icon"><Lock /></span>
                      <input id="confirm-new-password" type={showPassword ? 'text' : 'password'} className="auth-input" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="Re-enter your new password" autoComplete="new-password" />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dash-btn-ghost"
                    onClick={() => void handleResendResetCode()}
                    disabled={isSubmitting}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Resend password reset code
                  </button>
                </>
              )}

              {/* Remember me */}
              {mode === 'login' && !passwordChallengePending && (
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
                        ? 'Create Account'
                        : mode === 'forgot'
                          ? resetSent ? 'Reset Password' : 'Send Reset Code'
                          : passwordChallengePending ? 'Set New Password' : 'Continue to Sign In'}
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
