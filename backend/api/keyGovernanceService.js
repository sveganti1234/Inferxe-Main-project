// @ts-nocheck
import { getSupabaseAdminClient } from '../lib/supabase.js'
import { getAdminActivityLogs, logAdminActivity } from '../database/customerDatabase.js'

/**
 * Explicit metadata-only column allowlists.
 * SECURITY: `secret_hash` and wildcard (`*`) projections are strictly forbidden.
 */
export const API_KEY_METADATA_SELECT =
  'id, user_id, organization_id, name, key_prefix, status, created_at, last_used_at, expires_at, revoked_at'

export const SSH_KEY_METADATA_SELECT =
  'id, user_id, name, public_key, fingerprint, created_at'

export const PROFILE_OWNER_SELECT =
  'user_id, full_name, email, role, status'

export const INFERENCE_USAGE_SELECT =
  'api_key_id, status, created_at'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class KeyGovernanceError extends Error {
  constructor(message, statusCode = 500, code = 'KEY_GOVERNANCE_ERROR') {
    super(message)
    this.name = 'KeyGovernanceError'
    this.statusCode = statusCode
    this.code = code
  }
}

export function deriveEnvironmentFromPrefix(prefix) {
  const clean = typeof prefix === 'string' ? prefix.trim().toLowerCase() : ''
  if (clean.startsWith('inf_test_') || clean.startsWith('ix_test_')) {
    return 'test'
  }
  return 'live'
}

export function deriveApiKeyStatus(row) {
  const rawStatus = typeof row?.status === 'string' ? row.status.trim().toLowerCase() : 'inactive'
  if (row?.revoked_at || rawStatus === 'revoked') {
    return 'revoked'
  }
  if (rawStatus !== 'active') {
    return 'inactive'
  }
  if (row?.expires_at) {
    const expMs = Date.parse(row.expires_at)
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      return 'expired'
    }
  }
  return 'active'
}

export function maskSshPublicKey(publicKey) {
  if (typeof publicKey !== 'string' || !publicKey.trim()) {
    return { algorithm: 'unknown', preview: 'ssh-key <unavailable>' }
  }
  const parts = publicKey.trim().split(/\s+/)
  const algorithm = (parts[0] || 'unknown').toLowerCase()
  const blob = parts[1] || ''
  if (!blob) {
    return { algorithm, preview: `${algorithm} <truncated>` }
  }
  const snippet = blob.length > 18 ? `${blob.slice(0, 10)}...${blob.slice(-6)}` : blob
  return { algorithm, preview: `${algorithm} ${snippet}` }
}

function resolveSupabaseClient(overrideClient) {
  if (overrideClient !== undefined) {
    if (!overrideClient) {
      throw new KeyGovernanceError(
        'Key governance database is not configured or unavailable.',
        503,
        'SUPABASE_UNAVAILABLE',
      )
    }
    return overrideClient
  }
  try {
    return getSupabaseAdminClient()
  } catch {
    throw new KeyGovernanceError(
      'Key governance database is not configured or unavailable.',
      503,
      'SUPABASE_UNAVAILABLE',
    )
  }
}

function buildUsageMap(inferenceRows) {
  const usageByKeyId = new Map()
  if (!Array.isArray(inferenceRows)) return usageByKeyId

  for (const row of inferenceRows) {
    const keyId = row?.api_key_id
    if (!keyId) continue
    const entry = usageByKeyId.get(keyId) || { usage_count: 0, failed_count: 0 }
    entry.usage_count += 1
    const status = typeof row.status === 'string' ? row.status.toLowerCase() : ''
    if (status === 'failed' || status === 'error' || status === 'timeout') {
      entry.failed_count += 1
    }
    usageByKeyId.set(keyId, entry)
  }
  return usageByKeyId
}

/**
 * List all real platform API keys and SSH public keys from Supabase for Super Admin oversight.
 * - Uses strict metadata-only column selections (never selects `secret_hash`).
 * - Masks SSH public keys to algorithm + safe preview + fingerprint.
 * - Fails closed with HTTP 503 if Supabase is unconfigured or unreachable (zero mock fallback).
 */
