/**
 * Notifications — the customer's real feed from the 8002 notification service.
 * Actions are scoped server-side to the signed-in customer (other users' items → 403).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Check, RefreshCw, Trash2 } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError, defaultMessage } from '../data/http'
import {
  announceNotificationsChanged,
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../data/serviceClients'
import { formatDateTime, formatRelativeTime } from '../data/selectors'
import type { NotificationItem } from '../data/types'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { InlineStatus, Segmented } from '../ui/controls'
import { ConfirmDialog } from '../ui/Dialog'
import { notificationVisual } from '../ui/notificationVisuals'
import { Button, Card, PageHeader } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

const PAGE_SIZE = 20
type Filter = 'all' | 'unread'

function toApiError(err: unknown): CustomerApiError {
  return err instanceof CustomerApiError ? err : new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
}

export default function NotificationsPage() {
  const section = getSection('notifications')
  usePageMeta(section.label, section.description)
  const { refresh: refreshWorkspace } = useCustomerWorkspace()

  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<NotificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<CustomerApiError | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NotificationItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async (nextFilter: Filter) => {
    const requestId = ++requestRef.current
    setStatus('loading')
    setError(null)
    try {
      const page = await fetchNotifications({ limit: PAGE_SIZE, offset: 0, unreadOnly: nextFilter === 'unread' })
      if (requestId !== requestRef.current) return
      setItems(page.items)
      setTotal(page.total)
      setUnread(page.unread_count)
      setStatus('ready')
    } catch (err) {
      if (requestId !== requestRef.current) return
      setError(toApiError(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load(filter)
  }, [filter, load])

  const afterChange = () => {
    announceNotificationsChanged()
    refreshWorkspace()
  }

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const page = await fetchNotifications({ limit: PAGE_SIZE, offset: items.length, unreadOnly: filter === 'unread' })
      setItems((prev) => [...prev, ...page.items.filter((n) => !prev.some((p) => p.id === n.id))])
      setTotal(page.total)
      setUnread(page.unread_count)
    } catch (err) {
      setActionMessage({ tone: 'error', text: toApiError(err).message })
    } finally {
      setLoadingMore(false)
    }
  }

  const markRead = async (item: NotificationItem) => {
    setBusyId(item.id)
    setActionMessage(null)
    try {
      await markNotificationRead(item.id)
      setItems((prev) =>
        filter === 'unread' ? prev.filter((n) => n.id !== item.id) : prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)),
      )
      if (filter === 'unread') setTotal((t) => Math.max(0, t - 1))
      setUnread((u) => Math.max(0, u - 1))
      afterChange()
    } catch (err) {
      setActionMessage({ tone: 'error', text: toApiError(err).message })
    } finally {
      setBusyId(null)
    }
  }

  const markAll = async () => {
    setMarkingAll(true)
    setActionMessage(null)
    try {
      const updated = await markAllNotificationsRead()
      setUnread(0)
      if (filter === 'unread') {
        setItems([])
        setTotal(0)
      } else {
        setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
      }
      setActionMessage({ tone: 'success', text: updated === 1 ? '1 notification marked as read.' : `${updated} notifications marked as read.` })
      afterChange()
    } catch (err) {
      setActionMessage({ tone: 'error', text: toApiError(err).message })
    } finally {
      setMarkingAll(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteNotification(deleteTarget.id)
      setItems((prev) => prev.filter((n) => n.id !== deleteTarget.id))
      setTotal((t) => Math.max(0, t - 1))
      if (!deleteTarget.is_read) setUnread((u) => Math.max(0, u - 1))
      setDeleteTarget(null)
      afterChange()
    } catch (err) {
      setDeleteError(toApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Account, wallet and platform updates for your Inferxe workspace."
        actions={
          <>
            <Button variant="secondary" onClick={() => void load(filter)} disabled={status === 'loading'} aria-label="Refresh notifications">
              <RefreshCw size={15} />
            </Button>
            <Button variant="secondary" onClick={() => void markAll()} disabled={markingAll || unread === 0 || status !== 'ready'}>
              <CheckCheck size={16} /> {markingAll ? 'Marking…' : 'Mark all as read'}
            </Button>
          </>
        }
      />

      <Card flush aria-label="Notification inbox">
        <div className="cx-inbox__bar">
          <Segmented
            label="Filter notifications"
            value={filter}
            onChange={(f) => { setActionMessage(null); setFilter(f) }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: status === 'ready' || unread > 0 ? `Unread · ${unread}` : 'Unread' },
            ]}
          />
          {status === 'ready' ? (
            <span className="cx-muted cx-small">
              {filter === 'unread' ? `${total} unread` : `${total} total`}
            </span>
          ) : null}
        </div>
        {actionMessage ? <div className="cx-card__pad cx-card__pad--tight"><InlineStatus tone={actionMessage.tone}>{actionMessage.text}</InlineStatus></div> : null}

        {status === 'error' && error ? (
          <ErrorState error={error} onRetry={() => void load(filter)} onSignIn={() => void signOutToLogin()} what="your notifications" />
        ) : status === 'loading' && items.length === 0 ? (
          <div className="cx-card__pad"><LoadingBlock lines={5} label="Loading notifications" /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} />}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            body={filter === 'unread' ? 'You are all caught up.' : 'Wallet, account and platform updates will appear here.'}
          />
        ) : (
          <>
            <ul className="cx-inbox" aria-busy={status === 'loading'}>
              {items.map((item) => {
                const visual = notificationVisual(item.notification_type)
                const body = item.message?.trim() || item.detail?.trim() || null
                return (
                  <li key={item.id} className={`cx-inbox__item${item.is_read ? '' : ' is-unread'}`}>
                    <span className={`cx-activity__icon cx-activity__icon--${visual.tone}`} aria-hidden="true">{visual.icon}</span>
                    <div className="cx-inbox__content">
                      <div className="cx-inbox__head">
                        <span className="cx-inbox__title">{item.title?.trim() || visual.label}</span>
                        {!item.is_read ? <span className="cx-unread-dot" aria-label="Unread" /> : null}
                      </div>
                      {body ? <p className="cx-inbox__body">{body}</p> : null}
                      <div className="cx-inbox__meta">
                        <span>{visual.label}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={item.created_at ?? undefined} title={formatDateTime(item.created_at)}>{formatRelativeTime(item.created_at)}</time>
                      </div>
                    </div>
                    <div className="cx-inbox__actions">
                      {!item.is_read ? (
                        <Button variant="ghost" size="sm" onClick={() => void markRead(item)} disabled={busyId === item.id} aria-label={`Mark “${item.title ?? visual.label}” as read`}>
                          <Check size={14} /> Mark read
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => { setDeleteError(null); setDeleteTarget(item) }} aria-label={`Delete “${item.title ?? visual.label}”`}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {items.length < total ? (
              <div className="cx-inbox__more">
                <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Load more (${total - items.length} remaining)`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this notification?"
        description="It will be removed from your inbox permanently."
        confirmLabel="Delete"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
