import crypto from 'node:crypto'
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { authenticateCognitoRequest, readCustomerJsonBody, sendCustomerJson } from '../auth/customerAuth.js'
import { extractAdminTokenFromRequest, verifyAdminSession, verifyAdminToken } from '../auth/adminAuth.js'
import { getSupabaseAdminClient } from '../lib/supabase.js'
import { handleAdminCustomerApi } from './adminCustomersApi.js'

const WORKSPACE_SELECTS = {
  organizations: 'id, name, slug, billing_email, status, created_at',
  organization_members: 'id, organization_id, user_id, member_role, status, joined_at, created_at',
  customer_plans: 'user_id, tier, trial_started_at, trial_ends_at, updated_at',
  user_access_policies: 'id, user_id, organization_id, model_access, selected_models, provider_access, selected_providers, api_access, analytics_access, monthly_spend_limit, rate_limit, created_at, updated_at',
  gpu_providers: 'id, name, slug, region, status, created_at, updated_at',
  gpu_listings: 'id, provider_id, name, gpu_model, vram, architecture, bandwidth, tflops, region, quantity, hourly_price, currency, status, created_at, updated_at',
  saved_gpu_listings: 'id, user_id, listing_id, created_at',
  deployments: 'id, user_id, organization_id, listing_id, name, model_name, gpu_model, region, status, hourly_rate, currency, endpoint_url, started_at, stopped_at, metadata, created_at, updated_at',
  orders: 'id, user_id, organization_id, deployment_id, order_number, item_name, provider_name, order_date, duration_minutes, total_cost, currency, status, details, created_at, updated_at',
  usage_records: 'id, user_id, organization_id, deployment_id, order_id, model_name, gpu_model, input_tokens, output_tokens, duration_seconds, amount, currency, recorded_at, metadata',
  wallets: 'user_id, balance, currency, low_balance_alert_level, updated_at',
  wallet_transactions: 'id, user_id, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, transaction_type, direction',
  api_keys: 'id, user_id, organization_id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at, status',
  ssh_public_keys: 'id, user_id, name, public_key, fingerprint, created_at, revoked_at',
  notifications: 'id, user_id, title, detail, notification_type, is_read, created_at, read_at',
  order_reviews: 'id, order_id, user_id, rating, note, created_at, updated_at',
  notebook_sessions: 'id, user_id, deployment_id, name, status, session_url, storage_path, bot_access_enabled, started_at, stopped_at, created_at, updated_at',
  inference_requests: 'id, user_id, organization_id, api_key_id, deployment_id, model_name, provider_name, input_tokens, output_tokens, latency_ms, status, error_message, cost, created_at',
  customer_workspace_files: 'id, user_id, name, path, folder_path, is_folder, size_bytes, mime_type, storage_bucket, storage_path, created_at, updated_at',
}

const STORAGE_BUCKETS = new Set([
  'workspace-files',
  'profile-avatars',
  'notebook-files',
  'inference-outputs',
  'model-artifacts',
])
let cognitoAdminClient

