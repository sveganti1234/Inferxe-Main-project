import { getSession, isJwtExpired, refreshCustomerSession, decodeJwt } from './authStore'

export type ActivityStatus = 'Online' | 'Active' | 'Inactive'
export type AccountStatus = 'active' | 'suspended'

export interface CustomerRecord {
  customer_id: string
  cognito_sub: string
  full_name: string
  email: string
  phone_number: string | null
  organization: string | null
  role: string
  registration_date: string
  last_login_at: string | null
  last_active_at: string
  last_heartbeat_at: string
  account_status: AccountStatus
  activity_status: ActivityStatus
  login_count?: number
  is_test_account?: boolean
  created_at: string
  updated_at: string
}

export interface CustomerActivityLog {
  id: string
  customer_id: string
  event_type: 'registration' | 'login' | 'logout' | 'activity_update'
  event_timestamp: string
  metadata?: Record<string, unknown>
}

export interface CustomerDetailsRecord extends CustomerRecord {
  login_count: number
  previous_logins?: string[]
  activity_logs: CustomerActivityLog[]
}

export interface CustomerSummary {
  total: number
  total_real?: number
  total_test?: number
  active_count?: number
  online: number
  active: number
  inactive: number
  suspended?: number
}

export interface CustomerListResponse {
  ok: boolean
  customers: CustomerRecord[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export interface DatabaseBackupResult {
  ok: boolean
  backupFile: string
  backupPath: string
  sizeBytes: number
  timestamp: string
}

function getAdminAuthToken(): string | null {
  const session = getSession()
  return session?.token || null
}

/**
 * Fetch dynamic customer summary cards metrics (Total, Online, Active, Inactive).
 */
export async function fetchCustomerSummary(accountType?: 'all' | 'real' | 'test'): Promise<CustomerSummary> {
  const token = getAdminAuthToken()
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const query = accountType ? `?accountType=${accountType}` : ''
  const res = await fetch(`/api/admin/customers/summary${query}`, { headers })
  if (!res.ok) {
    throw new Error(`Failed to load customer summary: ${res.statusText}`)
  }

  const data = await res.json()
  return data.summary as CustomerSummary
}

/**
 * Fetch paginated customer records with search, activity status filtering, and sorting.
 */
export async function fetchCustomers(params: {
  search?: string
  status?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  limit?: number
  accountType?: 'all' | 'real' | 'test'
}): Promise<CustomerListResponse> {
  const token = getAdminAuthToken()
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.status && params.status !== 'all') query.set('status', params.status)
  if (params.sortBy) query.set('sortBy', params.sortBy)
  if (params.sortOrder) query.set('sortOrder', params.sortOrder)
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.accountType) query.set('accountType', params.accountType)

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`/api/admin/customers?${query.toString()}`, { headers })
  if (!res.ok) {
    throw new Error(`Failed to retrieve customers: ${res.statusText}`)
  }

  return res.json() as Promise<CustomerListResponse>
}

/**
 * Fetch full customer profile and activity history ledger for the details drawer.
 */
