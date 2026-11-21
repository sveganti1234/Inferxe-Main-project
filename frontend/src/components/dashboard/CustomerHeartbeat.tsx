import { useEffect, useRef } from 'react'
import { getSession, getPortalRole, isJwtExpired, refreshCustomerSession, decodeJwt } from '../../lib/authStore'
import { sendCustomerHeartbeat, sendCustomerLogout } from '../../lib/customerService'

const HEARTBEAT_INTERVAL_MS = 45 * 1000 // 45 seconds (between 30-60s per requirements)

function getClientSessionId(): string {
  if (typeof window === 'undefined') return 'sess_server'
  let id = sessionStorage.getItem('inferxe_client_session_id')
  if (!id) {
    id = `sess_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
    sessionStorage.setItem('inferxe_client_session_id', id)
  }
  return id
}

/**
 * Silent background heartbeat component.
 * Automatically transmits periodic heartbeats while an authenticated customer
 * is actively using the platform, keeping their status marked as 'Online'.
 * Sends best-effort presence updates on tab/browser close via keepalive fetch.
 */
export function CustomerHeartbeat() {
  const timerRef = useRef<number | null>(null)
  const isTransmittingRef = useRef<boolean>(false)
  const hasLoggedOutRef = useRef<boolean>(false)

  useEffect(() => {
    hasLoggedOutRef.current = false

    const triggerHeartbeat = async () => {
      if (isTransmittingRef.current || hasLoggedOutRef.current) return
      let session = getSession()

      // If session token is missing, expired, or near expiration (within 60s), attempt refresh
      if (!session || !session.token || (session.token.split('.').length === 3 && isJwtExpired(session.token, 60))) {
        const refreshed = await refreshCustomerSession(true)
        if (refreshed) {
          session = refreshed
        }
      }

      // 1. Only authenticated customer users send activity heartbeats
      if (!session || !session.token || !session.user?.email) return
      const role = getPortalRole(session.user.role)
      if (role !== 'customer') return

      // 2. Do NOT send heartbeat for Superadmin / admin accounts
      if (session.user.role === 'admin' || session.user.role === 'superadmin' || session.user.role === 'super_admin') return

      // 3. Skip if still expired despite refresh attempt
      if (session.token.split('.').length === 3 && isJwtExpired(session.token, 10)) {
        return
      }

      // 4. Don't send if page is completely hidden
      if (typeof document !== 'undefined' && document.hidden) return

      try {
        isTransmittingRef.current = true
        let cognitoSub = session.user.id?.startsWith('usr_') ? undefined : session.user.id
        if (!cognitoSub && session.token.split('.').length === 3) {
          const claims = decodeJwt(session.token)
          if (claims?.sub && !claims.sub.startsWith('usr_')) {
            cognitoSub = claims.sub
          }
        }

        await sendCustomerHeartbeat({
          cognito_sub: cognitoSub,
          email: session.user.email,
          session_id: getClientSessionId(),
        })
      } catch (e) {
        console.warn('[CustomerHeartbeat] Pulse skipped:', e)
      } finally {
        isTransmittingRef.current = false
      }
    }

    // 1. Initial pulse when component mounts / user signs in
    void triggerHeartbeat()

    // 2. Periodic interval (avoiding duplicate intervals)
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    timerRef.current = window.setInterval(() => {
      void triggerHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    // 3. Tab visibility change: send heartbeat when user returns to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void triggerHeartbeat()
      }
    }

    // 4. Tab / Browser close lifecycle handler (pagehide)
    const handlePageHide = () => {
      if (hasLoggedOutRef.current) return
      const session = getSession()
      if (!session || !session.token || !session.user?.email) return
      if (getPortalRole(session.user.role) !== 'customer') return

      hasLoggedOutRef.current = true
      let cognitoSub = session.user.id?.startsWith('usr_') ? undefined : session.user.id
      if (!cognitoSub && session.token.split('.').length === 3) {
        const claims = decodeJwt(session.token)
        if (claims?.sub && !claims.sub.startsWith('usr_')) {
          cognitoSub = claims.sub
        }
      }

      // Best-effort keepalive presence update on page close
      // Do NOT clear session tokens from localStorage here so page refresh doesn't log the user out
      void sendCustomerLogout({
        cognito_sub: cognitoSub,
        email: session.user.email,
        session_id: getClientSessionId(),
        useKeepalive: true,
      })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  return null
}