function getCognitoAdminClient() {
  const region = process.env.AWS_REGION || process.env.AWS_COGNITO_REGION || process.env.COGNITO_REGION
  if (!region) throw new Error('A Cognito AWS region must be configured on the backend.')
  if (!cognitoAdminClient) cognitoAdminClient = new CognitoIdentityProviderClient({ region })
  return cognitoAdminClient
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function getBearerToken(req) {
  const authorization = req.headers.authorization
  return typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : ''
}

export async function getCustomerContext(req, deps = {}) {
  // deps: test-only injection; production always uses the real verifier and admin client.
  const claims = await (deps.authenticate || authenticateCognitoRequest)(req)
  let supabase
  try {
    supabase = deps.supabase || getSupabaseAdminClient()
  } catch (err) {
    // Fail closed: never build a customer context (identity, organization or role) from token claims alone.
    console.error('[customer-api] Supabase client unavailable:', err?.message || 'unknown error')
    const error = new Error('Customer data service is temporarily unavailable.')
    error.statusCode = 503
    throw error
  }

  // Both lookups depend only on the token's sub, so run them concurrently (one round-trip of
  // latency instead of two). The profile checks below still run first, so error precedence is unchanged.
  const [result, membershipResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id, full_name, email, username, avatar_path, role, status, organization_id')
      .eq('user_id', claims.sub)
      .maybeSingle(),
    supabase
      .from('organization_members')
      .select(WORKSPACE_SELECTS.organization_members)
      .eq('user_id', claims.sub)
      .eq('status', 'active'),
  ])

  if (result.error) throw result.error
  let profileData = result.data
  if (!profileData && claims.sub) {
    try {
      const email = (claims.email || '').toLowerCase() || 'customer@inferxe.com'
      const fullName = (typeof claims.name === 'string' && claims.name.trim()) ||
        (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
        email.split('@')[0] || 'Customer'
      const username = (typeof claims['cognito:username'] === 'string' && claims['cognito:username']) ||
        email.split('@')[0] || 'customer'
      const upsert = await supabase
        .from('profiles')
        .upsert({
          user_id: claims.sub,
          full_name: fullName,
          email,
          username,
          avatar_path: null,
          role: 'customer',
          status: 'active',
          organization_id: 'org_inferxe_dev',
        })
        .select('user_id, full_name, email, username, avatar_path, role, status, organization_id')
        .maybeSingle()
      if (upsert.data) {
        profileData = upsert.data
      }
    } catch {
      // Fallback
    }
  }

  if (!profileData) {
    const error = new Error('Customer profile has not been synchronized.')
    error.statusCode = 403
    throw error
  }
  if (profileData.status !== 'active') {
    const error = new Error('This account is not active.')
    error.statusCode = 403
    throw error
  }
  if (profileData.role === 'admin') {
    const error = new Error('Use the separate administrator sign-in.')
    error.statusCode = 403
    throw error
  }
  if (membershipResult.error) throw membershipResult.error

  const organizationIds = [...new Set([
    profileData.organization_id,
    ...(membershipResult.data || []).map((membership) => membership.organization_id),
  ].filter(Boolean))]

  return {
    claims,
    profile: profileData,
    memberships: membershipResult.data || [],
    organizationIds,
    supabase,
  }
}

async function getRows(supabase, table, columnList, field, value) {
  try {
    let query = supabase.from(table).select(columnList)
    if (value !== undefined && value !== null) query = query.eq(field, value)
    const result = await query
    if (result.error) {
      console.warn(`[customer-api] Query warning for table '${table}':`, result.error.message || result.error)
      return []
    }
    return result.data || []
  } catch (err) {
    console.warn(`[customer-api] Query exception for table '${table}':`, err?.message || err)
    return []
  }
}

/**
 * Inserts a customer notification safely with schema-adaptive fallback.
 * Follows existing notification schema conventions (detail, message, related_entity_id, metadata).
 * Failures are caught and logged without disrupting the calling deployment or status flow.
 */
export async function insertCustomerNotificationSafe(supabase, {
  userId,
  title,
  message,
  notificationType = 'GPU_DEPLOYMENT',
  relatedEntityId = null,
  metadata = null,
}) {
  if (!supabase || !userId) return null
  const now = new Date().toISOString()
  const notifId = crypto.randomUUID()
  const metaStr = typeof metadata === 'object' && metadata ? JSON.stringify(metadata) : '{}'

  try {
    // Attempt 1: Full record with detail, message, related_entity_id, metadata
    const res1 = await supabase.from('notifications').insert({
      id: notifId,
      user_id: userId,
      title,
      detail: message,
      message,
      notification_type: notificationType,
      is_read: false,
      related_entity_id: relatedEntityId,
      metadata: metaStr,
      created_at: now,
    })
    if (!res1.error) return res1.data

    // Attempt 2: Standard workspace schema with detail only
    const res2 = await supabase.from('notifications').insert({
      id: notifId,
      user_id: userId,
      title,
      detail: message,
      notification_type: notificationType,
      is_read: false,
      created_at: now,
    })
    if (!res2.error) return res2.data

    // Attempt 3: Schema with message only
    const res3 = await supabase.from('notifications').insert({
      id: notifId,
      user_id: userId,
      title,
      message,
      notification_type: notificationType,
      is_read: false,
      created_at: now,
    })
    if (!res3.error) return res3.data

    // Attempt 4: Minimal columns (id, user_id, title, notification_type, is_read, created_at)
    const res4 = await supabase.from('notifications').insert({
      id: notifId,
      user_id: userId,
      title,
      notification_type: notificationType,
      is_read: false,
      created_at: now,
    })
    if (res4.error) {
      console.warn('[customer-api] Failed to insert notification (all attempts):', res4.error.message || res4.error)
    }
    return res4.data || null
  } catch (err) {
    console.warn('[customer-api] Exception inserting notification for user', userId, ':', err?.message || err)
    return null
  }
}

async function getWorkspace(context) {
  const { claims, profile, memberships, organizationIds, supabase } = context
  const queries = [
    supabase.from('gpu_providers').select(WORKSPACE_SELECTS.gpu_providers).eq('status', 'active'),
    supabase.from('gpu_listings').select(WORKSPACE_SELECTS.gpu_listings).eq('status', 'available'),
    getRows(supabase, 'saved_gpu_listings', WORKSPACE_SELECTS.saved_gpu_listings, 'user_id', claims.sub),
    getRows(supabase, 'deployments', WORKSPACE_SELECTS.deployments, 'user_id', claims.sub),
    getRows(supabase, 'orders', WORKSPACE_SELECTS.orders, 'user_id', claims.sub),
    getRows(supabase, 'usage_records', WORKSPACE_SELECTS.usage_records, 'user_id', claims.sub),
    getRows(supabase, 'wallets', WORKSPACE_SELECTS.wallets, 'user_id', claims.sub)
      .catch(() => []),
    getRows(supabase, 'wallet_transactions', WORKSPACE_SELECTS.wallet_transactions, 'user_id', claims.sub),
    getRows(supabase, 'api_keys', WORKSPACE_SELECTS.api_keys, 'user_id', claims.sub),
    getRows(supabase, 'ssh_public_keys', WORKSPACE_SELECTS.ssh_public_keys, 'user_id', claims.sub),
    getRows(supabase, 'notifications', WORKSPACE_SELECTS.notifications, 'user_id', claims.sub),
    getRows(supabase, 'order_reviews', WORKSPACE_SELECTS.order_reviews, 'user_id', claims.sub),
    getRows(supabase, 'notebook_sessions', WORKSPACE_SELECTS.notebook_sessions, 'user_id', claims.sub),
    getRows(supabase, 'inference_requests', WORKSPACE_SELECTS.inference_requests, 'user_id', claims.sub),
    getRows(supabase, 'user_access_policies', WORKSPACE_SELECTS.user_access_policies, 'user_id', claims.sub),
    getRows(supabase, 'customer_plans', WORKSPACE_SELECTS.customer_plans, 'user_id', claims.sub),
  ]

  if (organizationIds.length) {
    queries.push(
      supabase.from('organizations').select(WORKSPACE_SELECTS.organizations).in('id', organizationIds),
    )
  } else {
    queries.push(Promise.resolve({ data: [], error: null }))
  }

  const results = await Promise.all(queries)
  const [
    providers,
    listingsResult,
    savedListings,
    deployments,
    orders,
    usageRecords,
    walletRows,
    walletTransactions,
    apiKeys,
    sshKeys,
    notifications,
    reviews,
    notebookSessions,
    inferenceRequests,
    accessPolicies,
    customerPlans,
    organizationsResult,
  ] = results

  for (const result of results) {
    if (result?.error) {
      if (result.error.code === '42501') continue
      throw result.error
    }
  }

  return {
    profile: {
      user_id: profile.user_id,
      full_name: profile.full_name,
      email: profile.email,
      username: profile.username,
      avatar_path: profile.avatar_path,
      role: profile.role,
      status: profile.status,
      organization_id: profile.organization_id,
    },
    organizations: organizationsResult.data || [],
    organization_members: memberships,
    user_access_policies: accessPolicies,
    gpu_providers: providers.data || [],
    gpu_listings: listingsResult.data || [],
    saved_gpu_listings: savedListings,
    deployments,
    orders,
    usage_records: usageRecords,
    wallet: walletRows?.[0] || null,
    wallet_transactions: walletTransactions,
    api_keys: apiKeys,
    ssh_public_keys: sshKeys,
    notifications,
    order_reviews: reviews,
    notebook_sessions: notebookSessions,
    inference_requests: inferenceRequests,
    customer_plans: customerPlans,
  }
}

async function verifyAdminRequest(req, requiredPermission) {
  const token = extractAdminTokenFromRequest(req)
  if (!token) {
    const error = new Error('Administrator token is required.')
    error.statusCode = 401
    error.code = 'UNAUTHORIZED'
    throw error
  }
  const secret = String(process.env.ADMIN_SESSION_SECRET || '').trim()
  if (!secret || secret.length < 32) {
    const error = new Error('Administrator authentication is not configured.')
    error.statusCode = 503
    error.code = 'ADMIN_AUTH_NOT_CONFIGURED'
    throw error
  }
  let verification
  try {
    verification = await verifyAdminSession(token, secret, {
      allowedRoles: ['admin', 'superadmin'],
      requiredPermission,
      ipAddress: req.socket?.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || '',
      path: req.url || '',
      method: req.method || 'GET',
    })
  } catch {
    const error = new Error('Administrator session verification service is temporarily unavailable.')
    error.statusCode = 503
    error.code = 'ADMIN_SESSION_ERROR'
    throw error
  }
  if (!verification.valid || !verification.admin) {
    const error = new Error(verification.error || 'Administrator authentication could not be verified.')
    error.statusCode = verification.statusCode || 401
    error.code = verification.code || undefined
    throw error
  }
  return verification.admin
}

async function getAdminUsers(supabase) {
  const profilesResult = await supabase
    .from('profiles')
    .select('user_id, full_name, email, username, avatar_path, role, status, auth_provider, last_active_at, organization_id, created_at')
    .order('created_at', { ascending: false })
  if (profilesResult.error) throw profilesResult.error

  const users = profilesResult.data || []
  if (!users.length) return []

  const policyResult = await supabase
    .from('user_access_policies')
    .select(WORKSPACE_SELECTS.user_access_policies)
    .in('user_id', users.map((user) => user.user_id))
  if (policyResult.error) throw policyResult.error

  const policies = new Map((policyResult.data || []).map((policy) => [
    `${policy.user_id}:${policy.organization_id || ''}`,
    policy,
  ]))

  const requestStats = await getInferenceRequestStats(supabase)

  return users.map((user) => {
    const stats = requestStats.get(user.user_id)
    const total = stats?.total ?? 0
    return {
      ...user,
      access_policy: policies.get(`${user.user_id}:${user.organization_id || ''}`) || null,
      // Real counts from inference_requests; no rate exists without requests.
      total_requests: total,
      success_rate: total > 0 ? Math.round((stats.succeeded / total) * 1000) / 10 : null,
    }
  })
}

/**
 * Per-user request totals from inference_requests (status 'success' counts as succeeded).
 * shortcut: scans rows in pages of 1000 in Node; move to a SQL view/RPC once request volume grows.
 */
async function getInferenceRequestStats(supabase) {
  const stats = new Map()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const page = await supabase.from('inference_requests').select('user_id, status').order('id').range(from, from + pageSize - 1)
    if (page.error) throw page.error
    for (const row of page.data || []) {
      const entry = stats.get(row.user_id) || { total: 0, succeeded: 0 }
      entry.total += 1
      if (typeof row.status === 'string' && row.status.toLowerCase() === 'success') entry.succeeded += 1
      stats.set(row.user_id, entry)
    }
    if (!page.data || page.data.length < pageSize) break
  }
  return stats
}

