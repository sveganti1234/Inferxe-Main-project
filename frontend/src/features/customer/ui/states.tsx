/**
 * Shared empty / error / loading states. Every data-driven section uses these instead of
 * placeholder numbers when data is missing, unavailable or still loading.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, CloudOff, Inbox, Lock, LogIn, RefreshCw, ShieldAlert } from 'lucide-react'
import type { CustomerApiError } from '../data/http'
import { Button } from './primitives'

export function EmptyState({
  icon = <Inbox size={24} />,
  title,
  body,
  actions,
  compact,
  tone,
}: {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  actions?: ReactNode
  compact?: boolean
  tone?: 'warning'
}) {
  return (
    <div className={['cx-state', compact && 'cx-state--compact', tone === 'warning' && 'cx-state--warning'].filter(Boolean).join(' ')}>
      <div className="cx-state__icon" aria-hidden="true">{icon}</div>
      <h3 className="cx-state__title">{title}</h3>
      {body ? <p className="cx-state__body">{body}</p> : null}
      {actions ? <div className="cx-state__actions">{actions}</div> : null}
    </div>
  )
}

/** Error state matched to the API error kind (session, permission, availability...). */
export function ErrorState({
  error,
  onRetry,
  onSignIn,
  compact,
  what = 'this information',
}: {
  error: CustomerApiError
  onRetry?: () => void
  onSignIn?: () => void
  compact?: boolean
  /** Short noun phrase used in the title, e.g. "your workspace". */
  what?: string
}) {
  let icon: ReactNode = <AlertTriangle size={24} />
  let title = `We couldn't load ${what}`
  let action: ReactNode = onRetry ? (
    <Button variant="secondary" onClick={onRetry}>
      <RefreshCw size={15} /> Try again
    </Button>
  ) : null

  if (error.kind === 'unauthenticated') {
    icon = <Lock size={24} />
    title = 'Your session has expired'
    action = onSignIn ? (
      <Button variant="primary" onClick={onSignIn}>
        <LogIn size={15} /> Sign in again
      </Button>
    ) : null
  } else if (error.kind === 'forbidden') {
    icon = <ShieldAlert size={24} />
    title = 'Access is restricted'
    action = null
  } else if (error.kind === 'network' || error.kind === 'unavailable') {
    icon = <CloudOff size={24} />
    title = `${what.charAt(0).toUpperCase()}${what.slice(1)} is temporarily unavailable`
  }

  return (
    <div className={['cx-state', 'cx-state--error', compact && 'cx-state--compact'].filter(Boolean).join(' ')} role="alert">
      <div className="cx-state__icon" aria-hidden="true">{icon}</div>
      <h3 className="cx-state__title">{title}</h3>
      <p className="cx-state__body">{error.message}</p>
      {action ? <div className="cx-state__actions">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 14, radius }: { width?: number | string; height?: number | string; radius?: number }) {
  return <span className="cx-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}

export function LoadingBlock({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="cx-stack" style={{ gap: 12 }} role="status" aria-live="polite">
      <span className="cx-sr-only">{label}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '62%' : '100%'} height={i === 0 ? 22 : 14} />
      ))}
    </div>
  )
}