export async function listSuperadminKeys({ supabaseClient } = {}) {
  const supabase = resolveSupabaseClient(supabaseClient)

  let apiResult
  let sshResult
  try {
    ;[apiResult, sshResult] = await Promise.all([
      supabase
        .from('api_keys')
        .select(API_KEY_METADATA_SELECT)
        .order('created_at', { ascending: false }),
      supabase
        .from('ssh_public_keys')
        .select(SSH_KEY_METADATA_SELECT)
        .order('created_at', { ascending: false }),
    ])
  } catch {
    throw new KeyGovernanceError(
      'Key governance database is temporarily unavailable.',
      503,
      'SUPABASE_UNAVAILABLE',
    )
  }

  if (apiResult?.error || !Array.isArray(apiResult?.data)) {
    throw new KeyGovernanceError(
      'Failed to retrieve API key metadata from database.',
      503,
      'API_KEYS_QUERY_FAILED',
    )
  }

  if (sshResult?.error || !Array.isArray(sshResult?.data)) {
    throw new KeyGovernanceError(
      'Failed to retrieve SSH key metadata from database.',
      503,
      'SSH_KEYS_QUERY_FAILED',
    )
  }

  const apiRows = apiResult.data
  const sshRows = sshResult.data

  const userIds = [
    ...new Set(
      [...apiRows, ...sshRows]
        .map((row) => (typeof row?.user_id === 'string' ? row.user_id.trim() : ''))
        .filter(Boolean),
    ),
  ]

  const apiKeyIds = apiRows
    .map((row) => (typeof row?.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean)

  // Non-blocking metadata enrichment: owner profiles & inference usage counts
  const profileMap = new Map()
  if (userIds.length > 0) {
    try {
      const profilesResult = await supabase
        .from('profiles')
        .select(PROFILE_OWNER_SELECT)
        .in('user_id', userIds)
      if (!profilesResult?.error && Array.isArray(profilesResult?.data)) {
        for (const p of profilesResult.data) {
          if (p?.user_id) profileMap.set(p.user_id, p)
        }
      }
    } catch {
      /* Preserve availability of emergency key listing even if profile enrichment fails */
    }
  }

  let usageMap = new Map()
  if (apiKeyIds.length > 0) {
    try {
      const usageResult = await supabase
        .from('inference_requests')
        .select(INFERENCE_USAGE_SELECT)
        .in('api_key_id', apiKeyIds)
      if (!usageResult?.error && Array.isArray(usageResult?.data)) {
        usageMap = buildUsageMap(usageResult.data)
      }
    } catch {
      /* Usage enrichment is optional; core key metadata remains authoritative */
    }
  }

  const mappedApiKeys = apiRows.map((row) => {
    const owner = profileMap.get(row.user_id)
    const usage = usageMap.get(row.id) || { usage_count: 0, failed_count: 0 }
    const status = deriveApiKeyStatus(row)
    const cleanPrefix = typeof row.key_prefix === 'string' ? row.key_prefix.trim() : ''

    return {
      id: String(row.id),
      user_id: String(row.user_id || ''),
      name: row.name || 'Unnamed API Key',
      type: 'API Key',
      key_type: 'api',
      owner_name: owner?.full_name || row.user_id || 'Unknown User',
      owner_email: owner?.email || row.user_id || 'unknown',
      role: owner?.role || 'customer',
      prefix: cleanPrefix ? `${cleanPrefix}••••` : 'redacted',
      environment: deriveEnvironmentFromPrefix(cleanPrefix),
      created_at: row.created_at || '',
      last_used: row.last_used_at || null,
      expires_at: row.expires_at || null,
      revoked_at: row.revoked_at || null,
      status,
      usage_count: usage.usage_count,
      failed_count: usage.failed_count,
    }
  })

  const mappedSshKeys = sshRows.map((row) => {
    const owner = profileMap.get(row.user_id)
    const masked = maskSshPublicKey(row.public_key)

    return {
      id: String(row.id),
      user_id: String(row.user_id || ''),
      name: row.name || 'Unnamed SSH Key',
      type: 'SSH Key',
      key_type: 'ssh',
      owner_name: owner?.full_name || row.user_id || 'Unknown User',
      owner_email: owner?.email || row.user_id || 'unknown',
      role: owner?.role || 'customer',
      prefix: masked.preview,
      ssh_algorithm: masked.algorithm,
      fingerprint: row.fingerprint || '',
      created_at: row.created_at || '',
      last_used: null,
      revoked_at: null,
      status: 'active',
    }
  })

  const keys = [...mappedApiKeys, ...mappedSshKeys].sort((a, b) => {
    const aMs = a.created_at ? Date.parse(a.created_at) : 0
    const bMs = b.created_at ? Date.parse(b.created_at) : 0
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0)
  })

  const summary = {
    total: keys.length,
    api_keys: mappedApiKeys.length,
    active_api_keys: mappedApiKeys.filter((k) => k.status === 'active').length,
    revoked_api_keys: mappedApiKeys.filter((k) => k.status === 'revoked').length,
    ssh_keys: mappedSshKeys.length,
  }

  return { keys, summary }
}