const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB
const MAX_SINGLE_UPLOAD_BYTES = 500 * 1024 * 1024 // 500 MB

function sanitizeStorageFileName(rawName) {
  if (typeof rawName !== 'string') return ''
  const trimmed = rawName.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return ''
  }
  return trimmed.slice(0, 255)
}

function sanitizeFolderPath(rawPath) {
  if (typeof rawPath !== 'string') return '/'
  const trimmed = rawPath.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed === '/' || trimmed === '.') return '/'
  let normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  normalized = normalized.replace(/\/+/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((seg) => seg === '.' || seg === '..' || seg.includes('\0'))) {
    return null
  }
  return `/${segments.join('/')}`
}

async function calculateCustomerStorageUsage(supabase, userId) {
  const result = await supabase
    .from('customer_workspace_files')
    .select('size_bytes')
    .eq('user_id', userId)
    .eq('is_folder', false)

  if (result.error) throw result.error
  const files = result.data || []
  const usedBytes = files.reduce((sum, f) => sum + (Number(f.size_bytes) || 0), 0)
  const totalFiles = files.length
  const quotaBytes = DEFAULT_STORAGE_QUOTA_BYTES
  const availableBytes = Math.max(0, quotaBytes - usedBytes)
  const quotaPercent = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 10000) / 100) : 0

  return {
    used_bytes: usedBytes,
    total_bytes: quotaBytes,
    available_bytes: availableBytes,
    total_files: totalFiles,
    quota_percent: quotaPercent,
  }
}

