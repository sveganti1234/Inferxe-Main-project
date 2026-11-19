/**
 * Pending Cognito sign-up verification.
 *
 * Remembers which Cognito username is waiting for email confirmation so the customer can
 * resume verification after a page refresh or after leaving the sign-up page.
 * Only the generated Cognito username and the email address are stored — never passwords,
 * verification codes or tokens.
 */

const PENDING_VERIFICATION_KEY = 'inferxe_pending_signup_verification'
/** Unconfirmed sign-ups older than this are no longer offered for resumption. */
const PENDING_VERIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface PendingVerification {
  username: string
  email: string
  createdAt: number
}

function isPendingVerification(value: unknown): value is PendingVerification {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.username === 'string' &&
    v.username.trim().length > 0 &&
    v.username.length <= 128 &&
    typeof v.email === 'string' &&
    v.email.includes('@') &&
    typeof v.createdAt === 'number'
  )
}

export function savePendingVerification(pending: { username: string; email: string }): void {
  try {
    const record: PendingVerification = {
      username: pending.username.trim(),
      email: pending.email.trim().toLowerCase(),
      createdAt: Date.now(),
    }
    localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(record))
  } catch {
    // Storage unavailable (private mode, blocked site data): verification still works in this tab.
  }
}

export function loadPendingVerification(): PendingVerification | null {
  try {
    const raw = localStorage.getItem(PENDING_VERIFICATION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPendingVerification(parsed) || Date.now() - parsed.createdAt > PENDING_VERIFICATION_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_VERIFICATION_KEY)
      return null
    }
    return { username: parsed.username, email: parsed.email, createdAt: parsed.createdAt }
  } catch {
    return null
  }
}

export function clearPendingVerification(): void {
  try {
    localStorage.removeItem(PENDING_VERIFICATION_KEY)
  } catch {
    // ignore
  }
}

/** Mask an email for display, e.g. "jane.doe@example.com" → "ja•••@example.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  return `${local.slice(0, 2)}•••@${domain}`
}
