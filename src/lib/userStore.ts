import type { UserFormData, UserRecord, UserRole } from '../types/dashboard'

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
    description: 'Full organization authority: configure providers, manage user roles, view audit logs and set billing limits.',
    badgeClass: 'chip--lime',
    permissions: ['Cluster & GPU Allocation', 'Billing & Spend Overrides', 'User & Key Management', 'Security Audit Logs'],
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

const STORAGE_KEY = 'inferxe_dashboard_users_v2'

const SEED_USERS: UserRecord[] = [
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
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : SEED_USERS
  } catch {
    return SEED_USERS
  }
}

export function saveUsers(users: UserRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users))
  } catch (err) {
    console.error('Failed to save users in localStorage', err)
  }
}

export function getUserById(id: string): UserRecord | undefined {
  const users = loadUsers()
  return users.find((u) => u.id === id)
}

export async function createUserMock(formData: UserFormData): Promise<{ ok: boolean; user?: UserRecord; error?: string }> {
  // Simulate network latency (600ms - 800ms)
  await new Promise((res) => setTimeout(res, 700))

  // Validate required inputs
  if (!formData.fullName.trim()) {
    return { ok: false, error: 'Full name is required.' }
  }
  if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email)) {
    return { ok: false, error: 'A valid email address is required.' }
  }

  // Check email uniqueness
  const currentUsers = loadUsers()
  const exists = currentUsers.some((u) => u.email.toLowerCase() === formData.email.trim().toLowerCase())
  if (exists) {
    return { ok: false, error: 'A user with this email address already exists in this organization.' }
  }

  // Parse spending limit
  let spendLimit: number | null = null
  if (formData.monthlySpendLimit && formData.monthlySpendLimit.trim() !== '') {
    const cleanNum = Number(formData.monthlySpendLimit.replace(/[^0-9.]/g, ''))
    if (isNaN(cleanNum) || cleanNum < 0) {
      return { ok: false, error: 'Monthly spending limit must be a valid positive amount.' }
    }
    spendLimit = cleanNum
  }

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
    rateLimit: formData.rateLimit,
    internalNote: formData.internalNote.trim(),
    createdAt: new Date().toISOString(),
    lastActive: 'Just invited',
  }

  const updatedList = [newUser, ...currentUsers]
  saveUsers(updatedList)

  return { ok: true, user: newUser }
}

export function deleteUser(id: string): void {
  const users = loadUsers()
  const filtered = users.filter((u) => u.id !== id)
  saveUsers(filtered)
}