async function lookupOwnerEmail(supabase, userId) {
  if (!userId) return null
  try {
    const res = await supabase
      .from('profiles')
      .select('email, full_name, role')
      .eq('user_id', userId)
      .maybeSingle()
    if (!res?.error && res?.data) {
      return res.data
    }
  } catch {
    /* Non-fatal metadata lookup */
  }
  return null
}

async function writeSupabaseAuditLog(supabase, { action, targetType, targetId, details }) {
  try {
    const result = await supabase.from('audit_logs').insert({
      action,
      target_type: targetType,
      target_id: targetId,
      details,
    })
    return !result?.error
  } catch {
    return false
  }
}

/**
 * Super Admin emergency credential revocation.
 * - API keys: atomic conditional update (`status='revoked'`, `revoked_at=now()`), blocking repeated revocation (`409`).
 * - SSH keys: detaches any GPU `notebook_sessions` referencing `selected_ssh_key_id`, then permanently deletes the row from `ssh_public_keys`.
 * - Audits every privileged action in SQLite `admin_activity_logs` and Supabase `audit_logs`.
 * - Fails closed with HTTP 503 if Supabase is unavailable.
 */
export async function revokeSuperadminCredential({
  keyId,
  keyType,
  reason,
  actorEmail,
  actorRole,
  ipAddress = 'unknown',
  supabaseClient,
  logLocalActivity = logAdminActivity,
} = {}) {
  // Defense-in-depth authorization boundary
  const cleanActorEmail = typeof actorEmail === 'string' ? actorEmail.trim() : ''
  if (actorRole !== 'superadmin' || !cleanActorEmail) {
    throw new KeyGovernanceError(
      'Forbidden: Superadmin credentials and verified actor identity are required to revoke platform keys.',
      403,
      'FORBIDDEN',
    )
  }

  const cleanKeyId = typeof keyId === 'string' ? keyId.trim() : ''
  if (!cleanKeyId) {
    throw new KeyGovernanceError('key_id is required.', 400, 'INVALID_KEY_ID')
  }
  if (!UUID_RE.test(cleanKeyId)) {
    throw new KeyGovernanceError('Invalid key_id format. Expected UUID.', 400, 'INVALID_KEY_ID')
  }

  const normalizedType = typeof keyType === 'string' ? keyType.trim().toLowerCase() : ''
  if (normalizedType !== 'api' && normalizedType !== 'ssh') {
    throw new KeyGovernanceError(
      "Invalid key_type. Expected 'api' or 'ssh'.",
      400,
      'INVALID_KEY_TYPE',
    )
  }

  const cleanReason = typeof reason === 'string' ? reason.trim() : ''
  if (cleanReason.length < 3 || cleanReason.length > 500) {
    throw new KeyGovernanceError(
      'A mandatory audit reason (3 to 500 characters) is required for emergency revocation.',
      400,
      'INVALID_REASON',
    )
  }

  const supabase = resolveSupabaseClient(supabaseClient)
  const nowIso = new Date().toISOString()

  if (normalizedType === 'api') {
    let updateResult
    try {
      updateResult = await supabase
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: nowIso })
        .eq('id', cleanKeyId)
        .eq('status', 'active')
        .is('revoked_at', null)
        .select(API_KEY_METADATA_SELECT)
    } catch {
      throw new KeyGovernanceError(
        'API key database is temporarily unavailable.',
        503,
        'SUPABASE_UNAVAILABLE',
      )
    }

    if (updateResult?.error) {
      throw new KeyGovernanceError(
        'Failed to revoke API key in database.',
        503,
        'API_KEY_REVOKE_FAILED',
      )
    }

    let revokedRow = Array.isArray(updateResult?.data) ? updateResult.data[0] : null

    if (!revokedRow) {
      let existingResult
      try {
        existingResult = await supabase
          .from('api_keys')
          .select(API_KEY_METADATA_SELECT)
          .eq('id', cleanKeyId)
          .maybeSingle()
      } catch {
        throw new KeyGovernanceError(
          'API key database is temporarily unavailable.',
          503,
          'SUPABASE_UNAVAILABLE',
        )
      }

      if (existingResult?.error) {
        throw new KeyGovernanceError(
          'Failed to verify API key state in database.',
          503,
          'API_KEY_LOOKUP_FAILED',
        )
      }

      if (!existingResult?.data) {
        throw new KeyGovernanceError('API key not found.', 404, 'KEY_NOT_FOUND')
      }

      const existing = existingResult.data
      if (existing.revoked_at || String(existing.status || '').toLowerCase() !== 'active') {
        throw new KeyGovernanceError(
          'API key has already been revoked or is inactive.',
          409,
          'ALREADY_REVOKED',
        )
      }

      // Fallback direct revocation by key ID
      const fallbackResult = await supabase
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: nowIso })
        .eq('id', cleanKeyId)
        .select(API_KEY_METADATA_SELECT)

      if (Array.isArray(fallbackResult?.data) && fallbackResult.data.length > 0) {
        revokedRow = fallbackResult.data[0]
      } else {
        throw new KeyGovernanceError(
          'Concurrent API key state change detected; please retry revocation.',
          503,
          'CONCURRENT_STATE_CHANGE',
        )
      }
    }

    const ownerProfile = await lookupOwnerEmail(supabase, revokedRow.user_id)
    const auditDetails = {
      reason: cleanReason,
      key_id: cleanKeyId,
      key_type: 'api',
      key_name: revokedRow.name || 'Unnamed API Key',
      key_prefix: revokedRow.key_prefix || '',
      owner_user_id: revokedRow.user_id || '',
      owner_email: ownerProfile?.email || null,
      revocation_mode: 'status_revoked',
      revoked_at: revokedRow.revoked_at || nowIso,
      actor_email: cleanActorEmail,
    }

    logLocalActivity({
      adminEmail: cleanActorEmail,
      action: 'keys.revoke',
      category: 'keys',
      targetId: cleanKeyId,
      targetType: 'api_key',
      details: auditDetails,
      ipAddress,
    })

    const supabaseAuditSynced = await writeSupabaseAuditLog(supabase, {
      action: 'superadmin.api_key.revoked',
      targetType: 'api_key',
      targetId: cleanKeyId,
      details: auditDetails,
    })

    return {
      ok: true,
      message: `API key ${revokedRow.name || cleanKeyId} has been revoked.`,
      revocation_mode: 'status_revoked',
      revoked_at: revokedRow.revoked_at || nowIso,
      audit_synced: supabaseAuditSynced,
      key: {
        id: String(revokedRow.id),
        user_id: String(revokedRow.user_id || ''),
        name: revokedRow.name || 'Unnamed API Key',
        key_prefix: revokedRow.key_prefix || '',
        status: 'revoked',
        revoked_at: revokedRow.revoked_at || nowIso,
      },
    }
  }

  // SSH Key emergency revocation: permanent deletion + detach linked GPU notebook sessions
  let existingSshResult
  try {
    existingSshResult = await supabase
      .from('ssh_public_keys')
      .select(SSH_KEY_METADATA_SELECT)
      .eq('id', cleanKeyId)
      .maybeSingle()
  } catch {
    throw new KeyGovernanceError(
      'SSH key database is temporarily unavailable.',
      503,
      'SUPABASE_UNAVAILABLE',
    )
  }

  if (existingSshResult?.error) {
    throw new KeyGovernanceError(
      'Failed to retrieve SSH key metadata from database.',
      503,
      'SSH_KEY_LOOKUP_FAILED',
    )
  }

  const targetSsh = existingSshResult?.data
  if (!targetSsh) {
    throw new KeyGovernanceError(
      'SSH key not found or already deleted.',
      404,
      'KEY_NOT_FOUND',
    )
  }

  // Detach any GPU notebook sessions referencing this SSH key so access authorization is removed cleanly
  let detachedSessions = 0
  try {
    const detachResult = await supabase
      .from('notebook_sessions')
      .update({ selected_ssh_key_id: null })
      .eq('selected_ssh_key_id', cleanKeyId)
      .select('id')

    if (detachResult?.error) {
      throw new KeyGovernanceError(
        'Failed to detach GPU notebook sessions bound to this SSH key.',
        503,
        'SSH_KEY_DETACH_FAILED',
      )
    }
    detachedSessions = Array.isArray(detachResult?.data) ? detachResult.data.length : 0
  } catch (err) {
    if (err instanceof KeyGovernanceError) throw err
    throw new KeyGovernanceError(
      'Failed to detach GPU notebook sessions bound to this SSH key.',
      503,
      'SSH_KEY_DETACH_FAILED',
    )
  }

  let deleteResult
  try {
    deleteResult = await supabase
      .from('ssh_public_keys')
      .delete()
      .eq('id', cleanKeyId)
      .select(SSH_KEY_METADATA_SELECT)
  } catch {
    throw new KeyGovernanceError(
      'SSH key database is temporarily unavailable.',
      503,
      'SUPABASE_UNAVAILABLE',
    )
  }

  if (deleteResult?.error) {
    throw new KeyGovernanceError(
      'Failed to permanently delete SSH key from database.',
      503,
      'SSH_KEY_DELETE_FAILED',
    )
  }

  const deletedRow = Array.isArray(deleteResult?.data) ? deleteResult.data[0] : null
  if (!deletedRow) {
    throw new KeyGovernanceError(
      'SSH key not found or already deleted.',
      404,
      'KEY_NOT_FOUND',
    )
  }

  const masked = maskSshPublicKey(deletedRow.public_key)
  const ownerProfile = await lookupOwnerEmail(supabase, deletedRow.user_id)
  const auditDetails = {
    reason: cleanReason,
    key_id: cleanKeyId,
    key_type: 'ssh',
    key_name: deletedRow.name || 'Unnamed SSH Key',
    fingerprint: deletedRow.fingerprint || '',
    ssh_algorithm: masked.algorithm,
    owner_user_id: deletedRow.user_id || '',
    owner_email: ownerProfile?.email || null,
    revocation_mode: 'permanent_delete',
    detached_notebook_sessions: detachedSessions,
    deleted_at: nowIso,
    actor_email: cleanActorEmail,
  }

  logLocalActivity({
    adminEmail: cleanActorEmail,
    action: 'keys.revoke',
    category: 'keys',
    targetId: cleanKeyId,
    targetType: 'ssh_public_key',
    details: auditDetails,
    ipAddress,
  })

  const supabaseAuditSynced = await writeSupabaseAuditLog(supabase, {
    action: 'superadmin.ssh_key.deleted',
    targetType: 'ssh_public_key',
    targetId: cleanKeyId,
    details: auditDetails,
  })

  return {
    ok: true,
    message: `SSH key ${deletedRow.name || cleanKeyId} has been permanently deleted.`,
    revocation_mode: 'permanent_delete',
    detached_sessions: detachedSessions,
    revoked_at: nowIso,
    audit_synced: supabaseAuditSynced,
    key: {
      id: String(deletedRow.id),
      user_id: String(deletedRow.user_id || ''),
      name: deletedRow.name || 'Unnamed SSH Key',
      fingerprint: deletedRow.fingerprint || '',
      ssh_algorithm: masked.algorithm,
      status: 'deleted',
    },
  }
}