export async function fetchCustomerDetails(customerId: string): Promise<CustomerDetailsRecord> {
  const token = getAdminAuthToken()
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`, { headers })
  if (!res.ok) {
    throw new Error(`Failed to load customer details: ${res.statusText}`)
  }

  const data = await res.json()
  return data.customer as CustomerDetailsRecord
}

/**
 * Trigger an automated backup of the SQLite customer database.
 */
export async function createDatabaseBackup(): Promise<DatabaseBackupResult> {
  const token = getAdminAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch('/api/admin/customers/backup', {
    method: 'POST',
    headers,
  })

  if (!res.ok) {
    throw new Error(`Backup creation failed: ${res.statusText}`)
  }

  const data = await res.json()
  return data.backup as DatabaseBackupResult
}

/**
 * Export all customer records (including inactive) as an RFC 4180 CSV file downloaded in browser.
 */
export async function exportCustomersCsv(accountType?: 'all' | 'real' | 'test'): Promise<void> {
  const token = getAdminAuthToken()
  const headers: Record<string, string> = {
    Accept: 'text/csv',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const query = accountType ? `?accountType=${accountType}` : ''
  const res = await fetch(`/api/admin/customers/export${query}`, { headers })
  if (!res.ok) {
    throw new Error(`CSV Export failed: ${res.statusText}`)
  }

  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inferxe_customers_export_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

/**
 * Synchronize batch of existing Cognito customers into the central database.
 * Does not overwrite existing activity history or reset timestamps.
 */
export async function syncCognitoCustomers(
  customers?: Partial<CustomerRecord>[],
): Promise<{ ok: boolean; syncedCount: number; updatedCount: number; newCount: number }> {
  const token = getAdminAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch('/api/admin/customers/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ customers: customers || [] }),
  })

  if (!res.ok) {
    throw new Error(`Sync failed: ${res.statusText}`)
  }

  return res.json()
}

/**
 * Restore customer database from a backup file.
 */
export async function restoreDatabaseBackup(
  backupFile: string,
): Promise<{ ok: boolean; restoredFrom: string; customerCount: number }> {
  const token = getAdminAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch('/api/admin/customers/restore', {
    method: 'POST',
    headers,
    body: JSON.stringify({ backupFile }),
  })

  if (!res.ok) {
    throw new Error(`Database restoration failed: ${res.statusText}`)
  }

  const data = await res.json()
  return data.restored
}

/**
 * Client-side helper to record customer login or registration in database.
 */
export async function recordCustomerActivity(data: {
  cognito_sub?: string
  full_name?: string
  email: string
  phone_number?: string
  organization?: string
  role?: string
  account_status?: AccountStatus
  isLogin?: boolean
  metadata?: Record<string, unknown>
}): Promise<{ ok: boolean; customer?: CustomerRecord; error?: string }> {
  try {
    const session = getSession()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (session?.token) {
      headers['Authorization'] = `Bearer ${session.token}`
    }

    const res = await fetch('/api/customer/activity', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      return { ok: false, error: 'Failed to record activity' }
    }

    const resData = await res.json()
    return resData
  } catch (err: unknown) {
    console.error('Customer activity sync error:', err)
    return { ok: false, error: 'Network failure while recording activity' }
  }
}

/**
 * Persist the authenticated Cognito user in Supabase using the server-side service role.
 */
export async function syncCognitoProfile(
  idToken: string,
  extraProfile?: { organization?: string }
): Promise<void> {
  let response: Response
  try {
    const payload =
      extraProfile && typeof extraProfile.organization === 'string' && extraProfile.organization.trim()
        ? { organization: extraProfile.organization.trim() }
        : {}
    response = await fetch('/api/customer/profile/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    console.error('[profile-sync] Backend request failed.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Network request failed.',
    })
    const syncError = new Error('Profile synchronization failed. Please try signing in again.')
    syncError.name = 'ProfileSyncError'
    throw syncError
  }

  let result: { ok?: boolean; error?: string } = {}
  try {
    result = await response.json()
  } catch {
    console.error('[profile-sync] Backend returned a non-JSON response.', {
      status: response.status,
      contentType: response.headers.get('content-type'),
    })
  }

  if (!response.ok || result.ok !== true) {
    const message = result.error || `Profile synchronization failed (HTTP ${response.status}).`
    console.error('[profile-sync] Backend rejected profile synchronization.', {
      status: response.status,
      message,
    })
    const syncError = new Error(message)
    syncError.name = 'ProfileSyncError'
    throw syncError
  }
}

/**
 * Send periodic heartbeat to keep customer status 'Online'.
 * Runs approximately every 30-60 seconds.
 */
export async function sendCustomerHeartbeat(data?: {
  cognito_sub?: string
  email?: string
  session_id?: string
}): Promise<boolean> {
  try {
    let session = getSession()
    if (!session || !session.token || (session.token.split('.').length === 3 && isJwtExpired(session.token, 60))) {
      const refreshed = await refreshCustomerSession(true)
      if (refreshed) session = refreshed
    }
    if (!session || !session.token) return false

    // Skip heartbeat if token is still expired
    if (session.token.split('.').length === 3 && isJwtExpired(session.token, 10)) {
      return false
    }

    let cognitoSub = data?.cognito_sub || (session.user.id?.startsWith('usr_') ? undefined : session.user.id)
    if (!cognitoSub && session.token.split('.').length === 3) {
      const claims = decodeJwt(session.token)
      if (claims?.sub && !claims.sub.startsWith('usr_')) {
        cognitoSub = claims.sub
      }
    }

    const payload = {
      cognito_sub: cognitoSub,
      email: data?.email || session.user.email,
      session_id: data?.session_id,
    }

    let res = await fetch('/api/customer/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(payload),
    })

    // If backend returns 401, attempt refresh and retry once
    if (res.status === 401) {
      const refreshed = await refreshCustomerSession(true)
      if (refreshed?.token) {
        res = await fetch('/api/customer/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshed.token}`,
          },
          body: JSON.stringify(payload),
        })
      }
    }

    return res.ok
  } catch (err) {
    console.warn('[customerService] sendCustomerHeartbeat network failure:', err)
    return false
  }
}

/**
 * Notify server of customer logout to immediately update status.
 */
export async function sendCustomerLogout(data?: {
  cognito_sub?: string
  email?: string
  session_id?: string
  useKeepalive?: boolean
}): Promise<boolean> {
  try {
    const session = getSession()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (session?.token) {
      headers['Authorization'] = `Bearer ${session.token}`
    }

    let cognitoSub = data?.cognito_sub || (session?.user?.id?.startsWith('usr_') ? undefined : session?.user?.id)
    if (!cognitoSub && session?.token && session.token.split('.').length === 3) {
      const claims = decodeJwt(session.token)
      if (claims?.sub && !claims.sub.startsWith('usr_')) {
        cognitoSub = claims.sub
      }
    }

    const payload = {
      cognito_sub: cognitoSub,
      email: data?.email || session?.user?.email,
      session_id: data?.session_id,
    }

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }

    if (data?.useKeepalive) {
      fetchOptions.keepalive = true
    }

    const res = await fetch('/api/customer/logout', fetchOptions)
    return res.ok
  } catch (err) {
    console.warn('[customerService] sendCustomerLogout network failure:', err)
    return false
  }
}
