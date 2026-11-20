import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react'

interface AdminErrorBoundaryProps {
  children: ReactNode
  onRetry?: () => void
}

interface AdminErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * AdminErrorBoundary
 * 
 * Catches any render errors or lazy chunk import errors inside the admin main content area.
 * 
 * Guarantees:
 * - Admin sidebar and topbar NEVER crash or disappear.
 * - The user is never trapped in a full-screen white/blank error state.
 * - Provides graceful retry and "Return to Console" actions.
 */
export class AdminErrorBoundary extends Component<AdminErrorBoundaryProps, AdminErrorBoundaryState> {
  state: AdminErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AdminErrorBoundary] Captured render error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onRetry) {
      this.props.onRetry()
    }
  }

  render() {
    if (this.state.hasError) {
      const isChunkError =
        this.state.error?.message?.includes('dynamically imported module') ||
        this.state.error?.name === 'ChunkLoadError'

      return (
        <div
          className="dash-admin-error-fallback"
          style={{
            padding: '36px 16px',
            maxWidth: 620,
            margin: '24px auto',
            width: '100%',
          }}
        >
          <div
            className="dash-card dash-card--glass"
            style={{
              padding: '28px 26px',
              borderRadius: 22,
              border: '1px solid rgba(239, 68, 68, 0.25)',
              background: 'rgba(20, 10, 10, 0.55)',
              backdropFilter: 'blur(24px)',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: 'rgba(239, 68, 68, 0.14)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#ef4444',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--ink)' }}>
                  {isChunkError ? 'Module Update Detected' : 'Unable to load page content'}
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                  {isChunkError
                    ? 'A newer version of this module is available or connection was interrupted.'
                    : 'An unexpected rendering error occurred inside this view.'}
                </span>
              </div>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', lineHeight: 1.55, margin: '14px 0 22px' }}>
              {this.state.error?.message || 'Error details unavailable.'}
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="verdelo-btn-circle--glass"
                style={{
                  padding: '9px 20px',
                  height: 'auto',
                  borderRadius: 99,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={this.handleRetry}
              >
                <RefreshCw size={14} />
                <span>Retry Loading</span>
              </button>
              <button
                type="button"
                className="verdelo-btn-circle--mint"
                style={{
                  padding: '9px 20px',
                  height: 'auto',
                  borderRadius: 99,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#04160c',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={() => {
                  window.location.href = '/dashboard'
                }}
              >
                <LayoutDashboard size={14} />
                <span>Return to Console</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
