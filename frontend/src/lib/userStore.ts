import { getSession } from './authStore'
import type { UserFormData, UserRecord, UserRecordStatus, UserRole } from '../types/dashboard'

export const AVAILABLE_MODELS = [
  { id: 'deepseek-r1-671b', name: 'DeepSeek R1', tag: '671B MoE', category: 'Reasoning', highlight: true },
  { id: 'llama-3.3-70b', name: 'Llama 3.3 Instruct', tag: '70B Dense', category: 'General', highlight: true },
  { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder', tag: '32B Dense', category: 'Code', highlight: true },
  { id: 'mistral-large-2', name: 'Mistral Large 2', tag: '123B Dense', category: 'General', highlight: false },
  { id: 'llama-3.1-8b', name: 'Llama 3.1 Instruct', tag: '8B Dense', category: 'Low-latency', highlight: true },
  { id: 'gemma-2-27b', name: 'Gemma 2', tag: '27B Dense', category: 'Research', highlight: false },
  { id: 'whisper-large-v3', name: 'Whisper Large v3', tag: 'Audio', category: 'Multimodal', highlight: false },
  { id: 'bge-m3-embed', name: 'BGE-M3 Embeddings', tag: '1024d', category: 'Vector', highlight: false },
]

export const AVAILABLE_PROVIDERS = [
  { id: 'yotta-nm1', name: 'Yotta NM1 Datacenter', region: 'Navi Mumbai, India', latency: '4 ms', tier: 'Tier IV' },
  { id: 'e2e-delhi', name: 'E2E Cloud Sovereign', region: 'Delhi NCR, India', latency: '9 ms', tier: 'MeitY Empanelled' },
  { id: 'lambda-us-west', name: 'Lambda Labs', region: 'San Jose, CA', latency: '162 ms', tier: 'High-Density H100' },
  { id: 'runpod-eu', name: 'RunPod Cloud', region: 'Stockholm, Sweden', latency: '118 ms', tier: 'Green Energy' },
  { id: 'coreweave-us-east', name: 'CoreWeave Hyperplane', region: 'New Jersey, USA', latency: '174 ms', tier: 'InfiniBand Cluster' },
  { id: 'oracle-hyd', name: 'Oracle Sovereign OCI', region: 'Hyderabad, India', latency: '12 ms', tier: 'Gov-Approved' },
]

export const ROLE_DEFINITIONS: Record<
  UserRole,
  {
    title: string
    description: string
    badgeClass: string
    permissions: string[]
  }
> = {
  admin: {
    title: 'Admin',
    description: 'Separate platform administrator authentication; not assigned through customer invitations.',
    badgeClass: 'chip--lime',
    permissions: ['Cluster & GPU Allocation', 'Billing & Spend Overrides', 'User & Key Management', 'Security Audit Logs'],
  },
  customer: {
    title: 'Customer',
    description: 'Customer workspace access managed through AWS Cognito.',
    badgeClass: 'chip--amber',
    permissions: ['GPU Marketplace', 'Deployments', 'Usage & Billing'],
  },
  provider: {
    title: 'Provider',
    description: 'Provider workspace access.',
    badgeClass: 'chip--amber',
    permissions: ['Provider Listings', 'Capacity Management'],
  },
  developer: {
    title: 'Developer',
    description: 'API and inference workload access: create API keys, deploy serverless endpoints, and query LLM models.',
    badgeClass: 'chip--cyan',
    permissions: ['Model Inference API', 'API Key Generation', 'Telemetry & TTFT Logs', 'Inference Playground'],
  },
  viewer: {
    title: 'Viewer',
    description: 'Read-only visibility: monitor cluster health, view cost reports, throughput charts, and deployment metrics.',
    badgeClass: 'chip--amber',
    permissions: ['Read-only Metrics', 'Cost & Spend Reports', 'Cluster Uptime Dashboard', 'No API Key Access'],
  },
}

const ADMIN_DATA_BASE = '/api/admin/data'

<<<<<<< HEAD
type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<JsonObject> {
  const session = getSession()
  if (!session) throw new Error('Administrator sign-in is required.')

  const response = await fetch(`${ADMIN_DATA_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      ...init.headers,
    },
  })
  const body: unknown = await response.json().catch(() => null)
  if (!isJsonObject(body)) throw new Error('The server returned an invalid response.')
  if (!response.ok || body.ok !== true) {
    throw new Error(typeof body.error === 'string' ? body.error : 'The administrator data request failed.')
  }
  return body
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'customer' || value === 'provider' || value === 'developer' || value === 'viewer'
}

function isUserRecordStatus(value: unknown): value is UserRecordStatus {
  return value === 'active' || value === 'inactive' || value === 'pending' || value === 'suspended'
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`The server returned an invalid ${field}.`)
  }
  return value
}

function policyBoolean(policy: JsonObject, key: string, fallback: boolean): boolean {
  const value = policy[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`The server returned an invalid ${key} policy.`)
  return value
}

function toUserRecord(value: unknown): UserRecord {
  if (!isJsonObject(value)) throw new Error('The server returned an invalid user record.')
  const row = value
  if (
    typeof row.user_id !== 'string' ||
    typeof row.full_name !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.created_at !== 'string' ||
    !isUserRole(row.role) ||
    !isUserRecordStatus(row.status)
  ) {
    throw new Error('The server returned an incomplete user record.')
  }

  const policyValue = row.access_policy
  const policy = isJsonObject(policyValue) ? policyValue : {}
  const modelAccess = policy.model_access === undefined ? 'all' : policy.model_access
  const providerAccess = policy.provider_access === undefined ? 'all' : policy.provider_access
  if (modelAccess !== 'all' && modelAccess !== 'selected') {
    throw new Error('The server returned an invalid model access policy.')
  }
  if (providerAccess !== 'all' && providerAccess !== 'selected') {
    throw new Error('The server returned an invalid provider access policy.')
  }

  const monthlyLimit = policy.monthly_spend_limit
  let monthlySpendLimit: number | null = null
  if (typeof monthlyLimit === 'number' && Number.isFinite(monthlyLimit)) {
    monthlySpendLimit = monthlyLimit
  } else if (typeof monthlyLimit === 'string' && monthlyLimit.trim() && Number.isFinite(Number(monthlyLimit))) {
    monthlySpendLimit = Number(monthlyLimit)
  } else if (monthlyLimit !== undefined && monthlyLimit !== null && monthlyLimit !== '') {
    throw new Error('The server returned an invalid monthly spending limit.')
  }

  const username = typeof row.username === 'string' && row.username
    ? row.username
    : row.email.split('@')[0]
  const lastActive = typeof row.last_active_at === 'string' ? new Date(row.last_active_at) : null
  return {
    id: row.user_id,
    fullName: row.full_name,
    email: row.email,
    username,
    avatarUrl: typeof row.avatar_path === 'string' ? row.avatar_path : '',
    role: row.role,
    status: row.status,
    authMethod: 'cognito',
    modelAccess,
    selectedModels: stringArray(policy.selected_models, 'selected models'),
    providerAccess,
    selectedProviders: stringArray(policy.selected_providers, 'selected providers'),
    apiAccess: policyBoolean(policy, 'api_access', true),
    analyticsAccess: policyBoolean(policy, 'analytics_access', true),
    monthlySpendLimit,
    rateLimit: typeof policy.rate_limit === 'string' ? policy.rate_limit : 'Standard',
    internalNote: typeof policy.internal_note === 'string' ? policy.internal_note : '',
    createdAt: row.created_at,
    lastActive: lastActive && !Number.isNaN(lastActive.getTime()) ? lastActive.toLocaleString() : 'Never',
=======
const SEED_USERS: UserRecord[] = [
  {
    id: 'usr_inf_00_sahith',
    fullName: 'Sahith V',
    email: 'sahith1689vss@gmail.com',
    username: 'sahith',
    avatarUrl: '',
    role: 'developer',
    status: 'active',
    authMethod: 'password',
    modelAccess: 'all',
    selectedModels: ['deepseek-r1-671b', 'llama-3.3-70b', 'qwen-2.5-coder-32b'],
    providerAccess: 'all',
    selectedProviders: [],
    apiAccess: true,
    analyticsAccess: true,
    monthlySpendLimit: 250000,
    totalRequests: 84210,
    successRate: 99.8,
    rateLimit: '1,000 RPM (Enterprise Sovereign Tier)',
    internalNote: 'Customer workspace lead for sovereign cloud deployment.',
    createdAt: '2026-10-01T08:00:00Z',
    lastActive: 'Just now',
  },
  {
    id: 'usr_inf_01',
    fullName: 'Bhumi Reddy',
    email: 'bhumireddy@inferxe.com',
    username: 'bhumireddy',
    avatarUrl: '',
    role: 'admin',
    status: 'active',
    authMethod: 'invite',
    modelAccess: 'all',
    selectedModels: [],
    providerAccess: 'all',
    selectedProviders: [],
    apiAccess: true,
    analyticsAccess: true,
    monthlySpendLimit: 500000,
    totalRequests: 248920,
    successRate: 99.9,
    rateLimit: '1,200 RPM (Enterprise Cluster)',
    internalNote: 'Platform architect and organization administrator.',
    createdAt: '2026-09-01T10:00:00Z',
    lastActive: 'Just now',
  },
  {
    id: 'usr_inf_02',
    fullName: 'Priya Sharma',
    email: 'priya.s@novatech.ai',
    username: 'priya.ml',
    avatarUrl: '',
    role: 'developer',
    status: 'active',
    authMethod: 'invite',
    modelAccess: 'selected',
    selectedModels: ['deepseek-r1-671b', 'llama-3.3-70b', 'qwen-2.5-coder-32b'],
    providerAccess: 'all',
    selectedProviders: [],
    apiAccess: true,
    analyticsAccess: true,
    monthlySpendLimit: 75000,
    totalRequests: 19430,
    successRate: 99.4,
    rateLimit: '300 RPM (High Throughput)',
    internalNote: 'Lead ML Engineer building enterprise RAG pipeline on Yotta NM1 cluster.',
    createdAt: '2026-09-14T14:30:00Z',
    lastActive: '12 mins ago',
  },
  {
    id: 'usr_inf_03',
    fullName: 'Rohan Verma',
    email: 'rohan.v@finscale.in',
    username: 'rohan.infra',
    avatarUrl: '',
    role: 'developer',
    status: 'active',
    authMethod: 'password',
    modelAccess: 'all',
    selectedModels: [],
    providerAccess: 'selected',
    selectedProviders: ['yotta-nm1', 'e2e-delhi'],
    apiAccess: true,
    analyticsAccess: true,
    monthlySpendLimit: 120000,
    totalRequests: 43670,
    successRate: 98.9,
    rateLimit: '600 RPM (Production API)',
    internalNote: 'Sovereign data compliance lead. Bound to India-only GPU clusters.',
    createdAt: '2026-09-22T09:15:00Z',
    lastActive: '1 hour ago',
  },
  {
    id: 'usr_inf_04',
    fullName: 'Ananya Deshmukh',
    email: 'ananya.d@finscale.in',
    username: 'ananya.pm',
    avatarUrl: '',
    role: 'viewer',
    status: 'active',
    authMethod: 'invite',
    modelAccess: 'all',
    selectedModels: [],
    providerAccess: 'all',
    selectedProviders: [],
    apiAccess: false,
    analyticsAccess: true,
    monthlySpendLimit: 0,
    totalRequests: 1840,
    successRate: 100.0,
    rateLimit: '60 RPM (Standard)',
    internalNote: 'Product operations monitoring weekly inference budget and token usage.',
    createdAt: '2026-10-02T11:45:00Z',
    lastActive: 'Yesterday',
  },
  {
    id: 'usr_inf_05',
    fullName: 'Devon Vance',
    email: 'd.vance@quantcore.io',
    username: 'devon.v',
    avatarUrl: '',
    role: 'developer',
    status: 'inactive',
    authMethod: 'invite',
    modelAccess: 'selected',
    selectedModels: ['llama-3.1-8b'],
    providerAccess: 'selected',
    selectedProviders: ['lambda-us-west'],
    apiAccess: false,
    analyticsAccess: false,
    monthlySpendLimit: 25000,
    totalRequests: 0,
    successRate: 100.0,
    rateLimit: '60 RPM (Standard)',
    internalNote: 'Account pending pilot review.',
    createdAt: '2026-10-06T16:20:00Z',
    lastActive: 'Never',
  },
]

export function loadUsers(): UserRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_USERS))
      return SEED_USERS
    }
    const parsed = JSON.parse(raw) as UserRecord[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((u, i) => ({
        ...u,
        totalRequests:
          typeof u.totalRequests === 'number'
            ? u.totalRequests
            : (SEED_USERS[i]?.totalRequests ?? (u.status === 'active' ? 12500 : 0)),
        successRate:
          typeof u.successRate === 'number'
            ? u.successRate
            : (SEED_USERS[i]?.successRate ?? (u.status === 'active' ? 99.7 : 100.0)),
      }))
    }
    return SEED_USERS
  } catch {
    return SEED_USERS
>>>>>>> origin/main
  }
}

export async function loadUsers(): Promise<UserRecord[]> {
  const result = await adminRequest('/users')
  if (!Array.isArray(result.users)) throw new Error('The server returned an invalid customer list.')
  return result.users.map(toUserRecord)
}

export async function createUser(
  formData: UserFormData,
): Promise<{ ok: boolean; user?: UserRecord; error?: string }> {
  if (!formData.fullName.trim()) return { ok: false, error: 'Full name is required.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email.trim())) {
    return { ok: false, error: 'A valid email address is required.' }
  }

  try {
    const spendLimit = formData.monthlySpendLimit.trim()
      ? Number(formData.monthlySpendLimit.replace(/[^0-9.]/g, ''))
      : null
    if (spendLimit !== null && !Number.isFinite(spendLimit)) {
      return { ok: false, error: 'Spending limit must be a valid amount.' }
    }
    const result = await adminRequest('/users', {
      method: 'POST',
      body: JSON.stringify({
        full_name: formData.fullName.trim(),
        email: formData.email.trim(),
        username: formData.username.trim() || formData.email.trim().split('@')[0],
        role: formData.role,
        status: formData.status,
        model_access: formData.modelAccess,
        selected_models: formData.selectedModels,
        provider_access: formData.providerAccess,
        selected_providers: formData.selectedProviders,
        api_access: formData.apiAccess,
        analytics_access: formData.analyticsAccess,
        monthly_spend_limit: spendLimit,
        rate_limit: formData.rateLimit,
        internal_note: formData.internalNote.trim(),
      }),
    })
    return { ok: true, user: toUserRecord(result.user) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to invite customer.' }
  }
<<<<<<< HEAD
=======

  // Create new user record
  const newId = `usr_inf_${Math.random().toString(36).substring(2, 9)}`
  const newUser: UserRecord = {
    id: newId,
    fullName: formData.fullName.trim(),
    email: formData.email.trim(),
    username: formData.username.trim() || formData.email.split('@')[0],
    avatarUrl: formData.avatarUrl,
    role: formData.role,
    status: formData.status,
    authMethod: formData.authMethod,
    modelAccess: formData.modelAccess,
    selectedModels: formData.modelAccess === 'selected' ? formData.selectedModels : [],
    providerAccess: formData.providerAccess,
    selectedProviders: formData.providerAccess === 'selected' ? formData.selectedProviders : [],
    apiAccess: formData.apiAccess,
    analyticsAccess: formData.analyticsAccess,
    monthlySpendLimit: spendLimit,
    totalRequests: 0,
    successRate: 100.0,
    rateLimit: formData.rateLimit,
    internalNote: formData.internalNote.trim(),
    createdAt: new Date().toISOString(),
    lastActive: 'Just invited',
  }

  const updatedList = [newUser, ...currentUsers]
  saveUsers(updatedList)

  return { ok: true, user: newUser }
>>>>>>> origin/main
}

export async function deleteUser(id: string): Promise<void> {
  await adminRequest(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'inactive' }),
  })
}
