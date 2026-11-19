/**
 * Administrator customer APIs (/api/admin/customers/*), served from Supabase.
 * Recovered from stash@{0} (backup-before-admin-portal-work-2026-11-16) and extended with:
 *  - GET  /api/admin/customers/:id/account  profile, wallet, transactions, deployments, spend,
 *                                           limits, plan and audit history (real records only)
 *  - PUT  /api/admin/customers/:id/plan     atomic, audited plan/trial change (admin_set_customer_plan)
 * Callers must already be verified administrators (see handleAdminApi in supabaseApi.js).
 * Wallet credits are NOT here: they go through the notifications service (one atomic wallet
 * ledger), which records the credit and its audit_logs row in the same transaction.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'
import { readCustomerJsonBody } from '../auth/customerAuth.js'

const CUSTOMER_PROFILE_SELECT =
  'user_id, full_name, email, username, role, status, phone_number, last_active_at, last_login_at, login_count, organization_id, created_at, updated_at'
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000
const DEFAULT_CUSTOMER_BACKUP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../database/backups')
const ACCOUNT_AUDIT_ACTIONS = ['admin.wallet.credited', 'admin.plan.updated', 'admin.customer.updated', 'admin.customer.invited']
const MAX_TIER_LENGTH = 64

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function badRequest(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function getActivityStatus(lastActiveAt, now) {
  const lastActiveTime = typeof lastActiveAt === 'string' ? Date.parse(lastActiveAt) : NaN
  return Number.isFinite(lastActiveTime) && lastActiveTime <= now && now - lastActiveTime < FIVE_DAYS_MS
    ? 'Active'
    : 'Inactive'
}

const str = (value) => (typeof value === 'string' && value ? value : null)

function mapCustomerProfile(profile, organizationName, now) {
  const lastActiveAt = str(profile.last_active_at)
  const allowedAccountStatuses = ['active', 'inactive', 'pending', 'suspended']
  return {
    customer_id: profile.user_id,
    cognito_sub: profile.user_id,
    full_name: typeof profile.full_name === 'string' ? profile.full_name : '',
    email: typeof profile.email === 'string' ? profile.email : '',
    phone_number: str(profile.phone_number),
    organization: organizationName || null,
    role: typeof profile.role === 'string' ? profile.role : 'customer',
    registration_date: typeof profile.created_at === 'string' ? profile.created_at : '',
    last_login_at: str(profile.last_login_at),
    last_active_at: lastActiveAt,
    last_heartbeat_at: null,
    account_status: allowedAccountStatuses.includes(profile.status) ? profile.status : 'unknown',
    activity_status: getActivityStatus(lastActiveAt, now),
    login_count: Number.isInteger(profile.login_count) ? profile.login_count : null,
    created_at: typeof profile.created_at === 'string' ? profile.created_at : '',
    updated_at: str(profile.updated_at),
  }
}

async function getCustomerProfiles(supabase) {
  const result = await supabase
    .from('profiles')
    .select(CUSTOMER_PROFILE_SELECT)
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
  if (result.error) throw result.error
  return result.data || []
}

async function getCustomerRecords(supabase, now = Date.now()) {
  const profiles = await getCustomerProfiles(supabase)
  if (!profiles.length) return []
  const organizationsResult = await supabase.from('organizations').select('id, name')
  if (organizationsResult.error) throw organizationsResult.error
  const organizations = new Map((organizationsResult.data || []).map((o) => [o.id, o.name]))
  return profiles.map((profile) => mapCustomerProfile(profile, organizations.get(profile.organization_id), now))
}

function escapeCsv(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Neutralise spreadsheet formulas (CSV injection) as well as quoting separators.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function customersToCsv(customers) {
  const headers = ['Customer ID', 'Cognito Sub', 'Full Name', 'Email', 'Organization', 'Role', 'Account Status', 'Registration Date', 'Last Active At', 'Activity Status']
  const lines = [headers.join(',')]
  for (const c of customers) {
    lines.push([c.customer_id, c.cognito_sub, c.full_name, c.email, c.organization, c.role, c.account_status, c.registration_date, c.last_active_at, c.activity_status].map(escapeCsv).join(','))
  }
  return lines.join('\r\n')
}

function getCognitoAttribute(user, name) {
  const attribute = user.Attributes?.find((item) => item.Name === name)
  return typeof attribute?.Value === 'string' ? attribute.Value : ''
}

async function listCognitoUsers(client, userPoolId) {
  const users = []
  const seenTokens = new Set()
  let paginationToken
  do {
    const result = await client.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      Limit: 60,
      ...(paginationToken ? { PaginationToken: paginationToken } : {}),
    }))
    users.push(...(result.Users || []))
    paginationToken = result.PaginationToken
    if (paginationToken && seenTokens.has(paginationToken)) throw new Error('Cognito returned a repeated pagination token.')
    if (paginationToken) seenTokens.add(paginationToken)
  } while (paginationToken)
  return users
}

async function syncCognitoCustomers(supabase, dependencies) {
  const userPoolId = dependencies.cognitoUserPoolId ||
    process.env.COGNITO_USER_POOL_ID?.trim() ||
    process.env.AWS_COGNITO_USER_POOL_ID?.trim()
  if (!userPoolId) {
    const error = new Error('Cognito user pool is not configured on the backend.')
    error.statusCode = 503
    throw error
  }
  const cognitoUsers = await listCognitoUsers(dependencies.getCognitoClient(), userPoolId)
  const eligibleUsers = []
  const seenSubjects = new Set()
  const seenEmails = new Set()
  for (const user of cognitoUsers) {
    if (user.Enabled === false || user.UserStatus !== 'CONFIRMED') continue
    const subject = getCognitoAttribute(user, 'sub')
    const email = getCognitoAttribute(user, 'email').trim().toLowerCase()
    if (!subject || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue
    if (seenSubjects.has(subject) || seenEmails.has(email)) continue
    seenSubjects.add(subject)
    seenEmails.add(email)
    eligibleUsers.push({ user, subject, email })
  }

  const profilesResult = await supabase.from('profiles').select('user_id, email, role')
  if (profilesResult.error) throw profilesResult.error
  const profilesById = new Map((profilesResult.data || []).map((p) => [p.user_id, p]))
  const profilesByEmail = new Map((profilesResult.data || []).map((p) => [typeof p.email === 'string' ? p.email.toLowerCase() : '', p]))
  let newCount = 0
  let updatedCount = 0

  for (const { user, subject, email } of eligibleUsers) {
    const existing = profilesById.get(subject)
    if (existing && existing.role !== 'customer') continue
    const emailMatch = profilesByEmail.get(email)
    if (emailMatch && emailMatch.user_id !== subject) continue
    const fullName = getCognitoAttribute(user, 'name') ||
      [getCognitoAttribute(user, 'given_name'), getCognitoAttribute(user, 'family_name')].filter(Boolean).join(' ') ||
      null
    const username = getCognitoAttribute(user, 'preferred_username') || user.Username || email.split('@')[0]
    const result = await supabase.rpc('sync_customer_profile', { p_user_id: subject, p_full_name: fullName, p_email: email, p_username: username })
    if (result.error) throw result.error
    if (existing) {
      updatedCount += 1
    } else {
      newCount += 1
      const synced = { user_id: subject, email, role: 'customer' }
      profilesById.set(subject, synced)
      profilesByEmail.set(email, synced)
    }
  }
  return { ok: true, syncedCount: eligibleUsers.length, updatedCount, newCount }
}

const finite = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

async function getCustomerProfile(supabase, customerId) {
  const result = await supabase.from('profiles').select(CUSTOMER_PROFILE_SELECT).eq('user_id', customerId).eq('role', 'customer').maybeSingle()
  if (result.error) throw result.error
  return result.data || null
}

/** Everything an administrator needs about one customer, from real records only. */
async function getCustomerAccount(supabase, customerId, now) {
  const profile = await getCustomerProfile(supabase, customerId)
  if (!profile) return null
  const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)).toISOString()

  const [organization, wallet, transactions, monthDebits, deployments, policy, budget, plan, history] = await Promise.all([
    profile.organization_id
      ? supabase.from('organizations').select('id, name').eq('id', profile.organization_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('wallets').select('balance, currency, low_balance_alert_level, updated_at').eq('user_id', customerId).maybeSingle(),
    supabase
      .from('wallet_transactions')
      .select('id, transaction_type, direction, amount, currency, status, description, balance_after, created_at')
      .eq('user_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('wallet_transactions')
      .select('amount, currency')
      .eq('user_id', customerId)
      .eq('direction', 'debit')
      .eq('status', 'completed')
      .gte('created_at', monthStart),
    supabase
      .from('deployments')
      .select('id, name, model_name, gpu_model, region, status, hourly_rate, currency, created_at')
      .eq('user_id', customerId)
      .order('created_at', { ascending: false }),
    supabase.from('user_access_policies').select('monthly_spend_limit').eq('user_id', customerId).maybeSingle(),
    supabase.from('workspace_settings').select('monthly_budget, budget_configured').eq('user_id', customerId).maybeSingle(),
    supabase.from('customer_plans').select('tier, trial_started_at, trial_ends_at, updated_at').eq('user_id', customerId).maybeSingle(),
    supabase
      .from('audit_logs')
      .select('id, action, details, created_at')
      .eq('target_id', customerId)
      .in('action', ACCOUNT_AUDIT_ACTIONS)
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  for (const r of [organization, wallet, transactions, monthDebits, deployments, policy, budget, plan, history]) {
    if (r.error) throw r.error
  }

  const walletCurrency = str(wallet.data?.currency)?.trim() || null
  const spendCurrency = walletCurrency || 'INR'
  const monthSpend = (monthDebits.data || [])
    .filter((t) => (str(t.currency)?.trim() || 'INR') === spendCurrency)
    .reduce((sum, t) => sum + Math.abs(finite(t.amount) ?? 0), 0)
  const trialEnds = plan.data?.trial_ends_at ? Date.parse(plan.data.trial_ends_at) : NaN

  return {
    profile: mapCustomerProfile(profile, organization.data?.name || null, now),
    wallet: wallet.data
      ? {
          balance: finite(wallet.data.balance),
          currency: walletCurrency,
          low_balance_alert_level: str(wallet.data.low_balance_alert_level),
          updated_at: str(wallet.data.updated_at),
        }
      : null,
    transactions: (transactions.data || []).map((t) => ({
      id: t.id,
      type: str(t.transaction_type),
      direction: str(t.direction),
      amount: finite(t.amount),
      currency: str(t.currency)?.trim() || null,
      status: str(t.status),
      description: str(t.description),
      balance_after: finite(t.balance_after),
      created_at: str(t.created_at),
    })),
    spend: {
      month_start: monthStart,
      currency: spendCurrency,
      this_month: monthSpend,
      admin_spend_limit: finite(policy.data?.monthly_spend_limit),
      customer_budget: budget.data?.budget_configured === true ? finite(budget.data.monthly_budget) : null,
    },
    deployments: (deployments.data || []).map((d) => ({
      id: d.id,
      name: str(d.name) || 'Untitled deployment',
      model: str(d.model_name),
      gpu: str(d.gpu_model),
      region: str(d.region),
      status: str(d.status),
      hourly_rate: finite(d.hourly_rate),
      currency: str(d.currency)?.trim() || null,
      created_at: str(d.created_at),
    })),
    plan: plan.data
      ? {
          tier: str(plan.data.tier),
          trial_started_at: str(plan.data.trial_started_at),
          trial_ends_at: str(plan.data.trial_ends_at),
          trial_status: Number.isFinite(trialEnds) ? (now < trialEnds ? 'active' : 'expired') : 'none',
          updated_at: str(plan.data.updated_at),
        }
      : null,
    history: (history.data || []).map((h) => ({
      id: h.id,
      action: h.action,
      administrator_email: str(h.details?.administrator_email),
      details: h.details || {},
      created_at: str(h.created_at),
    })),
  }
}

function parseOptionalDate(value, field) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw badRequest(`${field} must be a valid date.`)
  return new Date(value).toISOString()
}

/** Validate a plan change body: { tier, trial_started_at, trial_ends_at, reason }. */
export function parsePlanUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid plan update.')
  let tier = null
  if (body.tier !== null && body.tier !== undefined) {
    if (typeof body.tier !== 'string') throw badRequest('Tier must be text.')
    tier = body.tier.trim() || null
    if (tier && tier.length > MAX_TIER_LENGTH) throw badRequest(`Tier must be at most ${MAX_TIER_LENGTH} characters.`)
  }
  const trialStartedAt = parseOptionalDate(body.trial_started_at, 'Trial start')
  const trialEndsAt = parseOptionalDate(body.trial_ends_at, 'Trial end')
  if (trialStartedAt && !trialEndsAt) throw badRequest('A trial needs an end date.')
  if (trialStartedAt && trialEndsAt && Date.parse(trialEndsAt) <= Date.parse(trialStartedAt)) {
    throw badRequest('Trial end must be after the trial start.')
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3 || reason.length > 500) throw badRequest('Please give a reason (3–500 characters) for the audit history.')
  return { tier, trialStartedAt, trialEndsAt, reason }
}

function decodeId(raw) {
  try {
    const id = decodeURIComponent(raw)
    if (!id || id.length > 128) throw new Error('bad')
    return id
  } catch {
    throw badRequest('Invalid customer identifier.')
  }
}

export async function handleAdminCustomerApi(req, res, path, { supabase, admin, now = Date.now(), backupDir, getCognitoClient, cognitoUserPoolId }) {
  if (path === '/api/admin/customers/summary' && req.method === 'GET') {
    const customers = await getCustomerRecords(supabase, now)
    const active = customers.filter((c) => c.activity_status === 'Active').length
    return sendJson(res, 200, {
      ok: true,
      summary: { total: customers.length, online: 0, onlineTrackingAvailable: false, active, inactive: customers.length - active },
    })
  }

  if (path === '/api/admin/customers' && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const status = (url.searchParams.get('status') || 'all').toLowerCase()
    const sortBy = url.searchParams.get('sortBy') || 'registration_date'
    const sortOrder = url.searchParams.get('sortOrder') || 'desc'
    if (!['all', 'online', 'active', 'inactive'].includes(status)) return sendJson(res, 400, { ok: false, error: 'Invalid customer activity filter.' })
    if (!['registration_date', 'last_active', 'full_name', 'email'].includes(sortBy)) return sendJson(res, 400, { ok: false, error: 'Invalid customer sort field.' })
    if (!['asc', 'desc'].includes(sortOrder)) return sendJson(res, 400, { ok: false, error: 'Invalid customer sort order.' })

    const pageValue = Number.parseInt(url.searchParams.get('page') || '1', 10)
    const limitValue = Number.parseInt(url.searchParams.get('limit') || '20', 10)
    const page = Number.isFinite(pageValue) ? Math.max(1, pageValue) : 1
    const limit = Number.isFinite(limitValue) ? Math.min(100, Math.max(1, limitValue)) : 20
    const search = (url.searchParams.get('search') || '').trim().toLowerCase()
    let customers = await getCustomerRecords(supabase, now)
    if (search) {
      customers = customers.filter((c) => [c.full_name, c.email, c.customer_id, c.cognito_sub, c.organization || ''].some((v) => v.toLowerCase().includes(search)))
    }
    // Online presence is not tracked in Supabase, so the "online" filter is honestly empty.
    if (status === 'online') customers = []
    else if (status !== 'all') customers = customers.filter((c) => c.activity_status.toLowerCase() === status)

    const sortField = sortBy === 'last_active' ? 'last_active_at' : sortBy
    const direction = sortOrder === 'asc' ? 1 : -1
    customers.sort((l, r) => direction * String(l[sortField] || '').localeCompare(String(r[sortField] || ''), undefined, { sensitivity: 'base' }))
    const total = customers.length
    const totalPages = Math.ceil(total / limit) || 1
    const start = (page - 1) * limit
    return sendJson(res, 200, { ok: true, customers: customers.slice(start, start + limit), pagination: { total, page, limit, totalPages } })
  }

  if (path === '/api/admin/customers/export' && req.method === 'GET') {
    const customers = await getCustomerRecords(supabase, now)
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="inferxe_customers_export.csv"')
    res.setHeader('Cache-Control', 'no-store')
    return res.end(customersToCsv(customers))
  }

  if (path === '/api/admin/customers/backup' && req.method === 'POST') {
    const customers = await getCustomerRecords(supabase, now)
    const timestamp = new Date(now).toISOString()
    const backupFile = `inferxe_customers_${timestamp.replace(/[:.]/g, '-')}.json`
    const dir = backupDir || DEFAULT_CUSTOMER_BACKUP_DIR
    const backupData = Buffer.from(JSON.stringify({ source: 'supabase', timestamp, customer_count: customers.length, customers }, null, 2))
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(resolve(dir, backupFile), backupData, { flag: 'wx', mode: 0o600 })
    return sendJson(res, 200, { ok: true, backup: { ok: true, backupFile, backupPath: backupFile, sizeBytes: backupData.byteLength, timestamp } })
  }

  if (path === '/api/admin/customers/sync' && req.method === 'POST') {
    const body = await readCustomerJsonBody(req)
    if (body.customers !== undefined && !Array.isArray(body.customers)) return sendJson(res, 400, { ok: false, error: 'Invalid customer synchronization request.' })
    return sendJson(res, 200, await syncCognitoCustomers(supabase, { getCognitoClient, cognitoUserPoolId }))
  }

  const accountMatch = path.match(/^\/api\/admin\/customers\/([^/]+)\/account$/)
  if (accountMatch && req.method === 'GET') {
    const account = await getCustomerAccount(supabase, decodeId(accountMatch[1]), now)
    if (!account) return sendJson(res, 404, { ok: false, error: 'Customer profile was not found.' })
    return sendJson(res, 200, { ok: true, account })
  }

  const planMatch = path.match(/^\/api\/admin\/customers\/([^/]+)\/plan$/)
  if (planMatch && req.method === 'PUT') {
    const customerId = decodeId(planMatch[1])
    const update = parsePlanUpdate(await readCustomerJsonBody(req))
    const adminEmail = typeof admin?.email === 'string' && admin.email ? admin.email : str(admin?.sub)
    const result = await supabase.rpc('admin_set_customer_plan', {
      p_user_id: customerId,
      p_tier: update.tier,
      p_trial_started_at: update.trialStartedAt,
      p_trial_ends_at: update.trialEndsAt,
      p_admin_email: adminEmail,
      p_reason: update.reason,
    })
    if (result.error) {
      if (result.error.code === 'P0002') return sendJson(res, 404, { ok: false, error: 'Customer profile was not found.' })
      if (result.error.code === '22023' || result.error.code === '23514') return sendJson(res, 400, { ok: false, error: 'The plan change is not valid.' })
      throw result.error
    }
    return sendJson(res, 200, { ok: true, plan: result.data })
  }

  const detailMatch = path.match(/^\/api\/admin\/customers\/([^/]+)$/)
  if (detailMatch && req.method === 'GET') {
    const profile = await getCustomerProfile(supabase, decodeId(detailMatch[1]))
    if (!profile) return sendJson(res, 404, { ok: false, error: 'Customer profile was not found.' })
    let organizationName = null
    if (profile.organization_id) {
      const org = await supabase.from('organizations').select('id, name').eq('id', profile.organization_id).maybeSingle()
      if (org.error) throw org.error
      organizationName = org.data?.name || null
    }
    return sendJson(res, 200, { ok: true, customer: { ...mapCustomerProfile(profile, organizationName, now), previous_logins: [], activity_logs: [] } })
  }

  return sendJson(res, 404, { ok: false, error: 'Administrator customer API route not found.' })
}
