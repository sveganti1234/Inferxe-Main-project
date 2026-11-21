/**
 * Administrator customer account APIs, served from Supabase:
 *  - GET  /api/admin/customers/:id/account  profile, wallet, transactions, deployments, spend,
 *                                           limits, plan and audit history (real records only)
 *  - PUT  /api/admin/customers/:id/plan     atomic, audited plan/trial change (admin_set_customer_plan)
 * The other /api/admin/customers/* routes (summary, list, details, export, backup, restore, sync) are
 * served by auth/adminAuth.js from database/supabaseCustomerService.js; adminAuth passes only these
 * two through. Callers are verified administrators (handleAdminApi in supabaseApi.js).
 * Wallet credits are NOT here: they go through the notifications service (one atomic wallet ledger),
 * which records the credit and its audit_logs row in the same transaction.
 */
import { readCustomerJsonBody } from '../auth/customerAuth.js'

const CUSTOMER_PROFILE_SELECT =
  'user_id, full_name, email, username, role, status, phone_number, last_active_at, last_login_at, login_count, organization_id, created_at, updated_at'
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000
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

export async function handleAdminCustomerApi(req, res, path, { supabase, admin, now = Date.now() }) {
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

  return sendJson(res, 404, { ok: false, error: 'Administrator customer API route not found.' })
}
