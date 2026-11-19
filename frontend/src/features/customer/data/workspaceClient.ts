/**
 * GET /api/customer/workspace — the primary, read-only data source for the customer dashboard.
 * The backend scopes every collection to the authenticated Cognito identity.
 */
import { CustomerApiError, customerRequest, defaultMessage } from './http'
import { WORKSPACE_COLLECTIONS, type CustomerWorkspace, type WorkspaceProfile } from './types'

interface WorkspaceEnvelope {
  ok?: boolean
  workspace?: Partial<Record<keyof CustomerWorkspace, unknown>>
  error?: string
}

function normaliseProfile(raw: unknown): WorkspaceProfile {
  if (!raw || typeof raw !== 'object' || typeof (raw as { user_id?: unknown }).user_id !== 'string') {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
  const p = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    user_id: p.user_id as string,
    full_name: str(p.full_name),
    email: str(p.email),
    username: str(p.username),
    avatar_path: str(p.avatar_path),
    role: str(p.role),
    status: str(p.status),
    organization_id: str(p.organization_id),
  }
}

/** Convert the raw envelope into a workspace whose collections are always arrays. */
export function normaliseWorkspace(envelope: unknown): CustomerWorkspace {
  const env = envelope as WorkspaceEnvelope | null
  if (!env || typeof env !== 'object' || env.ok !== true || !env.workspace || typeof env.workspace !== 'object') {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
  const raw = env.workspace
  const workspace = { profile: normaliseProfile(raw.profile) } as CustomerWorkspace
  for (const key of WORKSPACE_COLLECTIONS) {
    const value = raw[key]
    ;(workspace as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? value : []
  }
  return workspace
}

export async function fetchCustomerWorkspace(signal?: AbortSignal): Promise<CustomerWorkspace> {
  const envelope = await customerRequest<unknown>('/api/customer/workspace', { signal })
  return normaliseWorkspace(envelope)
}
