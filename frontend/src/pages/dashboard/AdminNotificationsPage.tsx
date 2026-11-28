import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Filter,
  RefreshCw,
  Server,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../lib/hooks'
import {
  fetchAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  toUiNotification,
  type AdminUiNotification,
} from '../../lib/adminNotificationService'

function getNotificationIcon(type: string) {
  const t = (type || '').toUpperCase()
  if (t.includes('GPU') || t.includes('DEPLOYMENT') || t.includes('INFRASTRUCTURE')) {
    return <Server size={18} className="text-emerald-400" />
  }
  if (t.includes('SECURITY') || t.includes('ROLE') || t.includes('SESSION') || t.includes('AUTH')) {
    return <ShieldAlert size={18} className="text-amber-400" />
  }
  if (t.includes('WALLET') || t.includes('BILLING') || t.includes('PRICE') || t.includes('REFUND')) {
    return <Wallet size={18} className="text-cyan-400" />
  }
  if (t.includes('FAIL') || t.includes('ERROR') || t.includes('ALERT') || t.includes('WARN')) {
    return <AlertTriangle size={18} className="text-rose-400" />
  }
  return <Activity size={18} className="text-emerald-400" />
}

export default function AdminNotificationsPage() {
  usePageMeta('Notifications | Admin Portal', 'Administrator notifications and platform alerts feed.')

  const [notifications, setNotifications] = useState<AdminUiNotification[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const loadNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const res = await fetchAdminNotifications({
        unread_only: filter === 'unread',
        limit: 50,
      })
      if (res.ok && res.data) {
        setNotifications(res.data.items.map(toUiNotification))
        setTotalCount(res.data.total)
        setUnreadCount(res.data.unread_count)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [filter])

  useEffect(() => {
    void loadNotifications()
    const onNotificationChange = () => {
      void loadNotifications(true)
    }
    window.addEventListener('inferxe_notifications_change', onNotificationChange)
    return () => {
      window.removeEventListener('inferxe_notifications_change', onNotificationChange)
    }
  }, [loadNotifications])

  const handleMarkOne = async (id: string) => {
    setActionInProgress(id)
    // Optimistic
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
    try {
      await markAdminNotificationRead(id)
    } finally {
      setActionInProgress(null)
    }
  }

  const handleMarkAll = async () => {
    setActionInProgress('all')
    // Optimistic
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    try {
      await markAllAdminNotificationsRead()
    } finally {
      setActionInProgress(null)
    }
  }

  return (
    <DashboardLayout
      heading="Notifications"
      breadcrumb={[
        { label: 'Admin', to: '/dashboard' },
        { label: 'Notifications' },
      ]}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
        {/* Header Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={{
            background: 'var(--panel-bg, rgba(17, 24, 39, 0.7))',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
            borderRadius: 12,
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted, #94a3b8)', fontWeight: 500 }}>Total Notifications</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink-primary, #f8fafc)', marginTop: 4 }}>
              {totalCount}
            </div>
          </div>

          <div style={{
            background: 'var(--panel-bg, rgba(17, 24, 39, 0.7))',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
            borderRadius: 12,
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted, #94a3b8)', fontWeight: 500 }}>Unread Alerts</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#10b981', marginTop: 4 }}>
              {unreadCount}
            </div>
          </div>

          <div style={{
            background: 'var(--panel-bg, rgba(17, 24, 39, 0.7))',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
            borderRadius: 12,
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted, #94a3b8)', fontWeight: 500 }}>Read Alerts</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink-muted, #94a3b8)', marginTop: 4 }}>
              {Math.max(0, totalCount - unreadCount)}
            </div>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 16,
          background: 'var(--panel-bg, rgba(17, 24, 39, 0.5))',
          padding: '12px 16px',
          borderRadius: 10,
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.06))',
        }}>
          {/* Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={15} style={{ color: 'var(--ink-muted, #94a3b8)' }} />
            <button
              type="button"
              onClick={() => setFilter('all')}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: filter === 'all' ? '#10b981' : 'transparent',
                color: filter === 'all' ? '#022c22' : 'var(--ink-muted, #94a3b8)',
                transition: 'all 0.15s ease',
              }}
            >
              All ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: filter === 'unread' ? '#10b981' : 'transparent',
                color: filter === 'unread' ? '#022c22' : 'var(--ink-muted, #94a3b8)',
                transition: 'all 0.15s ease',
              }}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => loadNotifications(true)}
              disabled={refreshing}
              title="Refresh notifications"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: '0.8rem',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--ink-primary, #f8fafc)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: refreshing ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={actionInProgress === 'all'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  cursor: actionInProgress === 'all' ? 'not-allowed' : 'pointer',
                }}
              >
                <CheckCheck size={14} />
                {actionInProgress === 'all' ? 'Marking…' : 'Mark all read'}
              </button>
            )}
          </div>
        </div>

        {/* Notification Feed List */}
        <div style={{
          background: 'var(--panel-bg, rgba(17, 24, 39, 0.7))',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-muted, #94a3b8)' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto', opacity: 0.7 }} />
              <div>Loading notifications…</div>
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--ink-muted, #94a3b8)' }}>
              <Bell size={32} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink-primary, #f8fafc)' }}>
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </div>
              <div style={{ fontSize: '0.82rem', marginTop: 4 }}>
                {filter === 'unread' ? 'All alerts have been reviewed.' : 'System and security alerts will appear here.'}
              </div>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.06))',
                  background: notif.read ? 'transparent' : 'rgba(16, 185, 129, 0.03)',
                  transition: 'background 0.15s ease',
                  gap: 16,
                }}
              >
                <div style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: notif.read ? 'rgba(255, 255, 255, 0.05)' : 'rgba(16, 185, 129, 0.12)',
                      border: notif.read ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(16, 185, 129, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {getNotificationIcon(notif.type)}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: notif.read ? 600 : 700, color: 'var(--ink-primary, #f8fafc)' }}>
                        {notif.title}
                      </span>
                      {!notif.read && (
                        <span style={{
                          display: 'inline-block',
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
                          boxShadow: '0 0 6px #10b981',
                        }} />
                      )}
                      <span style={{
                        fontSize: '0.72rem',
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(255, 255, 255, 0.06)',
                        color: 'var(--ink-muted, #94a3b8)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        {notif.type}
                      </span>
                    </div>

                    <div style={{
                      fontSize: '0.82rem',
                      color: 'var(--ink-secondary, #cbd5e1)',
                      lineHeight: 1.5,
                      marginBottom: 6,
                    }}>
                      {notif.detail}
                    </div>

                    <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted, #64748b)' }}>
                      {notif.time}
                    </div>
                  </div>
                </div>

                {!notif.read && (
                  <button
                    type="button"
                    onClick={() => handleMarkOne(notif.id)}
                    disabled={actionInProgress === notif.id}
                    title="Mark as read"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: '0.74rem',
                      background: 'transparent',
                      color: '#10b981',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      cursor: actionInProgress === notif.id ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Check size={12} />
                    Mark read
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