function validateStoragePath(path, userId) {
  if (typeof path !== 'string' || path.length > 500 || path.includes('\\') || path.includes('\0')) {
    return false
  }
  const segments = path.split('/')
  return path.startsWith(`${userId}/`) && segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

function calculateSshFingerprint(publicKey) {
  const parts = publicKey.trim().split(/\s+/)
  if (
    publicKey.length > 16000 ||
    parts.length < 2 ||
    !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(parts[0])
  ) {
    return null
  }
  try {
    const keyBlob = Buffer.from(parts[1], 'base64')
    if (!keyBlob.length || keyBlob.toString('base64').replace(/=+$/, '') !== parts[1].replace(/=+$/, '')) {
      return null
    }
    return `SHA256:${crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`
  } catch {
    return null
  }
}

export async function handleCustomerApi(req, res, path, deps = {}) {
  let context
  try {
    context = await getCustomerContext(req, deps)
  } catch (error) {
    return sendJson(res, error.statusCode || 401, {
      ok: false,
      error: error.statusCode ? error.message : 'Customer authentication could not be verified.',
    })
  }

  const { claims, supabase } = context
  try {
    if (path === '/api/customer/workspace' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, workspace: await getWorkspace(context) })
    }

    if (path === '/api/customer/profile' && req.method === 'PATCH') {
      const body = await readCustomerJsonBody(req)
      const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
      if (!fullName || fullName.length > 150) {
        return sendJson(res, 400, { ok: false, error: 'Full name must be between 1 and 150 characters.' })
      }
      const result = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('user_id', claims.sub)
        .select('user_id, full_name, email, username, avatar_path, role, status, organization_id')
        .single()
      if (result.error) throw result.error
      return sendJson(res, 200, { ok: true, profile: result.data })
    }

    if (path === '/api/customer/saved-listings' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      if (typeof body.listing_id !== 'string') {
        return sendJson(res, 400, { ok: false, error: 'A listing ID is required.' })
      }
      const listing = await supabase.from('gpu_listings').select('id').eq('id', body.listing_id).maybeSingle()
      if (listing.error) throw listing.error
      if (!listing.data) return sendJson(res, 404, { ok: false, error: 'GPU listing was not found.' })

      const result = await supabase
        .from('saved_gpu_listings')
        .upsert({ user_id: claims.sub, listing_id: listing.data.id }, { onConflict: 'user_id,listing_id' })
        .select(WORKSPACE_SELECTS.saved_gpu_listings)
        .single()
      if (result.error) throw result.error
      return sendJson(res, 201, { ok: true, saved_listing: result.data })
    }

    if (path.startsWith('/api/customer/saved-listings/') && req.method === 'DELETE') {
      const listingId = decodeURIComponent(path.slice('/api/customer/saved-listings/'.length))
      const result = await supabase
        .from('saved_gpu_listings')
        .delete()
        .eq('user_id', claims.sub)
        .eq('listing_id', listingId)
      if (result.error) throw result.error
      return sendJson(res, 200, { ok: true })
    }

    if (path === '/api/customer/deployments' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const modelName = typeof body.model_name === 'string' ? body.model_name.trim() : ''
      const gpuModel = typeof body.gpu_model === 'string' ? body.gpu_model.trim() : ''
      const region = typeof body.region === 'string' ? body.region.trim() : 'Mumbai, IN'
      const hourlyRate = typeof body.hourly_rate === 'number' && body.hourly_rate >= 0 ? body.hourly_rate : 60
      const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'INR'

      if (!name || name.length > 100) {
        return sendJson(res, 400, { ok: false, error: 'Endpoint name must be between 1 and 100 characters.' })
      }
      if (!modelName) {
        return sendJson(res, 400, { ok: false, error: 'A model is required for the deployment.' })
      }
      if (!gpuModel) {
        return sendJson(res, 400, { ok: false, error: 'A GPU selection is required for the deployment.' })
      }

      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const newRecord = {
        id,
        user_id: claims.sub,
        organization_id: context.profile.organization_id || null,
        name,
        model_name: modelName,
        gpu_model: gpuModel,
        region,
        status: 'provisioning',
        hourly_rate: hourlyRate,
        currency,
        endpoint_url: `https://${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.endpoints.inferxe.com/v1`,
        started_at: now,
        created_at: now,
        updated_at: now,
      }

      const result = await supabase
        .from('deployments')
        .insert(newRecord)
        .select(WORKSPACE_SELECTS.deployments)
        .single()

      if (result.error) throw result.error

      // Safe side-effect notification for deployment initiation
      await insertCustomerNotificationSafe(supabase, {
        userId: claims.sub,
        title: 'GPU Deployment Started',
        message: `Your ${gpuModel} deployment (${name}) has been initiated in ${region}.`,
        notificationType: 'GPU_DEPLOYMENT',
        relatedEntityId: id,
        metadata: {
          deployment_id: id,
          status: 'provisioning',
          gpu_model: gpuModel,
          model_name: modelName,
          region,
        },
      })

      return sendJson(res, 201, { ok: true, deployment: result.data })
    }

    if (path.startsWith('/api/customer/deployments/') && req.method === 'PATCH') {
      const deploymentId = decodeURIComponent(path.slice('/api/customer/deployments/'.length))
      const body = await readCustomerJsonBody(req)
      const allowedStatuses = ['running', 'stopped', 'provisioning', 'terminated', 'failed']
      const updateData = { updated_at: new Date().toISOString() }

      // Look up existing deployment to enforce ownership and detect genuine status changes
      const existing = await supabase
        .from('deployments')
        .select('id, user_id, status, name, gpu_model, region')
        .eq('id', deploymentId)
        .eq('user_id', claims.sub)
        .maybeSingle()

      if (existing.error) throw existing.error
      if (!existing.data) return sendJson(res, 404, { ok: false, error: 'Deployment was not found.' })

      const currentStatus = existing.data.status ? String(existing.data.status).toLowerCase().trim() : ''
      let nextStatus = null
      let statusChanged = false

      if (body.status !== undefined) {
        nextStatus = String(body.status).toLowerCase().trim()
        if (!allowedStatuses.includes(nextStatus)) {
          return sendJson(res, 400, { ok: false, error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` })
        }
        updateData.status = nextStatus
        if (nextStatus === 'running') {
          updateData.started_at = new Date().toISOString()
        } else if (nextStatus === 'stopped' || nextStatus === 'terminated') {
          updateData.stopped_at = new Date().toISOString()
        }
        if (currentStatus !== nextStatus) {
          statusChanged = true
        }
      }

      if (typeof body.name === 'string' && body.name.trim()) {
        updateData.name = body.name.trim().slice(0, 100)
      }

      const result = await supabase
        .from('deployments')
        .update(updateData)
        .eq('id', deploymentId)
        .eq('user_id', claims.sub)
        .select(WORKSPACE_SELECTS.deployments)
        .maybeSingle()

      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Deployment was not found.' })

      // Create notification only when status genuinely changed (prevent duplicates)
      if (statusChanged && nextStatus) {
        const depName = existing.data.name || result.data.name || deploymentId
        const gpuName = existing.data.gpu_model || result.data.gpu_model || 'GPU'
        const regionName = existing.data.region || result.data.region || 'cloud facility'

        let notifTitle = `GPU Deployment ${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}`
        let notifMessage = `Your ${gpuName} deployment (${depName}) is now ${nextStatus}.`

        if (nextStatus === 'running') {
          notifTitle = 'GPU Deployment Running'
          notifMessage = `Your ${gpuName} deployment (${depName}) is now live and serving requests in ${regionName}.`
        } else if (nextStatus === 'stopped') {
          notifTitle = 'GPU Deployment Paused'
          notifMessage = `Your ${gpuName} deployment (${depName}) has been stopped.`
        } else if (nextStatus === 'terminated') {
          notifTitle = 'GPU Deployment Terminated'
          notifMessage = `Your ${gpuName} compute instance (${depName}) has been terminated and resources released.`
        } else if (nextStatus === 'provisioning') {
          notifTitle = 'GPU Deployment Started'
          notifMessage = `Your ${gpuName} deployment (${depName}) is provisioning.`
        } else if (nextStatus === 'failed') {
          notifTitle = 'GPU Deployment Failed'
          notifMessage = `Your ${gpuName} deployment (${depName}) encountered an error and failed.`
        }

        await insertCustomerNotificationSafe(supabase, {
          userId: claims.sub,
          title: notifTitle,
          message: notifMessage,
          notificationType: nextStatus === 'failed' ? 'GPU_DEPLOYMENT_FAILED' : 'GPU_DEPLOYMENT',
          relatedEntityId: deploymentId,
          metadata: {
            deployment_id: deploymentId,
            previous_status: currentStatus,
            status: nextStatus,
          },
        })
      }

      return sendJson(res, 200, { ok: true, deployment: result.data })
    }

    if (path.startsWith('/api/customer/deployments/') && req.method === 'DELETE') {
      const deploymentId = decodeURIComponent(path.slice('/api/customer/deployments/'.length))

      const existing = await supabase
        .from('deployments')
        .select('id, user_id, status, name, gpu_model')
        .eq('id', deploymentId)
        .eq('user_id', claims.sub)
        .maybeSingle()

      if (existing.error) throw existing.error
      if (!existing.data) return sendJson(res, 404, { ok: false, error: 'Deployment was not found.' })

      const result = await supabase
        .from('deployments')
        .delete()
        .eq('id', deploymentId)
        .eq('user_id', claims.sub)
        .select('id')
        .maybeSingle()

      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Deployment was not found.' })

      await insertCustomerNotificationSafe(supabase, {
        userId: claims.sub,
        title: 'GPU Deployment Terminated',
        message: `Your ${existing.data.gpu_model || 'GPU'} compute instance (${existing.data.name || deploymentId}) has been deleted and resources released.`,
        notificationType: 'GPU_DEPLOYMENT',
        relatedEntityId: deploymentId,
        metadata: {
          deployment_id: deploymentId,
          previous_status: existing.data.status,
          status: 'terminated',
        },
      })

      return sendJson(res, 200, { ok: true, id: result.data.id })
    }

    if (path === '/api/customer/orders' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const orderNumber = typeof body.order_number === 'string' && body.order_number.trim()
        ? body.order_number.trim()
        : `ORD-${Math.floor(1000 + Math.random() * 9000)}`
      const itemName = typeof body.item_name === 'string' && body.item_name.trim()
        ? body.item_name.trim()
        : 'Compute Workload'
      const providerName = typeof body.provider_name === 'string' && body.provider_name.trim()
        ? body.provider_name.trim()
        : 'Inferxe Facility'
      const durationMinutes = typeof body.duration_minutes === 'number' && body.duration_minutes > 0
        ? body.duration_minutes
        : 60
      const totalCost = typeof body.total_cost === 'number' && body.total_cost >= 0
        ? body.total_cost
        : 0
      const currency = typeof body.currency === 'string' && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : 'INR'
      const allowedStatuses = ['running', 'completed', 'cancelled', 'archived']
      const status = typeof body.status === 'string' && allowedStatuses.includes(body.status.toLowerCase().trim())
        ? body.status.toLowerCase().trim()
        : 'running'

      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const newOrder = {
        id,
        user_id: claims.sub,
        organization_id: context.profile.organization_id || null,
        deployment_id: typeof body.deployment_id === 'string' ? body.deployment_id.trim() : null,
        order_number: orderNumber,
        item_name: itemName,
        provider_name: providerName,
        order_date: body.order_date || now,
        duration_minutes: durationMinutes,
        total_cost: totalCost,
        currency,
        status,
        details: typeof body.details === 'object' && body.details ? body.details : {},
        created_at: now,
        updated_at: now,
      }

      const result = await supabase
        .from('orders')
        .insert(newOrder)
        .select(WORKSPACE_SELECTS.orders)
        .single()

      if (result.error) throw result.error
      return sendJson(res, 201, { ok: true, order: result.data })
    }

    if (path.startsWith('/api/customer/orders/') && req.method === 'PATCH') {
      const orderId = decodeURIComponent(path.slice('/api/customer/orders/'.length))
      const body = await readCustomerJsonBody(req)
      const allowedStatuses = ['running', 'completed', 'cancelled', 'archived']
      const updateData = { updated_at: new Date().toISOString() }

      if (body.status !== undefined) {
        const nextStatus = String(body.status).toLowerCase().trim()
        if (!allowedStatuses.includes(nextStatus)) {
          return sendJson(res, 400, { ok: false, error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` })
        }
        updateData.status = nextStatus
      }

      if (typeof body.details === 'object' && body.details) {
        updateData.details = body.details
      }

      const result = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .eq('user_id', claims.sub)
        .select(WORKSPACE_SELECTS.orders)
        .maybeSingle()

      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Order was not found.' })
      return sendJson(res, 200, { ok: true, order: result.data })
    }

    if (path === '/api/customer/ssh-keys' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const publicKey = typeof body.public_key === 'string' ? body.public_key.trim() : ''
      const fingerprint = calculateSshFingerprint(publicKey)
      if (!name || name.length > 100 || !fingerprint) {
        return sendJson(res, 400, { ok: false, error: 'Provide a key name and a valid supported SSH public key.' })
      }
      const result = await supabase
        .from('ssh_public_keys')
        .insert({ user_id: claims.sub, name, public_key: publicKey, fingerprint })
        .select(WORKSPACE_SELECTS.ssh_public_keys)
        .single()
      if (result.error?.code === '23505') {
        return sendJson(res, 409, { ok: false, error: 'This SSH public key has already been added.' })
      }
      if (result.error) throw result.error

      await insertCustomerNotificationSafe(supabase, {
        userId: claims.sub,
        title: 'SSH Key Added',
        message: `SSH public key "${name}" (${fingerprint.slice(0, 16)}…) was added to your account.`,
        notificationType: 'SECURITY_KEY',
        relatedEntityId: result.data.id,
        metadata: {
          ssh_key_id: result.data.id,
          name,
          fingerprint,
          action: 'added',
        },
      })

      return sendJson(res, 201, { ok: true, ssh_key: result.data })
    }

    if (path.startsWith('/api/customer/ssh-keys/') && req.method === 'DELETE') {
      const keyId = decodeURIComponent(path.slice('/api/customer/ssh-keys/'.length))

      const existingKey = await supabase
        .from('ssh_public_keys')
        .select('id, name')
        .eq('id', keyId)
        .eq('user_id', claims.sub)
        .maybeSingle()

      const result = await supabase
        .from('ssh_public_keys')
        .delete()
        .eq('id', keyId)
        .eq('user_id', claims.sub)
      if (result.error) throw result.error

      await insertCustomerNotificationSafe(supabase, {
        userId: claims.sub,
        title: 'SSH Key Deleted',
        message: `SSH public key "${existingKey?.data?.name || keyId}" was removed from your account.`,
        notificationType: 'SECURITY_KEY',
        relatedEntityId: keyId,
        metadata: {
          ssh_key_id: keyId,
          name: existingKey?.data?.name,
          action: 'deleted',
        },
      })

      return sendJson(res, 200, { ok: true })
    }

    if (path === '/api/customer/api-keys' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 100) {
        return sendJson(res, 400, { ok: false, error: 'API key name must be between 1 and 100 characters.' })
      }
      const secret = `ix_live_${crypto.randomBytes(32).toString('base64url')}`
      const result = await supabase
        .from('api_keys')
        .insert({
          user_id: claims.sub,
          organization_id: context.profile.organization_id,
          name,
          key_prefix: secret.slice(0, 15),
          secret_hash: crypto.createHash('sha256').update(secret).digest('hex'),
        })
        .select(WORKSPACE_SELECTS.api_keys)
        .single()
      if (result.error) throw result.error

      await insertCustomerNotificationSafe(supabase, {
        userId: claims.sub,
        title: 'API Key Created',
        message: `A new API key "${name}" (${secret.slice(0, 15)}…) was successfully generated.`,
        notificationType: 'SECURITY_KEY',
        relatedEntityId: result.data.id,
        metadata: {
          key_id: result.data.id,
          name,
          key_prefix: secret.slice(0, 15),
          action: 'created',
        },
      })

      return sendJson(res, 201, { ok: true, api_key: result.data, secret })
    }

    if (path.startsWith('/api/customer/api-keys/') && path.endsWith('/revoke') && req.method === 'POST') {
      const keyId = decodeURIComponent(path.slice('/api/customer/api-keys/'.length, -'/revoke'.length))
      const result = await supabase
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', keyId)
        .eq('user_id', claims.sub)
        .select(WORKSPACE_SELECTS.api_keys)
        .maybeSingle()
      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'API key was not found.' })

      await insertCustomerNotificationSafe(supabase, {
        userId: claims.sub,
        title: 'API Key Revoked',
        message: `API key "${result.data.name || keyId}" was permanently revoked.`,
        notificationType: 'SECURITY_KEY',
        relatedEntityId: keyId,
        metadata: {
          key_id: keyId,
          name: result.data.name,
          action: 'revoked',
        },
      })

      return sendJson(res, 200, { ok: true, api_key: result.data })
    }

    if ((path === '/api/notifications' || path === '/api/customer/notifications') && req.method === 'GET') {
      const urlObj = new URL(req.url || '', 'http://localhost')
      const unreadOnly = urlObj.searchParams.get('unread_only') === 'true'
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit') || '50', 10), 1), 200)
      const offset = Math.max(parseInt(urlObj.searchParams.get('offset') || '0', 10), 0)

      let query = supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', claims.sub)

      if (unreadOnly) {
        query = query.eq('is_read', false)
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      const result = await query
      if (result.error) throw result.error

      const unreadResult = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', claims.sub)
        .eq('is_read', false)

      const total = result.count ?? (result.data ? result.data.length : 0)
      const unreadCount = unreadResult.count ?? 0

      return sendJson(res, 200, {
        total,
        unread_count: unreadCount,
        items: result.data || [],
      })
    }

    if ((path === '/api/notifications/unread-count' || path === '/api/customer/notifications/unread-count') && req.method === 'GET') {
      const unreadResult = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', claims.sub)
        .eq('is_read', false)

      return sendJson(res, 200, {
        unread_count: unreadResult.count ?? 0,
      })
    }

    if ((path === '/api/notifications/read-all' || path === '/api/customer/notifications/read-all') && req.method === 'PATCH') {
      const now = new Date().toISOString()
      const result = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: now })
        .eq('user_id', claims.sub)
        .eq('is_read', false)
        .select('id')

      if (result.error) throw result.error
      const updatedCount = result.data ? result.data.length : 0
      return sendJson(res, 200, { status: 'success', updated_count: updatedCount })
    }

    if ((path.startsWith('/api/notifications/') && path.endsWith('/read') && req.method === 'PATCH') ||
        (path.startsWith('/api/customer/notifications/') && req.method === 'PATCH')) {
      let notificationId
      let isRead = true
      if (path.endsWith('/read')) {
        notificationId = decodeURIComponent(path.slice('/api/notifications/'.length, -'/read'.length))
      } else {
        notificationId = decodeURIComponent(path.slice('/api/customer/notifications/'.length))
        const body = await readCustomerJsonBody(req)
        if (typeof body.is_read === 'boolean') {
          isRead = body.is_read
        }
      }

      const result = await supabase
        .from('notifications')
        .update({
          is_read: isRead,
          read_at: isRead ? new Date().toISOString() : null,
        })
        .eq('id', notificationId)
        .eq('user_id', claims.sub)
        .select(WORKSPACE_SELECTS.notifications)
        .maybeSingle()

      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Notification was not found.' })
      return sendJson(res, 200, { ok: true, notification: result.data })
    }

    if ((path.startsWith('/api/notifications/') || path.startsWith('/api/customer/notifications/')) && req.method === 'DELETE') {
      const prefix = path.startsWith('/api/notifications/') ? '/api/notifications/' : '/api/customer/notifications/'
      const notificationId = decodeURIComponent(path.slice(prefix.length))

      const result = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)
        .eq('user_id', claims.sub)
        .select('id')
        .maybeSingle()

      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Notification was not found.' })
      return sendJson(res, 200, { ok: true, deleted: true, id: notificationId })
    }

    if (path === '/api/customer/storage/files' && req.method === 'GET') {
      const urlObj = new URL(req.url || '', 'http://localhost')
      const rawFolder = urlObj.searchParams.get('folder') || '/'
      const search = (urlObj.searchParams.get('search') || '').trim()
      const folder = sanitizeFolderPath(rawFolder)
      if (folder === null) {
        return sendJson(res, 400, { ok: false, error: 'Invalid folder path.' })
      }

      let query = supabase
        .from('customer_workspace_files')
        .select(WORKSPACE_SELECTS.customer_workspace_files)
        .eq('user_id', claims.sub)

      if (search) {
        query = query.ilike('name', `%${search}%`)
      } else {
        query = query.eq('folder_path', folder)
      }

      query = query.order('is_folder', { ascending: false }).order('name', { ascending: true })

      const [itemsResult, usage] = await Promise.all([
        query,
        calculateCustomerStorageUsage(supabase, claims.sub),
      ])

      if (itemsResult.error) throw itemsResult.error

      return sendJson(res, 200, {
        ok: true,
        items: itemsResult.data || [],
        folder,
        usage,
      })
    }

    if (path === '/api/customer/storage/folders' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const folderPath = sanitizeFolderPath(body.folder_path || '/')
      const name = sanitizeStorageFileName(body.name)

      if (folderPath === null || !name) {
        return sendJson(res, 400, { ok: false, error: 'Valid folder path and name are required.' })
      }

      const fullPath = folderPath === '/' ? `/${name}` : `${folderPath}/${name}`

      const existing = await supabase
        .from('customer_workspace_files')
        .select('id')
        .eq('user_id', claims.sub)
        .eq('folder_path', folderPath)
        .eq('name', name)
        .maybeSingle()

      if (existing.error) throw existing.error
      if (existing.data) {
        return sendJson(res, 409, { ok: false, error: 'An item with this name already exists in this folder.' })
      }

      const insertResult = await supabase
        .from('customer_workspace_files')
        .insert({
          user_id: claims.sub,
          name,
          path: fullPath,
          folder_path: folderPath,
          is_folder: true,
          size_bytes: 0,
          mime_type: 'inode/directory',
          storage_bucket: 'workspace-files',
          storage_path: null,
        })
        .select(WORKSPACE_SELECTS.customer_workspace_files)
        .single()

      if (insertResult.error) throw insertResult.error
      return sendJson(res, 201, { ok: true, item: insertResult.data })
    }

    if (path === '/api/customer/storage/upload' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const folderPath = sanitizeFolderPath(body.folder_path || '/')
      const name = sanitizeStorageFileName(body.name)
      const mimeType = (typeof body.mime_type === 'string' && body.mime_type.trim()) || 'application/octet-stream'

      if (folderPath === null || !name) {
        return sendJson(res, 400, { ok: false, error: 'Valid folder path and file name are required.' })
      }

      let buffer
      if (typeof body.content_base64 === 'string') {
        buffer = Buffer.from(body.content_base64, 'base64')
      } else if (typeof body.content === 'string') {
        buffer = Buffer.from(body.content, 'utf8')
      } else {
        return sendJson(res, 400, { ok: false, error: 'File content must be provided in content or content_base64.' })
      }

      if (buffer.length > MAX_SINGLE_UPLOAD_BYTES) {
        return sendJson(res, 400, { ok: false, error: 'File size exceeds maximum upload limit of 500 MB.' })
      }

      const usage = await calculateCustomerStorageUsage(supabase, claims.sub)
      if (usage.used_bytes + buffer.length > usage.total_bytes) {
        return sendJson(res, 400, { ok: false, error: 'Storage quota exceeded. Your current quota is 10 GB.' })
      }

      const fullPath = folderPath === '/' ? `/${name}` : `${folderPath}/${name}`
      const storagePath = `${claims.sub}${fullPath}`

      const storage = supabase.storage.from('workspace-files')
      const uploadRes = await storage.upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      })
      if (uploadRes.error) throw uploadRes.error

      const upsertRes = await supabase
        .from('customer_workspace_files')
        .upsert(
          {
            user_id: claims.sub,
            name,
            path: fullPath,
            folder_path: folderPath,
            is_folder: false,
            size_bytes: buffer.length,
            mime_type: mimeType,
            storage_bucket: 'workspace-files',
            storage_path: storagePath,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,folder_path,name' }
        )
        .select(WORKSPACE_SELECTS.customer_workspace_files)
        .single()

      if (upsertRes.error) throw upsertRes.error
      return sendJson(res, 201, { ok: true, item: upsertRes.data })
    }

    if (path === '/api/customer/storage/register-file' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const folderPath = sanitizeFolderPath(body.folder_path || '/')
      const name = sanitizeStorageFileName(body.name)
      const sizeBytes = Number(body.size_bytes) || 0
      const mimeType = (typeof body.mime_type === 'string' && body.mime_type.trim()) || 'application/octet-stream'
      const storagePath = typeof body.storage_path === 'string' ? body.storage_path.trim() : ''

      if (folderPath === null || !name || !storagePath) {
        return sendJson(res, 400, { ok: false, error: 'Folder path, name, and storage path are required.' })
      }

      if (!validateStoragePath(storagePath, claims.sub)) {
        return sendJson(res, 403, { ok: false, error: 'Unauthorized storage path.' })
      }

      const usage = await calculateCustomerStorageUsage(supabase, claims.sub)
      if (usage.used_bytes + sizeBytes > usage.total_bytes) {
        return sendJson(res, 400, { ok: false, error: 'Storage quota exceeded. Your current quota is 10 GB.' })
      }

      const fullPath = folderPath === '/' ? `/${name}` : `${folderPath}/${name}`

      const upsertRes = await supabase
        .from('customer_workspace_files')
        .upsert(
          {
            user_id: claims.sub,
            name,
            path: fullPath,
            folder_path: folderPath,
            is_folder: false,
            size_bytes: sizeBytes,
            mime_type: mimeType,
            storage_bucket: 'workspace-files',
            storage_path: storagePath,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,folder_path,name' }
        )
        .select(WORKSPACE_SELECTS.customer_workspace_files)
        .single()

      if (upsertRes.error) throw upsertRes.error
      return sendJson(res, 201, { ok: true, item: upsertRes.data })
    }

    if (path.startsWith('/api/customer/storage/files/') && path.endsWith('/download') && req.method === 'GET') {
      const fileId = decodeURIComponent(path.slice('/api/customer/storage/files/'.length, -'/download'.length))
      if (!fileId) return sendJson(res, 400, { ok: false, error: 'File ID is required.' })

      const fileResult = await supabase
        .from('customer_workspace_files')
        .select(WORKSPACE_SELECTS.customer_workspace_files)
        .eq('id', fileId)
        .eq('user_id', claims.sub)
        .maybeSingle()

      if (fileResult.error) throw fileResult.error
      if (!fileResult.data) {
        return sendJson(res, 404, { ok: false, error: 'File was not found or access is denied.' })
      }

      const file = fileResult.data
      if (file.is_folder) {
        return sendJson(res, 400, { ok: false, error: 'Folders cannot be downloaded directly.' })
      }

      const storage = supabase.storage.from(file.storage_bucket || 'workspace-files')
      const signedRes = await storage.createSignedUrl(file.storage_path, 300, {
        download: file.name,
      })

      if (signedRes.error) throw signedRes.error

      return sendJson(res, 200, {
        ok: true,
        download_url: signedRes.data.signedUrl,
        name: file.name,
        size_bytes: file.size_bytes,
        mime_type: file.mime_type,
      })
    }

    if (path.startsWith('/api/customer/storage/files/') && req.method === 'DELETE') {
      const fileId = decodeURIComponent(path.slice('/api/customer/storage/files/'.length))
      if (!fileId) return sendJson(res, 400, { ok: false, error: 'File ID is required.' })

      const itemResult = await supabase
        .from('customer_workspace_files')
        .select(WORKSPACE_SELECTS.customer_workspace_files)
        .eq('id', fileId)
        .eq('user_id', claims.sub)
        .maybeSingle()

      if (itemResult.error) throw itemResult.error
      if (!itemResult.data) {
        return sendJson(res, 404, { ok: false, error: 'Item was not found or access is denied.' })
      }

      const item = itemResult.data
      const storage = supabase.storage.from(item.storage_bucket || 'workspace-files')

      if (item.is_folder) {
        // Collect descendants
        const descendantsResult = await supabase
          .from('customer_workspace_files')
          .select('id, storage_path, is_folder')
          .eq('user_id', claims.sub)
          .or(`path.eq.${item.path},path.like.${item.path}/%`)

        if (descendantsResult.error) throw descendantsResult.error
        const allItems = descendantsResult.data || []
        const storagePathsToDelete = allItems
          .filter((i) => !i.is_folder && i.storage_path)
          .map((i) => i.storage_path)

        if (storagePathsToDelete.length > 0) {
          try {
            await storage.remove(storagePathsToDelete)
          } catch (err) {
            console.warn('[customer-storage] Storage deletion warning:', err.message)
          }
        }

        const idsToDelete = [item.id, ...allItems.map((i) => i.id)]
        const deleteRows = await supabase
          .from('customer_workspace_files')
          .delete()
          .in('id', idsToDelete)
          .eq('user_id', claims.sub)

        if (deleteRows.error) throw deleteRows.error

        return sendJson(res, 200, {
          ok: true,
          deleted: true,
          id: fileId,
          count: idsToDelete.length,
        })
      } else {
        if (item.storage_path) {
          try {
            await storage.remove([item.storage_path])
          } catch (err) {
            console.warn('[customer-storage] Storage file deletion warning:', err.message)
          }
        }

        const deleteRow = await supabase
          .from('customer_workspace_files')
          .delete()
          .eq('id', fileId)
          .eq('user_id', claims.sub)

        if (deleteRow.error) throw deleteRow.error

        return sendJson(res, 200, { ok: true, deleted: true, id: fileId })
      }
    }

    if (path === '/api/customer/storage/signed-url' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const { bucket, path: objectPath, action } = body
      if (
        typeof bucket !== 'string' ||
        !STORAGE_BUCKETS.has(bucket) ||
        !validateStoragePath(objectPath, claims.sub) ||
        !['upload', 'download'].includes(action)
      ) {
        return sendJson(res, 400, { ok: false, error: 'Invalid or unauthorized storage request.' })
      }

      const storage = supabase.storage.from(bucket)
      const result = action === 'upload'
        ? await storage.createSignedUploadUrl(objectPath)
        : await storage.createSignedUrl(objectPath, 60)
      if (result.error) throw result.error
      return sendJson(res, 200, {
        ok: true,
        signed_url: result.data.signedUrl,
        token: result.data.token || null,
        path: result.data.path,
      })
    }

    return sendJson(res, 404, { ok: false, error: 'Customer API route not found.' })
  } catch (error) {
    console.error('[supabase-api] Customer operation failed:', error.message)
    return sendJson(res, error.statusCode || 503, {
      ok: false,
      error: error.statusCode ? error.message : 'The requested customer data is currently unavailable.',
    })
  }
}

