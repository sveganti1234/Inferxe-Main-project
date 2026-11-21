import { describe, it, expect, beforeEach, vi } from 'vitest'

const amplifySignOut = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('aws-amplify/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aws-amplify/auth')>()),
  signOut: amplifySignOut,
}))

import { loginAdminBackend, getSession, clearSession, syncCustomerProfile } from '../lib/authStore'
import { signInUsernameFor, shouldRetrySignInWithEmail } from '../pages/Login'

// Customer sign-in goes only through Cognito: the admin endpoint can never create a customer session, and
// the Cognito username choice has no hardcoded identities and retries only on "user not found".
const mockFetch = vi.mocked(globalThis.fetch)

beforeEach(() => {
  mockFetch.mockReset()
  amplifySignOut.mockClear()
  clearSession()
})

describe('admin endpoint cannot create a customer session', () => {
  it('ignores an isCustomer response with a token', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, isAdmin: false, isCustomer: true, token: 'srv.customer.token',
      user: { id: 'c1', email: 'c@example.test', role: 'customer' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const r = await loginAdminBackend('c@example.test', 'pw')
    expect(r.ok).toBe(false)
    expect(r.isAdmin).toBe(false)
    expect(getSession()).toBeNull()
  })
})

describe('customer profile sync fails closed', () => {
  const token = ['x', btoa(JSON.stringify({ sub: 's1', email: 'c@example.test', name: 'Claims Name' })), 'sig'].join('.')
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('rejects, creates no session and drops the Cognito tokens on every failure', async () => {
    const failures: Array<() => Promise<Response>> = [
      async () => reply(500, { ok: false, code: 'PROFILE_SYNC_FAILED', error: 'Your customer profile could not be synchronized.' }),
      async () => reply(503, { ok: false, error: 'Customer profile service is temporarily unavailable.' }),
      async () => reply(409, { ok: false, code: 'PROFILE_LINK_REFUSED', error: 'This email address is already linked to a different sign-in.' }),
      async () => reply(200, { ok: true }), // success flag without a profile is not a profile
      async () => { throw new TypeError('fetch failed') },
    ]
    for (const failure of failures) {
      mockFetch.mockReset()
      amplifySignOut.mockClear()
      mockFetch.mockImplementationOnce(failure)
      const err = await syncCustomerProfile(token).catch((e) => e)
      expect(err).toMatchObject({ name: 'ProfileSyncError' })
      expect(JSON.stringify(err.message)).not.toContain('Claims Name')
      expect(getSession()).toBeNull()
      expect(amplifySignOut).toHaveBeenCalledTimes(1)
    }
  })

  it('shows the server message for a refused link', async () => {
    mockFetch.mockResolvedValueOnce(reply(409, { ok: false, error: 'This email address is already linked to a different sign-in.' }))
    await expect(syncCustomerProfile(token)).rejects.toThrow('already linked to a different sign-in')
  })

  it('returns the database-backed profile when sync succeeds', async () => {
    const profile = { id: 's1', fullName: 'Stored Name', email: 'c@example.test', username: 'c', role: 'customer', status: 'active', organizationId: null }
    mockFetch.mockResolvedValueOnce(reply(200, { ok: true, profile }))
    await expect(syncCustomerProfile(token)).resolves.toEqual(profile)
    expect(amplifySignOut).not.toHaveBeenCalled()
  })
})

describe('Cognito username selection', () => {
  it('uses the generated username of an unfinished sign-up of the same email, otherwise the email', () => {
    expect(signInUsernameFor('a@example.test', { email: 'a@example.test', username: 'cust_abc' })).toBe('cust_abc')
    expect(signInUsernameFor('a@example.test', { email: 'b@example.test', username: 'cust_b' })).toBe('a@example.test')
    expect(signInUsernameFor('a@example.test', null)).toBe('a@example.test')
  })

  it('retries with the email only when the generated username does not exist', () => {
    const err = (name: string) => Object.assign(new Error(name), { name })
    expect(shouldRetrySignInWithEmail('cust_abc', 'a@example.test', err('UserNotFoundException'))).toBe(true)
    for (const name of ['NotAuthorizedException', 'TooManyRequestsException', 'LimitExceededException', 'TimeoutError', 'UserNotConfirmedException']) {
      expect(shouldRetrySignInWithEmail('cust_abc', 'a@example.test', err(name))).toBe(false)
    }
    expect(shouldRetrySignInWithEmail('a@example.test', 'a@example.test', err('UserNotFoundException'))).toBe(false)
  })
})
