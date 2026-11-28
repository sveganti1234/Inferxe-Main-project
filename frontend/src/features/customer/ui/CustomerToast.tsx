/**
 * Customer Toast Notification Card & Viewport
 * ============================================
 * Renders glassmorphic, accessible toast popup notifications in the bottom-right
 * corner of the Customer Portal for real-time notifications.
 */

import { memo } from 'react'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCustomerNotificationToasts, type CustomerToastItem } from './useCustomerNotificationToasts'

interface CustomerToastProps {
  toast: CustomerToastItem
  onDismiss: (id: string) => void
}

export const CustomerToastCard = memo(function CustomerToastCard({ toast, onDismiss }: CustomerToastProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`cx-toast mw-toast cx-toast--${toast.tone}`}
      role="status"
      aria-live="polite"
      data-testid="customer-toast"
      data-notification-id={toast.id}
    >
      <div className="cx-toast__icon mw-toast-icon-wrap" aria-hidden="true">
        {toast.icon}
      </div>

      <div className="cx-toast__content mw-toast-content">
        <div className="cx-toast__title mw-toast-title">{toast.title}</div>
        {toast.message ? (
          <div className="cx-toast__message mw-toast-desc">{toast.message}</div>
        ) : null}
      </div>

      <button
        type="button"
        className="cx-toast__close mw-toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        title="Dismiss notification"
      >
        <X size={15} />
      </button>

      <div className="cx-toast__progress mw-toast-progress" aria-hidden="true">
        <div className="cx-toast__progress-bar mw-toast-progress-bar" />
      </div>
    </motion.div>
  )
})

interface CustomerToastViewportProps {
  userId?: string | null
}

export function CustomerToastViewport({ userId }: CustomerToastViewportProps) {
  const { toasts, dismissToast } = useCustomerNotificationToasts(userId)

  if (toasts.length === 0) return null

  return (
    <div
      className="cx-toast-viewport"
      role="region"
      aria-label="Recent notifications"
      data-testid="customer-toast-viewport"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <CustomerToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </AnimatePresence>
    </div>
  )
}