const STALE_KEY_THRESHOLD_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Derive real security alerts strictly from actual Supabase key metadata and inference telemetry.
 * Never fabricates or hardcodes alerts.
 */
export function deriveKeySecurityAlerts(keys, nowMs = Date.now()) {
  const alerts = []
  if (!Array.isArray(keys)) return alerts

  for (const key of keys) {
    if (key.type !== 'API Key') continue

    const usageCount = Number(key.usage_count || 0)
    const failedCount = Number(key.failed_count || 0)
    const failRatePct = usageCount > 0 ? Math.round((failedCount / usageCount) * 100) : 0

    // 1. High failure rate on active key (potential abuse, probing, or broken integration)
    if (key.status === 'active' && failedCount >= 3 && failRatePct >= 30) {
      alerts.push({
        id: `alert_fail_${key.id}`,
        severity: 'high',
        type: 'high_failure_rate',
        title: `Elevated failure rate (${failRatePct}%) on API key`,
        detail: `${failedCount} of ${usageCount} inference requests failed for "${key.name}" (${key.owner_email}).`,
        key_id: key.id,
        key_name: key.name,
        owner_email: key.owner_email,
        detected_at: key.last_used || key.created_at || new Date(nowMs).toISOString(),
      })
    }

    // 2. Expired key not yet formally revoked
    if (key.status === 'expired' && !key.revoked_at) {
      alerts.push({
        id: `alert_exp_${key.id}`,
        severity: 'medium',
        type: 'expired_unrevoked',
        title: 'Expired API key pending revocation cleanup',
        detail: `"${key.name}" (${key.owner_email}) passed its expiration timestamp (${key.expires_at}) while still marked active.`,
        key_id: key.id,
        key_name: key.name,
        owner_email: key.owner_email,
        detected_at: key.expires_at || new Date(nowMs).toISOString(),
      })
    }

    // 3. Stale active key (no usage for >= 90 days or never used after >= 90 days)
    if (key.status === 'active') {
      const referenceIso = key.last_used || key.created_at
      const referenceMs = referenceIso ? Date.parse(referenceIso) : NaN
      if (Number.isFinite(referenceMs) && nowMs - referenceMs >= STALE_KEY_THRESHOLD_DAYS * DAY_MS) {
        const ageDays = Math.floor((nowMs - referenceMs) / DAY_MS)
        alerts.push({
          id: `alert_stale_${key.id}`,
          severity: 'medium',
          type: 'stale_active_key',
          title: `Stale active API key (${ageDays} days inactive)`,
          detail: `"${key.name}" (${key.owner_email}) has remained active without recorded usage for ${ageDays} days.`,
          key_id: key.id,
          key_name: key.name,
          owner_email: key.owner_email,
          detected_at: referenceIso,
        })
      }
    }
  }

  const severityWeight = { high: 0, medium: 1, low: 2 }
  return alerts.sort((a, b) => {
    const sevDiff = (severityWeight[a.severity] ?? 3) - (severityWeight[b.severity] ?? 3)
    if (sevDiff !== 0) return sevDiff
    return Date.parse(b.detected_at || '') - Date.parse(a.detected_at || '')
  })
}

