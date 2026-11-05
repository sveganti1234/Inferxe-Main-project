import { useEffect, useRef } from 'react'
import { getSession, getPortalRole } from '../../lib/authStore'
import { sendCustomerHeartbeat } from '../../lib/customerService'

const HEARTBEAT_INTERVAL_MS = 45 * 1000 // 45 seconds (between 30-60s per requirements)

/**
 * Silent background heartbeat component.
 * Automatically transmits periodic heartbeats while an authenticated customer
 * is actively using the platform, keeping their status marked as 'Online'.
 */
export function CustomerHeartbeat() {
  const timerRef = useRef<number | null>(null)
  const isTransmittingRef = useRef<boolean>(false)

  useEffect(() => {
    const triggerHeartbeat = async () => {
      if (isTransmittingRef.current) return
      const session = getSession()

      // Only authenticated customer users send activity heartbeats
      if (!session || !session.token || !session.user?.email) return
      const role = getPortalRole(session.user.role)
      if (role !== 'customer') return

      // Don't send if page is completely hidden
      if (typeof document !== 'undefined' && document.hidden) return

      try {
        isTransmittingRef.current = true
        await sendCustomerHeartbeat({
          cognito_sub: session.user.id?.startsWith('usr_') ? undefined : session.user.id,
          email: session.user.email,
        })
      } catch (e) {
        console.warn('Customer heartbeat pulse skipped', e)
      } finally {
        isTransmittingRef.current = false
      }
    }

    // 1. Initial pulse when component mounts / user signs in
    void triggerHeartbeat()

    // 2. Periodic interval
    timerRef.current = window.setInterval(() => {
      void triggerHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    // 3. Tab visibility change: send heartbeat when user returns to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void triggerHeartbeat()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}

