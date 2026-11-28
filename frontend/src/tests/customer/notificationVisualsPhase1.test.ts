import { describe, expect, it } from 'vitest'
import { notificationVisual } from '../../features/customer/ui/notificationVisuals'

describe('Phase 1 Customer Notification Visuals', () => {
  it('correctly maps GPU deployment failure to warning tone and "Deployment failed" label', () => {
    const visual = notificationVisual('GPU_DEPLOYMENT_FAILED')
    expect(visual.label).toBe('Deployment failed')
    expect(visual.tone).toBe('warning')
    expect(visual.icon).toBeDefined()
  })

  it('correctly maps SECURITY_KEY to neutral tone and "Security & Access" label', () => {
    const visual = notificationVisual('SECURITY_KEY')
    expect(visual.label).toBe('Security & Access')
    expect(visual.tone).toBe('neutral')
    expect(visual.icon).toBeDefined()
  })

  it('correctly maps PLAN_UPDATE to info tone and "Plan & Quotas" label', () => {
    const visual = notificationVisual('PLAN_UPDATE')
    expect(visual.label).toBe('Plan & Quotas')
    expect(visual.tone).toBe('info')
    expect(visual.icon).toBeDefined()
  })

  it('preserves existing wallet recharge, debit, low balance, and maintenance visuals', () => {
    const recharge = notificationVisual('WALLET_RECHARGE_SUCCESS')
    expect(recharge.label).toBe('Wallet credit')
    expect(recharge.tone).toBe('success')

    const debit = notificationVisual('WALLET_DEBIT')
    expect(debit.label).toBe('Wallet debit')
    expect(debit.tone).toBe('neutral')

    const lowBalance = notificationVisual('LOW_WALLET_BALANCE')
    expect(lowBalance.label).toBe('Low balance')
    expect(lowBalance.tone).toBe('warning')

    const maintenance = notificationVisual('MAINTENANCE')
    expect(maintenance.label).toBe('Maintenance')
    expect(maintenance.tone).toBe('warning')

    const deployment = notificationVisual('GPU_DEPLOYMENT')
    expect(deployment.label).toBe('Infrastructure')
    expect(deployment.tone).toBe('info')
  })
})
