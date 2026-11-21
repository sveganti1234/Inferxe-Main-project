/**
 * Auth details not covered elsewhere: the client-side password policy (mirrors the live user pool),
 * display-name fallbacks that must never show a generated Cognito username, and sign-out clearing
 * signed-in assistant history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('aws-amplify/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aws-amplify/auth')>()),
  signOut: vi.fn(async () => {}),
}))

import { passwordPolicyError, withTimeout } from '../../pages/Login'
import { signOutCurrentUser, syncCustomerProfile } from '../../lib/authStore'
import { selectProfileSummary } from '../../features/customer/data/selectors'
import { emptyWorkspace } from './fixtures'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

beforeEach(() => localStorage.clear())

describe('passwordPolicyError', () => {
  it('rejects passwords the user pool rejects', () => {
    expect(passwordPolicyError('Abcdef1')).toMatch(/8 characters/)
    expect(passwordPolicyError('abcdefg1')).toMatch(/uppercase/)
    expect(passwordPolicyError('ABCDEFG1')).toMatch(/lowercase/)
    expect(passwordPolicyError('Abcdefgh')).toMatch(/number/)
  })
  it('accepts a compliant password', () => {
    expect(passwordPolicyError('Abcdefg1')).toBeNull()
  })
})

describe('withTimeout', () => {
  it('fails a Cognito call that never answers instead of spinning forever', async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toMatchObject({ name: 'TimeoutError' })
  })
  it('passes through a call that answers in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })
})

describe('display name', () => {
  it('prefers the email over a generated cust_ username when no full name is stored', () => {
    const ws = emptyWorkspace()
    ws.profile.full_name = null
    ws.profile.username = 'cust_0123456789abcdef'
    ws.profile.email = 'divya@example.test'
    expect(selectProfileSummary(ws).displayName).toBe('divya')
  })

  it('a failed profile sync never falls back to a profile built from token claims', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    const token = ['x', b64url({ sub: 's1', email: 'divya@example.test', name: 'Divya Teja', 'cognito:username': 'cust_abc' }), 'sig'].join('.')
    await expect(syncCustomerProfile(token)).rejects.toMatchObject({ name: 'ProfileSyncError' })
  })
})

describe('signOutCurrentUser', () => {
  it('clears signed-in assistant history', async () => {
    localStorage.setItem('inferxe_chat_history_customer_v1', '[{"role":"user","content":"secret"}]')
    localStorage.setItem('inferxe_chat_history_admin_v1', '[]')
    await signOutCurrentUser()
    expect(localStorage.getItem('inferxe_chat_history_customer_v1')).toBeNull()
    expect(localStorage.getItem('inferxe_chat_history_admin_v1')).toBeNull()
  })
})
