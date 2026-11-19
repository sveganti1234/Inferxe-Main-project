/** Icon + label for notification types emitted by the 8002 notification service. */
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Bell, Megaphone, RotateCcw, Server, Tag, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { humaniseCode } from '../data/selectors'

export function notificationVisual(type: string | null | undefined): { icon: ReactNode; label: string; tone: 'success' | 'warning' | 'info' | 'neutral' } {
  const t = (type ?? '').toUpperCase()
  if (t.includes('RECHARGE') || t.includes('CREDIT')) return { icon: <ArrowDownLeft size={16} />, label: 'Wallet credit', tone: 'success' }
  if (t.includes('REFUND')) return { icon: <RotateCcw size={16} />, label: 'Wallet refund', tone: 'success' }
  if (t.includes('LOW_BALANCE') || t.includes('BALANCE')) return { icon: <AlertTriangle size={16} />, label: 'Low balance', tone: 'warning' }
  if (t.includes('DEBIT')) return { icon: <ArrowUpRight size={16} />, label: 'Wallet debit', tone: 'neutral' }
  if (t.includes('MAINTENANCE')) return { icon: <Wrench size={16} />, label: 'Maintenance', tone: 'warning' }
  if (t.includes('PRICE')) return { icon: <Tag size={16} />, label: 'Pricing', tone: 'info' }
  if (t.includes('DEPLOY') || t.includes('GPU')) return { icon: <Server size={16} />, label: 'Infrastructure', tone: 'info' }
  if (t.includes('ANNOUNCE') || t.includes('SYSTEM') || t.includes('BROADCAST')) return { icon: <Megaphone size={16} />, label: 'Announcement', tone: 'info' }
  return { icon: <Bell size={16} />, label: humaniseCode(type) || 'Notification', tone: 'neutral' }
}