async function fetchKeyAuditRecords(supabase, getLocalLogsFn = getAdminActivityLogs) {
  const records = []
  const seenKeys = new Set()

  // 1. SQLite admin_activity_logs (category = 'keys')
  try {
    const localRes = getLocalLogsFn({ category: 'keys', limit: 50, offset: 0 })
    const localLogs = Array.isArray(localRes?.logs) ? localRes.logs : []
    for (const log of localLogs) {
      const details = log?.details && typeof log.details === 'object' ? log.details : {}
      const dedupeSig = `${log.target_id || ''}:${log.action || ''}:${String(log.created_at || '').slice(0, 19)}`
      seenKeys.add(dedupeSig)
      records.push({
        id: String(log.id || `local_${records.length + 1}`),
        action: String(log.action || 'keys.event'),
        actor_email: String(log.admin_email || details.actor_email || 'system'),
        target_id: String(log.target_id || details.key_id || ''),
        target_type: String(log.target_type || details.key_type || 'key'),
        key_name: details.key_name || null,
        owner_email: details.owner_email || null,
        reason: details.reason || null,
        revocation_mode: details.revocation_mode || null,
        created_at: String(log.created_at || ''),
        source: 'admin_audit_ledger',
      })
    }
  } catch {
    /* Preserve monitoring availability if local audit read fails */
  }

  // 2. Supabase audit_logs (key-related events)
  try {
    const sbRes = await supabase
      .from('audit_logs')
      .select('id, action, target_type, target_id, details, created_at')
      .in('target_type', ['api_key', 'ssh_public_key'])
      .order('created_at', { ascending: false })
    if (!sbRes?.error && Array.isArray(sbRes?.data)) {
      for (const row of sbRes.data.slice(0, 50)) {
        const details = row?.details && typeof row.details === 'object' ? row.details : {}
        const dedupeSig = `${row.target_id || ''}:keys.revoke:${String(row.created_at || '').slice(0, 19)}`
        if (seenKeys.has(dedupeSig)) continue
        records.push({
          id: String(row.id || `sb_${records.length + 1}`),
          action: String(row.action || 'key.audit'),
          actor_email: String(details.actor_email || details.administrator_email || 'system'),
          target_id: String(row.target_id || ''),
          target_type: String(row.target_type || 'key'),
          key_name: details.key_name || null,
          owner_email: details.owner_email || null,
          reason: details.reason || null,
          revocation_mode: details.revocation_mode || null,
          created_at: String(row.created_at || ''),
          source: 'supabase_audit_logs',
        })
      }
    }
  } catch {
    /* Non-fatal: local audit records remain available */
  }

  return records
    .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))
    .slice(0, 50)
}

