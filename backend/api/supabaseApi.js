import crypto from 'node:crypto'
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { authenticateCognitoRequest, readCustomerJsonBody, sendCustomerJson } from '../auth/customerAuth.js'
import { verifyAdminToken } from '../auth/adminAuth.js'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const WORKSPACE_SELECTS = {
  organizations: 'id, name, slug, billing_email, status, created_at',
  organization_members: 'id, organization_id, user_id, member_role, status, joined_at, created_at',
  user_access_policies: 'id, user_id, organization_id, model_access, selected_models, provider_access, selected_providers, api_access, analytics_access, monthly_spend_limit, rate_limit, created_at, updated_at',
  gpu_providers: 'id, name, slug, region, status, created_at, updated_at',
  gpu_listings: 'id, provider_id, name, gpu_model, vram, architecture, bandwidth, tflops, region, quantity, hourly_price, currency, status, created_at, updated_at',
  saved_gpu_listings: 'id, user_id, listing_id, created_at',
  deployments: 'id, user_id, organization_id, listing_id, name, model_name, gpu_model, region, status, hourly_rate, endpoint_url, started_at, stopped_at, metadata, created_at, updated_at',
  orders: 'id, user_id, organization_id, deployment_id, order_number, item_name, provider_name, order_date, duration_minutes, total_cost, currency, status, details, created_at, updated_at',
  usage_records: 'id, user_id, organization_id, deployment_id, order_id, model_name, gpu_model, input_tokens, output_tokens, duration_seconds, amount, currency, recorded_at, metadata',
  wallet_accounts: 'id, user_id, organization_id, balance, currency, status, created_at, updated_at',
  wallet_transactions: 'id, wallet_id, user_id, order_id, transaction_reference, transaction_type, direction, amount, currency, status, description, created_at',
  api_keys: 'id, user_id, organization_id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at, status',
  ssh_public_keys: 'id, user_id, name, public_key, fingerprint, created_at, revoked_at',
  notifications: 'id, user_id, title, detail, notification_type, is_read, created_at, read_at',
  order_reviews: 'id, order_id, user_id, rating, note, created_at, updated_at',
  notebook_sessions: 'id, user_id, deployment_id, name, status, session_url, storage_path, bot_access_enabled, started_at, stopped_at, created_at, updated_at',
  inference_requests: 'id, user_id, organization_id, api_key_id, deployment_id, model_name, provider_name, input_tokens, output_tokens, latency_ms, status, error_message, cost, created_at',
}

const STORAGE_BUCKETS = new Set([
  'profile-avatars',
  'notebook-files',
  'inference-outputs',
  'model-artifacts',
])
let cognitoAdminClient

function getCognitoAdminClient() {
  const region = process.env.AWS_REGION || process.env.AWS_COGNITO_REGION
  if (!region) throw new Error('AWS_REGION must be configured for administrator invitations.')
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

async function getCustomerContext(req) {
  const claims = await authenticateCognitoRequest(req)
  const supabase = getSupabaseAdminClient()
  const result = await supabase
    .from('profiles')
    .select('user_id, full_name, email, username, avatar_path, role, status, organization_id')
    .eq('user_id', claims.sub)
    .maybeSingle()

  if (result.error) throw result.error
  if (!result.data) {
    const error = new Error('Customer profile has not been synchronized.')
    error.statusCode = 403
    throw error
  }
  if (result.data.status !== 'active') {
    const error = new Error('This account is not active.')
    error.statusCode = 403
    throw error
  }
  if (result.data.role === 'admin') {
    const error = new Error('Use the separate administrator sign-in.')
    error.statusCode = 403
    throw error
  }

  const membershipResult = await supabase
    .from('organization_members')
    .select(WORKSPACE_SELECTS.organization_members)
    .eq('user_id', claims.sub)
    .eq('status', 'active')
  if (membershipResult.error) throw membershipResult.error

  const organizationIds = [...new Set([
    result.data.organization_id,
    ...(membershipResult.data || []).map((membership) => membership.organization_id),
  ].filter(Boolean))]

  return {
    claims,
    profile: result.data,
    memberships: membershipResult.data || [],
    organizationIds,
    supabase,
  }
}

async function getRows(supabase, table, columnList, field, value) {
  let query = supabase.from(table).select(columnList)
  if (value !== undefined && value !== null) query = query.eq(field, value)
  const result = await query
  if (result.error) throw result.error
  return result.data || []
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
    getRows(supabase, 'wallet_accounts', WORKSPACE_SELECTS.wallet_accounts, 'user_id', claims.sub),
    getRows(supabase, 'wallet_transactions', WORKSPACE_SELECTS.wallet_transactions, 'user_id', claims.sub),
    getRows(supabase, 'api_keys', WORKSPACE_SELECTS.api_keys, 'user_id', claims.sub),
    getRows(supabase, 'ssh_public_keys', WORKSPACE_SELECTS.ssh_public_keys, 'user_id', claims.sub),
    getRows(supabase, 'notifications', WORKSPACE_SELECTS.notifications, 'user_id', claims.sub),
    getRows(supabase, 'order_reviews', WORKSPACE_SELECTS.order_reviews, 'user_id', claims.sub),
    getRows(supabase, 'notebook_sessions', WORKSPACE_SELECTS.notebook_sessions, 'user_id', claims.sub),
    getRows(supabase, 'inference_requests', WORKSPACE_SELECTS.inference_requests, 'user_id', claims.sub),
    getRows(supabase, 'user_access_policies', WORKSPACE_SELECTS.user_access_policies, 'user_id', claims.sub),
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
    wallets,
    walletTransactions,
    apiKeys,
    sshKeys,
    notifications,
    reviews,
    notebookSessions,
    inferenceRequests,
    accessPolicies,
    organizationsResult,
  ] = results

  for (const result of results) {
    if (result?.error) throw result.error
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
    wallet_accounts: wallets,
    wallet_transactions: walletTransactions,
    api_keys: apiKeys,
    ssh_public_keys: sshKeys,
    notifications,
    order_reviews: reviews,
    notebook_sessions: notebookSessions,
    inference_requests: inferenceRequests,
  }
}

