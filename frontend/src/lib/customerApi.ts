import { getSession } from './authStore'

export type CustomerApiRecord = Record<string, unknown>

export interface CustomerWorkspace {
  profile: CustomerApiRecord
  organizations: CustomerApiRecord[]
  gpu_listings: CustomerApiRecord[]
  saved_gpu_listings: CustomerApiRecord[]
  deployments: CustomerApiRecord[]
  orders: CustomerApiRecord[]
  usage_records: CustomerApiRecord[]
  wallet_accounts: CustomerApiRecord[]
  wallet_transactions: CustomerApiRecord[]
  api_keys: CustomerApiRecord[]
  ssh_public_keys: CustomerApiRecord[]
  notifications: CustomerApiRecord[]
  inference_requests: CustomerApiRecord[]
}

function isRecord(value: unknown): value is CustomerApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecordArray(value: unknown, field: string): CustomerApiRecord[] {
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`The server returned invalid ${field} data.`)
  }
  return value
}

async function customerRequest(path: string, init: RequestInit = {}): Promise<CustomerApiRecord> {
  const session = getSession()
  if (!session) throw new Error('Customer sign-in is required.')

  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      ...init.headers,
    },
  })
  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body)) throw new Error('The server returned an invalid response.')
  if (!response.ok || body.ok !== true) {
    throw new Error(typeof body.error === 'string' ? body.error : 'The customer data request failed.')
  }
  return body
}

export async function getCustomerWorkspace(): Promise<CustomerWorkspace> {
  const result = await customerRequest('/api/customer/workspace')
  if (!isRecord(result.workspace)) {
    throw new Error('The server returned an invalid customer workspace.')
  }

  const workspace = result.workspace
  const profile = workspace.profile
  if (!isRecord(profile)) throw new Error('The server returned an invalid customer profile.')
  return {
    profile,
    organizations: requireRecordArray(workspace.organizations, 'organizations'),
    gpu_listings: requireRecordArray(workspace.gpu_listings, 'GPU listings'),
    saved_gpu_listings: requireRecordArray(workspace.saved_gpu_listings, 'saved GPU listings'),
    deployments: requireRecordArray(workspace.deployments, 'deployments'),
    orders: requireRecordArray(workspace.orders, 'orders'),
    usage_records: requireRecordArray(workspace.usage_records, 'usage records'),
    wallet_accounts: requireRecordArray(workspace.wallet_accounts, 'wallet accounts'),
    wallet_transactions: requireRecordArray(workspace.wallet_transactions, 'wallet transactions'),
    api_keys: requireRecordArray(workspace.api_keys, 'API keys'),
    ssh_public_keys: requireRecordArray(workspace.ssh_public_keys, 'SSH keys'),
    notifications: requireRecordArray(workspace.notifications, 'notifications'),
    inference_requests: requireRecordArray(workspace.inference_requests, 'inference requests'),
  }
}

export async function updateCustomerProfile(fullName: string): Promise<CustomerApiRecord> {
  const result = await customerRequest('/api/customer/profile', {
    method: 'PATCH',
    body: JSON.stringify({ full_name: fullName }),
  })
  if (!isRecord(result.profile)) throw new Error('The server returned an invalid customer profile.')
  return result.profile
}

export async function createCustomerApiKey(name: string): Promise<{ apiKey: CustomerApiRecord; secret: string }> {
  const result = await customerRequest('/api/customer/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (!isRecord(result.api_key) || typeof result.secret !== 'string') {
    throw new Error('The server returned an invalid API key response.')
  }
  return { apiKey: result.api_key, secret: result.secret }
}

export async function revokeCustomerApiKey(id: string): Promise<CustomerApiRecord> {
  const result = await customerRequest(`/api/customer/api-keys/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  })
  if (!isRecord(result.api_key)) throw new Error('The server returned an invalid API key response.')
  return result.api_key
}

export async function addCustomerSshKey(name: string, publicKey: string): Promise<CustomerApiRecord> {
  const result = await customerRequest('/api/customer/ssh-keys', {
    method: 'POST',
    body: JSON.stringify({ name, public_key: publicKey }),
  })
  if (!isRecord(result.ssh_key)) throw new Error('The server returned an invalid SSH key response.')
  return result.ssh_key
}

export async function deleteCustomerSshKey(id: string): Promise<void> {
  await customerRequest(`/api/customer/ssh-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveCustomerListing(listingId: string): Promise<void> {
  await customerRequest('/api/customer/saved-listings', {
    method: 'POST',
    body: JSON.stringify({ listing_id: listingId }),
  })
}

export async function removeCustomerListing(listingId: string): Promise<void> {
  await customerRequest(`/api/customer/saved-listings/${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
  })
}

export async function updateCustomerNotification(id: string, isRead: boolean): Promise<CustomerApiRecord> {
  const result = await customerRequest(`/api/customer/notifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_read: isRead }),
  })
  if (!isRecord(result.notification)) throw new Error('The server returned an invalid notification response.')
  return result.notification
}

export async function deleteCustomerNotification(id: string): Promise<void> {
  await customerRequest(`/api/customer/notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function getCustomerStorageUrl(
  bucket: 'profile-avatars' | 'notebook-files' | 'inference-outputs' | 'model-artifacts',
  path: string,
  action: 'upload' | 'download',
): Promise<{ signedUrl: string; token: string | null; path: string }> {
  const result = await customerRequest('/api/customer/storage/signed-url', {
    method: 'POST',
    body: JSON.stringify({ bucket, path, action }),
  })
  if (typeof result.signed_url !== 'string' || typeof result.path !== 'string') {
    throw new Error('The server returned an invalid storage URL response.')
  }
  return {
    signedUrl: result.signed_url,
    token: typeof result.token === 'string' ? result.token : null,
    path: result.path,
  }
}