/**
 * Read-only Key Monitoring dataset for Admin Portal (`GET /api/admin/keys`).
 * Reuses `listSuperadminKeys` (real Supabase metadata-only queries, fail-closed 503)
 * and enriches with real usage metrics, derived security alerts, and key audit records.
 * Never exposes secret hashes, raw API keys, private SSH keys, or revocation actions.
 */
export async function getAdminKeyMonitoringData({
  supabaseClient,
  getLocalActivityLogs = getAdminActivityLogs,
} = {}) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const { keys, summary } = await listSuperadminKeys({ supabaseClient: supabase })

  const nowMs = Date.now()
  const dayAgoMs = nowMs - DAY_MS
  const apiKeys = keys.filter((k) => k.type === 'API Key')
  const totalRequests = apiKeys.reduce((acc, k) => acc + Number(k.usage_count || 0), 0)
  const failedRequests = apiKeys.reduce((acc, k) => acc + Number(k.failed_count || 0), 0)
  const activeKeysUsed24h = apiKeys.filter(
    (k) => k.status === 'active' && k.last_used && Date.parse(k.last_used) >= dayAgoMs,
  ).length
  const expiredApiKeys = apiKeys.filter((k) => k.status === 'expired').length

  const alerts = deriveKeySecurityAlerts(keys, nowMs)
  const auditRecords = await fetchKeyAuditRecords(supabase, getLocalActivityLogs)

  return {
    read_only: true,
    keys,
    summary: {
      ...summary,
      expired_api_keys: expiredApiKeys,
      total_requests: totalRequests,
      failed_requests: failedRequests,
      error_rate_pct: totalRequests > 0 ? Number(((failedRequests / totalRequests) * 100).toFixed(1)) : 0,
      active_keys_used_24h: activeKeysUsed24h,
      security_alerts_count: alerts.length,
      high_severity_alerts: alerts.filter((a) => a.severity === 'high').length,
    },
    alerts,
    audit_records: auditRecords,
  }
}

