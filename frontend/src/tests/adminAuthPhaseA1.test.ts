import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSession,
  createDeveloperAdminAccount,
  deleteSuperadminAdmin,
  getSession,
  hasPermission,
  loginAdminBackend,
  performSignOut,
  saveSession,
  updateSuperadminAdmin,
  verifyAdminSessionServer,
  verifyAdminSessionWithDetails,
} from '../lib/authStore'
import {
  DEFAULT_ADMIN_ACCOUNTS,
  getAdminAccounts,
  syncAdminAccountsFromBackend,
} from '../lib/adminAccountStore'
import {
  PLATFORM_PERMISSIONS,
  STANDARD_ROLES,
} from '../lib/adminRoleStore'

/** Admin session tokens as the admin auth server issues them: signed HS256 JWTs carrying role and exp. */
const adminToken = (sub: string, role: 'admin' | 'superadmin') => {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub, role, sid: `sess_${sub}`, sv: 1, exp: Math.floor(Date.now() / 1000) + 600 }), 'signature'].join('.')
}

describe('Phase A1 Frontend Admin Authentication Hardening', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearSession()
    globalThis.fetch = originalFetch
  })

  it('rejects all ix-* and dev bypass tokens without accepting them offline', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await verifyAdminSessionServer('ix-tok-forged123')).toBe(false)
    expect(await verifyAdminSessionServer('ix-admin-dev')).toBe(false)
    expect(await verifyAdminSessionServer('admin-dev-token')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not mint fallback ix-tok sessions when /api/admin/login fails or returns 401/503', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        isAdmin: true,
        error: 'Incorrect email or password.',
      }),
    }) as unknown as typeof fetch

    const res = await loginAdminBackend('admin@inferxe.com', 'admin123')
    expect(res.ok).toBe(false)
    expect(res.isAdmin).toBe(true)
    expect(getSession()).toBeNull()

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof fetch
    const offlineRes = await loginAdminBackend('admin@inferxe.com', 'admin123')
    expect(offlineRes.ok).toBe(false)
    expect(offlineRes.backendError).toBe(true)
    expect(offlineRes.error).toContain('Unable to reach')
    expect(getSession()).toBeNull()

    // 503 ADMIN_AUTH_NOT_CONFIGURED must preserve isAdmin:true and explicit config error
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        ok: false,
        isAdmin: true,
        code: 'ADMIN_AUTH_NOT_CONFIGURED',
        error: 'Administrator authentication is not configured on the backend.',
      }),
    }) as unknown as typeof fetch

    const unconfiguredRes = await loginAdminBackend('admin@inferxe.com', 'SomePassword')
    expect(unconfiguredRes.ok).toBe(false)
    expect(unconfiguredRes.isAdmin).toBe(true)
    expect(unconfiguredRes.backendError).toBe(true)
    expect(unconfiguredRes.code).toBe('ADMIN_AUTH_NOT_CONFIGURED')
    expect(unconfiguredRes.error).toContain('not configured')
  })

  it('syncs authoritative server role from /api/admin/verify and fails closed on 401', async () => {
    const signedJwt = adminToken('dev1', 'admin')
    saveSession({
      token: signedJwt,
      user: {
        id: 'dev1',
        fullName: 'Dev Admin',
        email: 'dev1@inferxe.com',
        username: 'dev1',
        role: 'superadmin', // Tampered client role
      },
      expiresAt: Date.now() + 60_000,
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        valid: true,
        user: {
          id: 'dev1',
          fullName: 'Dev Admin',
          email: 'dev1@inferxe.com',
          username: 'dev1',
          role: 'admin', // Authoritative server role
        },
      }),
    }) as unknown as typeof fetch

    const verified = await verifyAdminSessionWithDetails(signedJwt)
    expect(verified.valid).toBe(true)
    expect(verified.user?.role).toBe('admin')
    expect(getSession()?.user.role).toBe('admin')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, valid: false }),
    }) as unknown as typeof fetch

    expect(await verifyAdminSessionServer(signedJwt)).toBe(false)
  })

  it('calls /api/admin/logout on admin sign-out and clears local session', async () => {
    const signedJwt = adminToken('adm1', 'superadmin')
    saveSession({
      token: signedJwt,
      user: {
        id: 'adm1',
        fullName: 'Super Admin',
        email: 'admin@inferxe.com',
        username: 'admin',
        role: 'superadmin',
      },
      expiresAt: Date.now() + 60_000,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await performSignOut('/')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: `Bearer ${signedJwt}`,
        }),
      }),
    )
    expect(getSession()).toBeNull()
  })

  it('posts developer admin creation to /api/superadmin/admins with credentials', async () => {
    const signedJwt = adminToken('adm1', 'superadmin')
    saveSession({
      token: signedJwt,
      user: {
        id: 'adm1',
        fullName: 'Super Admin',
        email: 'admin@inferxe.com',
        username: 'admin',
        role: 'superadmin',
      },
      expiresAt: Date.now() + 60_000,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        ok: true,
        admin: {
          id: 'dev-123',
          email: 'dev@inferxe.com',
          full_name: 'Dev',
          role: 'admin',
          status: 'active',
          created_at: '2026-11-18T00:00:00Z',
        },
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await createDeveloperAdminAccount({
      email: 'Dev@Inferxe.com',
      password: 'StrongDev#2026!Password',
    })

    expect(result.ok).toBe(true)
    expect(result.admin?.role).toBe('admin')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/superadmin/admins',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      }),
    )

    // 409 Conflict surfaces structured duplicate metadata so the UI refreshes live admins
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        code: 'DUPLICATE_ADMIN_EMAIL',
        error: 'An administrator account with this email already exists.',
      }),
    }) as unknown as typeof fetch

    const dupResult = await createDeveloperAdminAccount({
      email: 'diya@inferxe.com',
      password: 'StrongDev#2026!Password',
    })
    expect(dupResult.ok).toBe(false)
    expect(dupResult.statusCode).toBe(409)
    expect(dupResult.code).toBe('DUPLICATE_ADMIN_EMAIL')
    expect(dupResult.isDuplicate).toBe(true)

    // 503 ADMIN_SCHEMA_MIGRATION_REQUIRED must NOT be flagged as duplicate email
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        ok: false,
        code: 'ADMIN_SCHEMA_MIGRATION_REQUIRED',
        error:
          'Administrator creation is temporarily unavailable because the database schema currently restricts accounts to a single active administrator. Apply the pending admin schema migration before creating additional administrators.',
      }),
    }) as unknown as typeof fetch

    const migrationRequiredResult = await createDeveloperAdminAccount({
      email: 'diya@inferxe.com',
      password: 'StrongDev#2026!Password',
    })
    expect(migrationRequiredResult.ok).toBe(false)
    expect(migrationRequiredResult.statusCode).toBe(503)
    expect(migrationRequiredResult.code).toBe('ADMIN_SCHEMA_MIGRATION_REQUIRED')
    expect(migrationRequiredResult.isDuplicate).toBe(false)
    expect(migrationRequiredResult.error).toContain('schema migration')
  })

  it('removes all 10 placeholder demo admins and stale local-only caches, then syncs live admins from GET /api/superadmin/admins', async () => {
    expect(DEFAULT_ADMIN_ACCOUNTS).toEqual([])

    // Seed legacy demo records AND legacy local-only adm-* accounts without isDemo flag
    localStorage.setItem(
      'inferxe_super_admin_accounts_v1',
      JSON.stringify([
        { id: 'adm-001', fullName: 'Bhumireddy Sahith', email: 'bhumireddy@inferxe.com', role: 'super_admin', status: 'active', isDemo: true },
        { id: 'adm-002', fullName: 'Alex Chen', email: 'alex.chen@inferxe.com', role: 'infrastructure_admin', status: 'active', isDemo: true },
      ]),
    )
    localStorage.setItem(
      'inferxe_dev_admin_accounts_v2',
      JSON.stringify([
        { id: 'adm-m4x9a', fullName: 'Diya', email: 'diya@inferxe.com', role: 'admin', status: 'active' },
      ]),
    )
    expect(getAdminAccounts()).toEqual([])
    expect(localStorage.getItem('inferxe_super_admin_accounts_v1')).toBeNull()
    expect(localStorage.getItem('inferxe_dev_admin_accounts_v2')).toBeNull()

    const signedJwt = adminToken('adm1', 'superadmin')
    saveSession({
      token: signedJwt,
      user: {
        id: 'd9a494cb-1e8d-4bca-8142-19687fa9138b',
        fullName: 'Inferxe Super Admin',
        email: 'admin@inferxe.com',
        username: 'admin',
        role: 'superadmin',
      },
      expiresAt: Date.now() + 60_000,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        admins: [
          {
            id: 'd9a494cb-1e8d-4bca-8142-19687fa9138b',
            email: 'admin@inferxe.com',
            full_name: 'Inferxe Super Admin',
            role: 'superadmin',
            is_active: true,
            status: 'active',
            session_version: 2,
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'dev-uuid-123',
            email: 'dev.ops@inferxe.com',
            full_name: 'Dev Ops',
            role: 'admin',
            is_active: true,
            status: 'active',
            session_version: 1,
            created_at: '2026-11-18T00:00:00Z',
          },
        ],
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const syncRes = await syncAdminAccountsFromBackend()
    expect(syncRes.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/superadmin/admins',
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
      }),
    )
    expect(syncRes.accounts.length).toBe(2)
    expect(syncRes.accounts[0].email).toBe('admin@inferxe.com')
    expect(syncRes.accounts[0].role).toBe('super_admin')
    expect(syncRes.accounts[0].isSuperAdmin).toBe(true)
    expect(syncRes.accounts[1].email).toBe('dev.ops@inferxe.com')
    expect(syncRes.accounts[1].role).toBe('admin')
    expect(syncRes.accounts[1].isSuperAdmin).toBe(false)
    expect(getAdminAccounts().length).toBe(2)
  })

  it('updateSuperadminAdmin issues PATCH /api/superadmin/admins/:id and handles duplicate email 409 and success', async () => {
    const superadminJwt = adminToken('super-1', 'superadmin')
    saveSession({
      token: superadminJwt,
      user: {
        id: 'super-1',
        fullName: 'Super Admin',
        email: 'admin@inferxe.com',
        username: 'admin',
        role: 'superadmin',
      },
      expiresAt: Date.now() + 60_000,
    })

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        admin: {
          id: 'dev-1',
          email: 'dev.updated@inferxe.com',
          role: 'admin',
          session_version: 2,
        },
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const updateRes = await updateSuperadminAdmin('dev-1', {
      email: 'dev.updated@inferxe.com',
      password: 'NewDevPassword#2026!',
      reason: 'Periodic rotation',
    })

    expect(updateRes.ok).toBe(true)
    expect(updateRes.admin?.email).toBe('dev.updated@inferxe.com')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/superadmin/admins/dev-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: `Bearer ${superadminJwt}`,
        }),
      }),
    )

    // 409 Duplicate email
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        code: 'DUPLICATE_ADMIN_EMAIL',
        error: 'An administrator account with this email already exists.',
      }),
    })

    const dupRes = await updateSuperadminAdmin('dev-1', { email: 'existing@inferxe.com' })
    expect(dupRes.ok).toBe(false)
    expect(dupRes.isDuplicate).toBe(true)
    expect(dupRes.statusCode).toBe(409)
  })

  it('deleteSuperadminAdmin issues DELETE /api/superadmin/admins/:id and handles success and errors', async () => {
    const superadminJwt = adminToken('super-1', 'superadmin')
    saveSession({
      token: superadminJwt,
      user: {
        id: 'super-1',
        fullName: 'Super Admin',
        email: 'admin@inferxe.com',
        username: 'admin',
        role: 'superadmin',
      },
      expiresAt: Date.now() + 60_000,
    })

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        message: 'Administrator account deleted successfully.',
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const deleteRes = await deleteSuperadminAdmin('dev-1', 'Offboarding')
    expect(deleteRes.ok).toBe(true)
    expect(deleteRes.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/superadmin/admins/dev-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: `Bearer ${superadminJwt}`,
        }),
      }),
    )

    // 403 Forbidden (e.g. attempting to delete Super Admin)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        error: 'Super Admin account cannot be deleted.',
      }),
    })

    const failRes = await deleteSuperadminAdmin('super-1')
    expect(failRes.ok).toBe(false)
    expect(failRes.statusCode).toBe(403)
    expect(failRes.error).toContain('cannot be deleted')
  })

  it('enforces RBAC permissions correctly via hasPermission and canonical role definitions', () => {
    // 1. Verify canonical role store definitions
    expect(PLATFORM_PERMISSIONS.length).toBe(21)
    const superRole = STANDARD_ROLES.find((r) => r.id === 'superadmin')
    const adminRole = STANDARD_ROLES.find((r) => r.id === 'admin')
    expect(superRole?.permissions.length).toBe(21)
    expect(adminRole?.permissions.length).toBe(10)

    // 2. Unauthenticated check returns false
    clearSession()
    expect(hasPermission('dashboard:view')).toBe(false)
    expect(hasPermission('admin:accounts:view')).toBe(false)

    // 3. Super Admin has all permissions
    saveSession({
      token: adminToken('super-1', 'superadmin'),
      user: {
        id: 'super-1',
        fullName: 'Super Admin',
        email: 'admin@inferxe.com',
        username: 'admin',
        role: 'superadmin',
      },
      expiresAt: Date.now() + 60_000,
    })
    expect(hasPermission('dashboard:view')).toBe(true)
    expect(hasPermission('admin:accounts:view')).toBe(true)
    expect(hasPermission('admin:roles:manage')).toBe(true)

    // 4. Standard Admin has operational permissions only
    saveSession({
      token: adminToken('dev-1', 'admin'),
      user: {
        id: 'dev-1',
        fullName: 'Dev Admin',
        email: 'dev@inferxe.com',
        username: 'dev',
        role: 'admin',
        permissions: adminRole?.permissions,
      },
      expiresAt: Date.now() + 60_000,
    })
    expect(hasPermission('dashboard:view')).toBe(true)
    expect(hasPermission('users:view')).toBe(true)
    expect(hasPermission('users:manage')).toBe(true)
    expect(hasPermission('api:keys:view')).toBe(true)
    expect(hasPermission('ssh:keys:view')).toBe(true)
    expect(hasPermission('notebooks:view')).toBe(true)
    expect(hasPermission('admin:accounts:view')).toBe(false)
    expect(hasPermission('admin:accounts:manage')).toBe(false)
    expect(hasPermission('admin:roles:view')).toBe(false)
    expect(hasPermission('admin:roles:manage')).toBe(false)
    expect(hasPermission('admin:permissions:manage')).toBe(false)
    expect(hasPermission('audit:logs:view')).toBe(false)
  })
})
