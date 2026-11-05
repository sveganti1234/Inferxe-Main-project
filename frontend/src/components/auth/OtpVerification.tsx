import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Lock, RefreshCw } from 'lucide-react'

export interface OtpVerificationProps {
  email: string
  phoneNumber?: string
  countryCode?: string
  pendingUsername?: string
  codeDeliveryDestination?: string
  onVerify: (code: string) => Promise<void>
  onResend: () => Promise<void>
  isSubmitting: boolean
  error: string | null
  setError: (err: string | null) => void
  onSuccessRedirect: () => void
  onBackToSignup?: () => void
}

export type AnimationStage = 'idle' | 'transitioning' | 'verifying' | 'success' | 'error'

const OTP_LENGTH = 6

// Deterministic particle configuration for the Stage 5 success burst
const PARTICLES = [
  { angle: 0, dist: 78, size: 6, shape: 'circle', delay: 0.04 },
  { angle: 20, dist: 96, size: 7, shape: 'square', delay: 0.08 },
  { angle: 42, dist: 66, size: 5, shape: 'circle', delay: 0.02 },
  { angle: 65, dist: 88, size: 6, shape: 'diamond', delay: 0.09 },
  { angle: 88, dist: 74, size: 5, shape: 'circle', delay: 0.03 },
  { angle: 110, dist: 92, size: 7, shape: 'square', delay: 0.11 },
  { angle: 132, dist: 62, size: 6, shape: 'circle', delay: 0.01 },
  { angle: 155, dist: 85, size: 8, shape: 'diamond', delay: 0.07 },
  { angle: 178, dist: 76, size: 5, shape: 'circle', delay: 0.05 },
  { angle: 200, dist: 94, size: 7, shape: 'square', delay: 0.1 },
  { angle: 222, dist: 68, size: 6, shape: 'circle', delay: 0.02 },
  { angle: 245, dist: 86, size: 5, shape: 'diamond', delay: 0.08 },
  { angle: 268, dist: 72, size: 6, shape: 'circle', delay: 0.01 },
  { angle: 290, dist: 98, size: 7, shape: 'square', delay: 0.13 },
  { angle: 312, dist: 64, size: 5, shape: 'circle', delay: 0.04 },
  { angle: 335, dist: 89, size: 6, shape: 'diamond', delay: 0.09 },
  { angle: 30, dist: 110, size: 4, shape: 'circle', delay: 0.15 },
  { angle: 145, dist: 104, size: 5, shape: 'square', delay: 0.17 },
  { angle: 215, dist: 108, size: 4, shape: 'circle', delay: 0.14 },
  { angle: 325, dist: 112, size: 5, shape: 'square', delay: 0.19 },
]

