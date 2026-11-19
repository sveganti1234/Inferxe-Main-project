/** Test-only fixtures for the customer dashboard data layer. Never imported by app code. */
import { WORKSPACE_COLLECTIONS, type CustomerWorkspace } from '../../features/customer/data/types'

export const TEST_SUB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

export function emptyWorkspace(overrides: Partial<CustomerWorkspace> = {}): CustomerWorkspace {
  const ws = {
    profile: {
      user_id: TEST_SUB,
      full_name: 'Test Customer',
      email: 'customer@example.test',
      username: 'cust_test',
      avatar_path: null,
      role: 'customer',
      status: 'active',
      organization_id: null,
    },
  } as CustomerWorkspace
  for (const key of WORKSPACE_COLLECTIONS) (ws as unknown as Record<string, unknown>)[key] = []
  return { ...ws, ...overrides }
}

/** Raw envelope as returned by GET /api/customer/workspace. */
export function workspaceEnvelope(ws: CustomerWorkspace = emptyWorkspace()) {
  return { ok: true, workspace: ws }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const SESSION = {
  token: 'header.payload.signature',
  user: { id: TEST_SUB, fullName: 'Test Customer', email: 'customer@example.test', username: 'cust_test', role: 'customer' },
  expiresAt: Date.now() + 3_600_000,
}