async function handleAdminApi(req, res, path) {
  let admin
  try {
    const isManageRoute = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE'
    const requiredPermission = isManageRoute ? 'users:manage' : 'users:view'
    admin = await verifyAdminRequest(req, requiredPermission)
  } catch (error) {
    return sendJson(res, error.statusCode || 401, {
      ok: false,
      code: error.code || undefined,
      error: error.message,
    })
  }

  try {
    const supabase = getSupabaseAdminClient()
    if (path === '/api/admin/customers' || path.startsWith('/api/admin/customers/')) {
      return await handleAdminCustomerApi(req, res, path, { supabase, admin })
    }
    if (path === '/api/admin/data/users' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, users: await getAdminUsers(supabase) })
    }

    if (path === '/api/admin/data/users' && req.method === 'POST') {
      const body = await readCustomerJsonBody(req)
      const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const username = typeof body.username === 'string' && body.username.trim()
        ? body.username.trim()
        : email.split('@')[0]
      const userPoolId = process.env.AWS_COGNITO_USER_POOL_ID?.trim()
      const allowedRoles = ['customer', 'provider', 'developer', 'viewer']

      if (!userPoolId) {
        return sendJson(res, 503, { ok: false, error: 'AWS_COGNITO_USER_POOL_ID is not configured on the backend.' })
      }
      if (!fullName || fullName.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return sendJson(res, 400, { ok: false, error: 'A valid full name and email address are required.' })
      }
      if (!allowedRoles.includes(body.role)) {
        return sendJson(res, 400, { ok: false, error: 'Administrator accounts use the separate admin authentication system.' })
      }

      const existing = await supabase.from('profiles').select('user_id').eq('email', email).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data) return sendJson(res, 409, { ok: false, error: 'A profile with this email already exists.' })

      const monthlySpendLimit = body.monthly_spend_limit === '' ||
        body.monthly_spend_limit === undefined ||
        body.monthly_spend_limit === null
        ? null
        : Number(body.monthly_spend_limit)
      if (monthlySpendLimit !== null && (!Number.isFinite(monthlySpendLimit) || monthlySpendLimit < 0)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid monthly spending limit.' })
      }
      if (
        !['all', 'selected'].includes(body.model_access) ||
        !['all', 'selected'].includes(body.provider_access) ||
        !Array.isArray(body.selected_models) ||
        body.selected_models.some((value) => typeof value !== 'string') ||
        !Array.isArray(body.selected_providers) ||
        body.selected_providers.some((value) => typeof value !== 'string') ||
        typeof body.api_access !== 'boolean' ||
        typeof body.analytics_access !== 'boolean' ||
        typeof body.rate_limit !== 'string' ||
        typeof body.internal_note !== 'string'
      ) {
        return sendJson(res, 400, { ok: false, error: 'Invalid access policy fields.' })
      }

      let cognitoUserId
      let profileCreated = false
      try {
        const cognitoResult = await getCognitoAdminClient().send(new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'name', Value: fullName },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }))
        cognitoUserId = cognitoResult.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value
        if (!cognitoUserId) throw new Error('Cognito did not return the invited user subject.')

        const profileResult = await supabase
          .from('profiles')
          .insert({
            user_id: cognitoUserId,
            full_name: fullName,
            email,
            username,
            role: body.role,
            status: body.status === 'inactive' ? 'inactive' : 'pending',
            auth_provider: 'cognito',
          })
          .select('user_id, full_name, email, username, role, status, organization_id, created_at')
          .single()
        if (profileResult.error) throw profileResult.error
        profileCreated = true

        const selectedModels = body.model_access === 'selected' ? body.selected_models : []
        const selectedProviders = body.provider_access === 'selected' ? body.selected_providers : []
        const policyResult = await supabase.from('user_access_policies').insert({
          user_id: cognitoUserId,
          organization_id: null,
          model_access: body.model_access,
          selected_models: selectedModels,
          provider_access: body.provider_access,
          selected_providers: selectedProviders,
          api_access: body.api_access,
          analytics_access: body.analytics_access,
          monthly_spend_limit: monthlySpendLimit,
          rate_limit: body.rate_limit,
          internal_note: body.internal_note.trim(),
        })
        if (policyResult.error) throw policyResult.error

        const auditResult = await supabase.from('audit_logs').insert({
          action: 'admin.customer.invited',
          target_type: 'profile',
          target_id: cognitoUserId,
          details: { administrator_email: admin.email, email, role: body.role },
        })
        if (auditResult.error) throw auditResult.error

        return sendJson(res, 201, {
          ok: true,
          user: {
            ...profileResult.data,
            avatar_path: null,
            auth_provider: 'cognito',
            last_active_at: null,
            access_policy: {
              model_access: body.model_access,
              selected_models: selectedModels,
              provider_access: body.provider_access,
              selected_providers: selectedProviders,
              api_access: body.api_access,
              analytics_access: body.analytics_access,
              monthly_spend_limit: monthlySpendLimit,
              rate_limit: body.rate_limit,
              internal_note: body.internal_note.trim(),
            },
          },
        })
      } catch (error) {
        if (profileCreated && cognitoUserId) {
          const deleteProfile = await supabase.from('profiles').delete().eq('user_id', cognitoUserId)
          if (deleteProfile.error) {
            console.error('[supabase-api] Failed to roll back invited Cognito profile:', deleteProfile.error.message)
          }
        }
        if (cognitoUserId) {
          try {
            await getCognitoAdminClient().send(new AdminDeleteUserCommand({
              UserPoolId: userPoolId,
              Username: email,
            }))
          } catch (rollbackError) {
            console.error('[supabase-api] Failed to roll back Cognito invitation:', rollbackError.message)
          }
        }
        if (error.name === 'UsernameExistsException') {
          return sendJson(res, 409, { ok: false, error: 'A Cognito account with this email already exists.' })
        }
        throw error
      }
    }

    const userMatch = path.match(/^\/api\/admin\/data\/users\/([^/]+)$/)
    if (userMatch && req.method === 'PATCH') {
      const userId = decodeURIComponent(userMatch[1])
      const body = await readCustomerJsonBody(req)
      const profilePatch = {}
      const policyPatch = {}

      if (body.status !== undefined) {
        if (!['active', 'inactive', 'pending', 'suspended'].includes(body.status)) {
          return sendJson(res, 400, { ok: false, error: 'Invalid profile status.' })
        }
        profilePatch.status = body.status
      }
      if (body.role !== undefined) {
        if (!['customer', 'provider', 'developer', 'viewer'].includes(body.role)) {
          return sendJson(res, 400, { ok: false, error: 'Invalid customer role.' })
        }
        profilePatch.role = body.role
      }
      for (const field of ['model_access', 'provider_access']) {
        if (body[field] !== undefined) {
          if (!['all', 'selected'].includes(body[field])) {
            return sendJson(res, 400, { ok: false, error: `Invalid ${field}.` })
          }
          policyPatch[field] = body[field]
        }
      }
      for (const field of ['selected_models', 'selected_providers']) {
        if (body[field] !== undefined) {
          if (!Array.isArray(body[field]) || body[field].some((item) => typeof item !== 'string')) {
            return sendJson(res, 400, { ok: false, error: `Invalid ${field}.` })
          }
          policyPatch[field] = body[field]
        }
      }
      for (const field of ['api_access', 'analytics_access']) {
        if (body[field] !== undefined) {
          if (typeof body[field] !== 'boolean') {
            return sendJson(res, 400, { ok: false, error: `Invalid ${field}.` })
          }
          policyPatch[field] = body[field]
        }
      }
      if (body.monthly_spend_limit !== undefined) {
        if (body.monthly_spend_limit !== null && (!Number.isFinite(body.monthly_spend_limit) || body.monthly_spend_limit < 0)) {
          return sendJson(res, 400, { ok: false, error: 'Invalid monthly spending limit.' })
        }
        policyPatch.monthly_spend_limit = body.monthly_spend_limit
      }
      if (body.rate_limit !== undefined) {
        if (typeof body.rate_limit !== 'string' || body.rate_limit.length > 120) {
          return sendJson(res, 400, { ok: false, error: 'Invalid rate limit.' })
        }
        policyPatch.rate_limit = body.rate_limit
      }
      if (body.internal_note !== undefined) {
        if (typeof body.internal_note !== 'string' || body.internal_note.length > 2000) {
          return sendJson(res, 400, { ok: false, error: 'Invalid internal note.' })
        }
        policyPatch.internal_note = body.internal_note
      }
      if (!Object.keys(profilePatch).length && !Object.keys(policyPatch).length) {
        return sendJson(res, 400, { ok: false, error: 'No supported changes were provided.' })
      }

      const target = await supabase
        .from('profiles')
        .select('user_id, organization_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (target.error) throw target.error
      if (!target.data) return sendJson(res, 404, { ok: false, error: 'Customer profile was not found.' })

      if (Object.keys(profilePatch).length) {
        const update = await supabase.from('profiles').update(profilePatch).eq('user_id', userId)
        if (update.error) throw update.error
      }
      if (Object.keys(policyPatch).length) {
        let policyQuery = supabase
          .from('user_access_policies')
          .select('id')
          .eq('user_id', userId)
        policyQuery = target.data.organization_id
          ? policyQuery.eq('organization_id', target.data.organization_id)
          : policyQuery.is('organization_id', null)
        const existingPolicy = await policyQuery.maybeSingle()
        if (existingPolicy.error) throw existingPolicy.error

        const policyResult = existingPolicy.data
          ? await supabase.from('user_access_policies').update(policyPatch).eq('id', existingPolicy.data.id)
          : await supabase.from('user_access_policies').insert({
              user_id: userId,
              organization_id: target.data.organization_id,
              ...policyPatch,
            })
        if (policyResult.error) throw policyResult.error
      }

      const audit = await supabase.from('audit_logs').insert({
        action: 'admin.customer.updated',
        target_type: 'profile',
        target_id: userId,
        details: { administrator_email: admin.email, changed_fields: [...Object.keys(profilePatch), ...Object.keys(policyPatch)] },
      })
      if (audit.error) throw audit.error

      if (Object.keys(policyPatch).length || Object.keys(profilePatch).length) {
        const changedSummary = []
        if (policyPatch.monthly_spend_limit !== undefined) {
          changedSummary.push(`monthly spend limit set to ${policyPatch.monthly_spend_limit !== null ? '₹' + Number(policyPatch.monthly_spend_limit).toLocaleString('en-IN') : 'unlimited'}`)
        }
        if (policyPatch.rate_limit !== undefined) {
          changedSummary.push(`rate limit set to ${policyPatch.rate_limit}`)
        }
        if (policyPatch.model_access !== undefined) {
          changedSummary.push(`model access set to ${policyPatch.model_access}`)
        }
        if (profilePatch.role !== undefined) {
          changedSummary.push(`role set to ${profilePatch.role}`)
        }
        if (profilePatch.status !== undefined) {
          changedSummary.push(`status set to ${profilePatch.status}`)
        }

        const detailMsg = changedSummary.length
          ? `Your account limits were updated: ${changedSummary.join(', ')}.`
          : 'Your account allocation and resource limits were updated by an administrator.'

        await insertCustomerNotificationSafe(supabase, {
          userId,
          title: 'Account Limits Updated',
          message: detailMsg,
          notificationType: 'PLAN_UPDATE',
          metadata: {
            administrator_email: admin.email,
            changed_fields: [...Object.keys(profilePatch), ...Object.keys(policyPatch)],
          },
        })
      }

      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 404, { ok: false, error: 'Administrator data API route not found.' })
  } catch (error) {
    console.error('[supabase-api] Administrator operation failed:', error.message)
    return sendJson(res, error.statusCode || 503, {
      ok: false,
      error: error.statusCode ? error.message : 'The requested administrator data is currently unavailable.',
    })
  }
}