function verifyAdminRequest(req) {
  const token = getBearerToken(req)
  if (!token) {
    const error = new Error('Administrator token is required.')
    error.statusCode = 401
    throw error
  }
  const secret = process.env.ADMIN_SESSION_SECRET || ''
  if (!secret || secret.length < 32) {
    const error = new Error('Administrator authentication is not configured.')
    error.statusCode = 503
    throw error
  }
  const verification = verifyAdminToken(token, secret)
  if (!verification.valid || !verification.payload) {
    const error = new Error('Administrator authentication could not be verified.')
    error.statusCode = 401
    throw error
  }
  return verification.payload
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

  return users.map((user) => ({
    ...user,
    access_policy: policies.get(`${user.user_id}:${user.organization_id || ''}`) || null,
  }))
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

async function handleCustomerApi(req, res, path) {
  let context
  try {
    context = await getCustomerContext(req)
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
      return sendJson(res, 201, { ok: true, ssh_key: result.data })
    }

    if (path.startsWith('/api/customer/ssh-keys/') && req.method === 'DELETE') {
      const keyId = decodeURIComponent(path.slice('/api/customer/ssh-keys/'.length))
      const result = await supabase
        .from('ssh_public_keys')
        .delete()
        .eq('id', keyId)
        .eq('user_id', claims.sub)
      if (result.error) throw result.error
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
      return sendJson(res, 200, { ok: true, api_key: result.data })
    }

    if (path.startsWith('/api/customer/notifications/') && req.method === 'PATCH') {
      const notificationId = decodeURIComponent(path.slice('/api/customer/notifications/'.length))
      const body = await readCustomerJsonBody(req)
      if (typeof body.is_read !== 'boolean') {
        return sendJson(res, 400, { ok: false, error: 'Notification read state must be a boolean.' })
      }
      const result = await supabase
        .from('notifications')
        .update({
          is_read: body.is_read,
          read_at: body.is_read ? new Date().toISOString() : null,
        })
        .eq('id', notificationId)
        .eq('user_id', claims.sub)
        .select(WORKSPACE_SELECTS.notifications)
        .maybeSingle()
      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Notification was not found.' })
      return sendJson(res, 200, { ok: true, notification: result.data })
    }

    if (path.startsWith('/api/customer/notifications/') && req.method === 'DELETE') {
      const notificationId = decodeURIComponent(path.slice('/api/customer/notifications/'.length))
      const result = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)
        .eq('user_id', claims.sub)
        .select('id')
        .maybeSingle()
      if (result.error) throw result.error
      if (!result.data) return sendJson(res, 404, { ok: false, error: 'Notification was not found.' })
      return sendJson(res, 200, { ok: true })
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
    admin = verifyAdminRequest(req)
  } catch (error) {
    return sendJson(res, error.statusCode || 401, { ok: false, error: error.message })
  }

  try {
    const supabase = getSupabaseAdminClient()
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

export function createSupabaseApiMiddleware() {
  return async function supabaseApiMiddleware(req, res, next) {
    const path = (req.url || '/').split('?')[0]
    if (path.startsWith('/api/customer/')) return handleCustomerApi(req, res, path)
    if (path.startsWith('/api/admin/data/')) return handleAdminApi(req, res, path)
    return next()
  }
}