export function OtpVerification({
  email,
  phoneNumber,
  countryCode = '+91',
  pendingUsername: _pendingUsername,
  codeDeliveryDestination,
  onVerify,
  onResend,
  isSubmitting,
  error,
  setError,
  onSuccessRedirect,
  onBackToSignup,
}: OtpVerificationProps) {
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [focusedIndex, setFocusedIndex] = useState<number>(0)
  const [stage, setStage] = useState<AnimationStage>('idle')
  const [eatenIndex, setEatenIndex] = useState<number>(-1)
  const [countdown, setCountdown] = useState<number>(30)
  const [isResending, setIsResending] = useState<boolean>(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-focus the first empty input on mount
  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRefs.current[0]?.focus()
    }, 150)
    return () => window.clearTimeout(timer)
  }, [])

  // Resend countdown timer (30s)
  useEffect(() => {
    if (countdown <= 0) return
    const interval = window.setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [countdown])

  // Clear entered digits and reset cursor whenever an error is active
  useEffect(() => {
    if (error) {
      setOtp(Array(OTP_LENGTH).fill(''))
      setEatenIndex(-1)
      const timer = window.setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 80)
      return () => window.clearTimeout(timer)
    }
  }, [error])

  // Masked phone or email display text
  const getMaskedTarget = () => {
    if (phoneNumber && phoneNumber.trim()) {
      const clean = phoneNumber.trim()
      const code = countryCode.trim()
      if (clean.length > 4) {
        const start = clean.slice(0, 2)
        const end = clean.slice(-2)
        const dots = '•'.repeat(Math.max(clean.length - 4, 4))
        return `${code} ${start}${dots}${end}`
      }
      return `${code} ${clean}`
    }
    if (email && email.trim()) {
      const [user, domain] = email.trim().split('@')
      if (domain) {
        const start = user.slice(0, Math.min(2, user.length))
        const dots = '•'.repeat(Math.max(user.length - 2, 4))
        return `${start}${dots}@${domain}`
      }
      return email.trim()
    }
    return 'your registered contact'
  }

  // Handle single digit changes
  const handleDigitChange = (val: string, idx: number) => {
    // Only accept numeric character
    const cleaned = val.replace(/\D/g, '')
    if (!cleaned) {
      const updated = [...otp]
      updated[idx] = ''
      setOtp(updated)
      return
    }

    const char = cleaned.slice(-1)
    const updated = [...otp]
    updated[idx] = char
    setOtp(updated)

    // Clear error on user interaction
    if (error) setError(null)

    // Advance focus if not on last input
    if (idx < OTP_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus()
    } else {
      // Completed last digit — check if all are filled to trigger auto-verify
      const fullCode = updated.join('')
      if (fullCode.length === OTP_LENGTH) {
        void submitCode(fullCode)
      }
    }
  }

  // Handle keyboard navigation: backspace, arrows
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace') {
      if (!otp[idx] && idx > 0) {
        e.preventDefault()
        const updated = [...otp]
        updated[idx - 1] = ''
        setOtp(updated)
        inputRefs.current[idx - 1]?.focus()
      } else if (otp[idx]) {
        const updated = [...otp]
        updated[idx] = ''
        setOtp(updated)
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault()
      inputRefs.current[idx - 1]?.focus()
    } else if (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) {
      e.preventDefault()
      inputRefs.current[idx + 1]?.focus()
    }
  }

  // Handle pasting full OTP code (e.g. "123456")
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return

    const updated = [...otp]
    for (let i = 0; i < OTP_LENGTH; i++) {
      updated[i] = pasted[i] || ''
    }
    setOtp(updated)

    if (error) setError(null)

    const targetIdx = Math.min(pasted.length, OTP_LENGTH - 1)
    inputRefs.current[targetIdx]?.focus()

    if (pasted.length === OTP_LENGTH) {
      void submitCode(pasted)
    }
  }

  const handleBoxClick = (idx: number) => {
    if (stage === 'transitioning' || isSubmitting) return
    inputRefs.current[idx]?.focus()
  }

  // Submit and orchestrate stages
  const submitCode = async (codeToSubmit: string) => {
    if (codeToSubmit.length !== OTP_LENGTH) return
    if (stage === 'transitioning' || stage === 'verifying' || stage === 'success') return

    setError(null)
    setStage('transitioning')
    setEatenIndex(0)

    let verifyError: Error | null = null
    let isApiPending = true

    const apiPromise = (async () => {
      try {
        await onVerify(codeToSubmit)
      } catch (err) {
        verifyError = err instanceof Error ? err : new Error(String(err))
      } finally {
        isApiPending = false
      }
    })()

    // Step-by-step one-by-one eating:
    // Pacman glides from box to box. Each box is eaten sequentially as Pacman reaches it.
    const stepDuration = 380
    for (let step = 1; step <= 5; step++) {
      await new Promise((resolve) => window.setTimeout(resolve, stepDuration))
      setEatenIndex(step)
    }

    // After consuming all 6 boxes, rotate 90deg downward and curve into center
    await new Promise((resolve) => window.setTimeout(resolve, 380))
    setEatenIndex(6)

    // Allow centering animation to settle
    await new Promise((resolve) => window.setTimeout(resolve, 400))

    // If API request is still in-flight, transition to Stage 4 (Verifying radar)
    if (isApiPending) {
      setStage('verifying')
    }

    // Await actual API response
    await apiPromise

    if (!verifyError) {
      // Stage 5: Verification Success
      setStage('success')
      // Stage 6: Completion and redirect after brief presentation (1.8s)
      window.setTimeout(() => {
        onSuccessRedirect()
      }, 1800)
    } else {
      // Stage 7: Error State
      setStage('error')
      setEatenIndex(-1)
      setOtp(Array(OTP_LENGTH).fill(''))

      const errName = (verifyError as any)?.name || ''
      const rawMsg = (verifyError as any)?.message || ''
      let msg = 'Verification failed. Please check the code and try again.'

      if (errName === 'CodeMismatchException' || rawMsg.includes('CodeMismatch') || rawMsg.toLowerCase().includes('mismatch')) {
        msg = 'Incorrect verification code. Please check your email and try again.'
      } else if (errName === 'ExpiredCodeException' || rawMsg.includes('ExpiredCode') || rawMsg.toLowerCase().includes('expired')) {
        msg = 'The verification code has expired. Please click Resend to receive a new code.'
      } else if (errName === 'NotAuthorizedException' && rawMsg.toLowerCase().includes('already confirmed')) {
        msg = 'This account has already been verified in AWS Cognito. Redirecting to Sign In...'
        window.setTimeout(() => onSuccessRedirect(), 1200)
      } else if (errName === 'LimitExceededException' || rawMsg.toLowerCase().includes('limit')) {
        msg = 'Attempt limit exceeded. Please wait a few moments before trying again.'
      } else if (errName === 'ResourceNotFoundException') {
        msg = 'AWS Cognito User Pool or Client ID not found (ResourceNotFoundException). Please verify your AWS Cognito configuration in ap-south-1.'
      } else if (errName === 'UserNotFoundException') {
        msg = 'User not found in AWS Cognito. Please register again.'
      } else if (rawMsg && rawMsg !== 'Unknown error') {
        msg = rawMsg
      }

      setError(msg)
      window.setTimeout(() => {
        setStage('idle')
        inputRefs.current[0]?.focus()
      }, 650)
    }
  }

  // Resend code handler
  const handleResendClick = async () => {
    if (countdown > 0 || isResending || isSubmitting) return
    setIsResending(true)
    setError(null)
    try {
      await onResend()
      setCountdown(30)
      setOtp(Array(OTP_LENGTH).fill(''))
      setEatenIndex(-1)
      window.setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 50)
    } catch (err: any) {
      const errName = err?.name || ''
      const rawMsg = err?.message || ''
      let msg = 'Failed to resend verification code. Please try again.'
      if (errName === 'LimitExceededException') {
        msg = 'Attempt limit exceeded. Please wait a few moments before requesting a new code.'
      } else if (errName === 'ResourceNotFoundException') {
        msg = 'AWS Cognito User Pool or Client ID not found (ResourceNotFoundException).'
      } else if (rawMsg && rawMsg !== 'Unknown error') {
        msg = rawMsg
      }
      setError(msg)
    } finally {
      setIsResending(false)
    }
  }

  const maskedTarget = getMaskedTarget()
  const isCodeComplete = otp.join('').length === OTP_LENGTH

  return (
    <div className={`otp-card-container stage-${stage}`} role="region" aria-label="OTP Verification">
      {/* Verification Card Header */}
      <div className="otp-card-header">
        <h2 className="otp-card-title">
          {stage === 'success' ? 'Email Verified Successfully' : 'Verify your email'}
        </h2>
        <p className="otp-card-subtitle">
          {stage === 'success' ? (
            'Your email has been verified. Redirecting you to Sign In...'
          ) : (
            <>
              We&apos;ve sent a {OTP_LENGTH}-digit verification code to{' '}
              <span className="otp-target-highlight">{codeDeliveryDestination || (email ? email.trim() : maskedTarget)}</span>.
              <br className="otp-sub-break" />
              Enter the code below to complete your registration.
            </>
          )}
        </p>
      </div>

      {/* Error banner (retained from Inferxe style) */}
      {error && stage !== 'success' && (
        <div className="otp-error-alert" role="alert">
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Interactive Arena */}
      <div className="otp-arena">
        {/* Stage 1, 2, 3, and 7: Input Boxes & Chomper Animation Track */}
        {(stage === 'idle' || stage === 'error' || stage === 'transitioning') && (
          <div
            className={`otp-track ${stage === 'error' ? 'is-shaking' : ''} ${
              stage === 'transitioning' ? 'is-transitioning' : ''
            }`}
          >
            {otp.map((digit, idx) => (
              <div
                key={idx}
                className={`otp-box ${focusedIndex === idx ? 'is-focused' : ''} ${
                  digit ? 'has-value' : ''
                } ${stage === 'error' ? 'is-error' : ''} ${
                  stage === 'transitioning' && eatenIndex >= idx ? 'is-eaten' : ''
                }`}
                style={{ '--box-index': idx } as React.CSSProperties}
                onClick={() => handleBoxClick(idx)}
              >
                <input
                  ref={(el) => {
                    inputRefs.current[idx] = el
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(e.target.value, idx)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  onPaste={handlePaste}
                  onFocus={() => setFocusedIndex(idx)}
                  onBlur={() => setFocusedIndex(-1)}
                  disabled={stage === 'transitioning' || isSubmitting}
                  className="otp-box-input"
                  aria-label={`Digit ${idx + 1} of ${OTP_LENGTH}`}
                  autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                />

                {/* Animated active focus cursor when box is empty */}
                {focusedIndex === idx && !digit && stage === 'idle' && (
                  <span className="otp-box-cursor" aria-hidden="true" />
                )}

                <span className="otp-box-char" aria-hidden="true">
                  {digit}
                </span>
              </div>
            ))}

            {/* Stage 3 — The Chomper Runner travelling across the boxes */}
            {stage === 'transitioning' && eatenIndex >= 0 && (
              <div
                className={`otp-chomper-runner ${eatenIndex === 6 ? 'is-centered' : ''}`}
                style={{
                  transform:
                    eatenIndex === 6
                      ? 'translateX(calc(2.5 * var(--step))) translateY(16px) rotate(90deg) scale(1.15)'
                      : `translateX(calc(${eatenIndex} * var(--step))) translateY(0) rotate(0deg) scale(1)`,
                }}
                aria-hidden="true"
              >
                <div className="otp-chomper-glow" />
                <svg viewBox="0 0 48 48" className="otp-chomper-svg">
                  <defs>
                    <linearGradient id="chomperGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#c4f94e" />
                      <stop offset="45%" stopColor="#9be015" />
                      <stop offset="100%" stopColor="#76b900" />
                    </linearGradient>
                  </defs>
                  {/* Upper jaw */}
                  <path
                    d="M 24 24 L 47.5 24 A 23.5 23.5 0 0 0 0.5 24 Z"
                    fill="url(#chomperGrad)"
                    className="otp-jaw-top"
                  />
                  {/* Lower jaw */}
                  <path
                    d="M 24 24 L 47.5 24 A 23.5 23.5 0 0 1 0.5 24 Z"
                    fill="url(#chomperGrad)"
                    className="otp-jaw-bottom"
                  />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Stage 4 — Verification Processing Radar Indicator */}
        {stage === 'verifying' && (
          <div className="otp-verifying-stage" aria-live="polite">
            <div className="otp-verifying-orb-wrap">
              <div className="otp-verifying-ripple" />
              <div className="otp-verifying-ripple ripple-2" />
              <div className="otp-verifying-orbit" />
              <div className="otp-verifying-core">
                <span className="otp-verifying-dot" />
              </div>
            </div>
            <p className="otp-verifying-text">
              <span>Verifying</span>
              <span className="otp-dots">
                <span className="otp-dot-item">.</span>
                <span className="otp-dot-item">.</span>
                <span className="otp-dot-item">.</span>
              </span>
            </p>
          </div>
        )}

        {/* Stage 5 — Verification Success Circle, Animated Checkmark & Particles */}
        {stage === 'success' && (
          <div className="otp-success-stage" aria-live="polite">
            <div className="otp-success-ambient-glow" />
            <div className="otp-success-badge">
              <svg viewBox="0 0 24 24" className="otp-check-svg">
                <path
                  d="M 4.5 12.5 L 9.5 17.5 L 19.5 7.5"
                  fill="none"
                  stroke="#060d00"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="otp-check-path"
                />
              </svg>
            </div>

            {/* Floating neon particles burst */}
            <div className="otp-particles-container" aria-hidden="true">
              {PARTICLES.map((p, i) => (
                <span
                  key={i}
                  className={`otp-particle particle-${p.shape}`}
                  style={
                    {
                      '--tx': `${Math.round(p.dist * Math.cos((p.angle * Math.PI) / 180))}px`,
                      '--ty': `${Math.round(p.dist * Math.sin((p.angle * Math.PI) / 180))}px`,
                      '--size': `${p.size}px`,
                      '--delay': `${p.delay}s`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>

            {/* Lock Security Badge */}
            <div className="otp-secure-badge">
              <Lock size={13} className="otp-secure-icon" />
              <span>Verified and Secure</span>
              <span className="otp-secure-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* Stage 1 Footer: Resend information, countdown, and verify button */}
      {(stage === 'idle' || stage === 'error') && (
        <div className="otp-actions-wrap">
          <div className="otp-resend-row">
            <span className="otp-resend-label">Didn&apos;t receive the code?</span>{' '}
            {countdown > 0 ? (
              <span className="otp-resend-countdown">
                Resend in <strong>{countdown}s</strong>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleResendClick()}
                disabled={isResending || isSubmitting}
                className="otp-resend-btn"
              >
                {isResending ? (
                  <>
                    <RefreshCw size={12} className="spin" />
                    <span>Resending...</span>
                  </>
                ) : (
                  'Resend'
                )}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void submitCode(otp.join(''))}
            disabled={!isCodeComplete || isSubmitting}
            className="auth-btn-submit otp-submit-btn"
          >
            <span>Verify Email</span>
            <ArrowRight size={15} />
          </button>

          {onBackToSignup && (
            <button
              type="button"
              onClick={onBackToSignup}
              className="otp-back-link"
            >
              <ArrowLeft size={13} style={{ marginRight: 6 }} />
              <span>Back to registration details</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