export function isAdminNotificationRequest(req, deps = {}) {
  const token = (deps.extractAdminToken || extractAdminTokenFromRequest)(req)
  if (!token || typeof token !== 'string') return false

  const trimmed = token.trim()
  if (trimmed.startsWith('ix-') || trimmed === 'admin-dev-token') return false

  const parts = trimmed.split('.')
  if (parts.length !== 3) return false

  // Inspect JWT header for HS256 algorithm
  try {
    const b64Header = parts[0].replace(/-/g, '+').replace(/_/g, '/')
    const header = JSON.parse(Buffer.from(b64Header, 'base64').toString('utf8'))
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return false
  } catch {
    return false
  }

  // Allow test injection if provided
  if (typeof deps.authenticateAdmin === 'function') {
    try {
      const res = deps.authenticateAdmin(req, trimmed)
      return Boolean(res && res.valid !== false)
    } catch {
      return false
    }
  }

  const secret = String(process.env.ADMIN_SESSION_SECRET || '').trim()
  if (secret.length >= 32) {
    const verified = verifyAdminToken(trimmed, secret, {
      allowedRoles: ['admin', 'superadmin', 'super_admin'],
    })
    return verified.valid === true
  }

  // Fallback: check claims payload has admin role before letting FastAPI verify full DB session
  try {
    const b64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64').toString('utf8'))
    return Boolean(payload && payload.sub && ['admin', 'superadmin', 'super_admin'].includes(payload.role))
  } catch {
    return false
  }
}

export function createSupabaseApiMiddleware(deps = {}) {
  return async function supabaseApiMiddleware(req, res, next) {
    const path = (req.url || '/').split('?')[0]
    if (path.startsWith('/api/notifications')) {
      if (isAdminNotificationRequest(req, deps)) {
        return next()
      }
      return handleCustomerApi(req, res, path, deps)
    }
    if (path.startsWith('/api/customer/')) return handleCustomerApi(req, res, path, deps)
    if (path.startsWith('/api/admin/data/') || path === '/api/admin/customers' || path.startsWith('/api/admin/customers/')) {
      return handleAdminApi(req, res, path)
    }
    return next()
  }
}
