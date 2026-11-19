/**
 * Accessible modal dialog: focus moves inside on open, Tab is trapped, Escape closes,
 * and focus returns to the element that opened it.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './primitives'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  dismissible = true,
  tone,
}: {
  open: boolean
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  /** When false, Escape / backdrop / close button do nothing (e.g. while a request runs). */
  dismissible?: boolean
  tone?: 'danger'
}) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const dismissRef = useRef(dismissible)
  dismissRef.current = dismissible

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissRef.current) {
          e.stopPropagation()
          closeRef.current()
        }
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (nodes.length === 0) return
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault()
        lastNode.focus()
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault()
        firstNode.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      restoreRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="cx-dialog" role="presentation">
      <div className="cx-dialog__scrim" onClick={() => dismissible && onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`cx-dialog__panel${tone === 'danger' ? ' cx-dialog__panel--danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="cx-dialog__head">
          <div>
            <h2 className="cx-dialog__title" id={titleId}>{title}</h2>
            {description ? <p className="cx-dialog__desc" id={descId}>{description}</p> : null}
          </div>
          {dismissible ? (
            <button type="button" className="cx-iconbtn cx-dialog__close" onClick={onClose} aria-label="Close dialog">
              <X size={17} />
            </button>
          ) : null}
        </div>
        {children ? <div className="cx-dialog__body">{children}</div> : null}
        {footer ? <div className="cx-dialog__foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  error,
  danger = true,
}: {
  open: boolean
  title: ReactNode
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
  danger?: boolean
}) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      dismissible={!busy}
      tone={danger ? 'danger' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="cx-form-error" role="alert">{error}</p>
      ) : null}
    </Dialog>
  )
}
