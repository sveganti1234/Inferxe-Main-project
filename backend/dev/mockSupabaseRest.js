/**
 * mockSupabaseRest.js
 * ===================
 * Lightweight in-memory / local PostgREST REST mock middleware for local development.
 * Enables full customer workspace functionality (GPU marketplace, deployments, wallet,
 * profiles, SSH keys, API keys) when Supabase cloud credentials are not configured.
 *
 * Runs strictly on local development loopback (e.g. http://127.0.0.1:5174/rest/v1).
 * Off unless INFERXE_LOCAL_MOCK_SUPABASE=1 outside production/staging (lib/supabase.js); when off the
 * middleware is a pass-through, so mounting it in a deployed server exposes nothing.
 */

import crypto from 'node:crypto'
import { isLocalMockSupabaseEnabled } from '../lib/supabase.js'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

// Default mock providers and GPU listings for local exploration
const DEFAULT_GPU_PROVIDERS = [
  {
    id: 'prov_jarvislabs',
    name: 'JarvisLabs.ai',
    slug: 'jarvislabs',
    region: 'India (Noida)',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prov_lambda',
    name: 'Lambda Labs',
    slug: 'lambda',
    region: 'US East (Virginia)',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prov_runpod',
    name: 'RunPod Cloud',
    slug: 'runpod',
    region: 'EU Central (Frankfurt)',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'prov_azure',
    name: 'Microsoft Azure HPC',
    slug: 'azure',
    region: 'Central India (Pune)',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const DEFAULT_GPU_LISTINGS = [
  {
    id: 'list_h100_sxm5',
    provider_id: 'prov_jarvislabs',
    name: 'NVIDIA H100 SXM5 80GB',
    gpu_model: 'NVIDIA H100',
    vram: 80,
    architecture: 'Hopper',
    bandwidth: 3350,
    tflops: 1979,
    region: 'India (Noida)',
    quantity: 16,
    hourly_price: 2.49,
    currency: 'INR',
    status: 'available',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list_a100_sxm4_80',
    provider_id: 'prov_jarvislabs',
    name: 'NVIDIA A100 SXM4 80GB',
    gpu_model: 'NVIDIA A100 80GB',
    vram: 80,
    architecture: 'Ampere',
    bandwidth: 2039,
    tflops: 624,
    region: 'India (Noida)',
    quantity: 24,
    hourly_price: 1.89,
    currency: 'INR',
    status: 'available',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list_a100_pcie_40',
    provider_id: 'prov_lambda',
    name: 'NVIDIA A100 PCIe 40GB',
    gpu_model: 'NVIDIA A100 40GB',
    vram: 40,
    architecture: 'Ampere',
    bandwidth: 1555,
    tflops: 312,
    region: 'US East (Virginia)',
    quantity: 32,
    hourly_price: 0.89,
    currency: 'INR',
    status: 'available',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list_l4_24',
    provider_id: 'prov_jarvislabs',
    name: 'NVIDIA L4 Tensor Core 24GB',
    gpu_model: 'NVIDIA L4',
    vram: 24,
    architecture: 'Ada Lovelace',
    bandwidth: 300,
    tflops: 242,
    region: 'India (Noida)',
    quantity: 48,
    hourly_price: 0.39,
    currency: 'INR',
    status: 'available',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list_rtx4090_24',
    provider_id: 'prov_runpod',
    name: 'RTX 4090',
    gpu_model: 'NVIDIA GeForce RTX 4090 24GB',
    vram: 24,
    architecture: 'Ada Lovelace',
    bandwidth: 1008,
    tflops: 82,
    region: 'EU Central (Frankfurt)',
    quantity: 64,
    hourly_price: 0.44,
    currency: 'INR',
    status: 'available',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'list_a30_24',
    provider_id: 'prov_azure',
    name: 'NVIDIA A30',
    gpu_model: 'NVIDIA A30 Tensor Core 24GB',
    vram: 24,
    architecture: 'Ampere',
    bandwidth: 933,
    tflops: 330,
    region: 'India (Noida)',
    quantity: 20,
    hourly_price: 0.49,
    currency: 'INR',
    status: 'available',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const DEFAULT_ADMIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$BT1KXGUqKNgs6a00ha61Rg$CtH85SvVzWopou6w7zWdYu0dTePYDAf48EHZ07XwjaE'
const PRIMARY_SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'

// In-memory data store for local dev
const store = {
  admin_users: new Map([
    [
      PRIMARY_SUPERADMIN_ID,
      {
        id: PRIMARY_SUPERADMIN_ID,
        email: 'admin@inferxe.com',
        full_name: 'Inferxe Super Admin',
        role: 'superadmin',
        is_active: true,
        status: 'active',
        session_version: 1,
        password_hash: DEFAULT_ADMIN_PASSWORD_HASH,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_login: null,
      },
    ],
    [
      'adm_super_main',
      {
        id: 'adm_super_main',
        email: 'superadmin@inferxe.com',
        full_name: 'Inferxe Platform Superadmin',
        role: 'superadmin',
        is_active: true,
        status: 'active',
        session_version: 1,
        password_hash: DEFAULT_ADMIN_PASSWORD_HASH,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_login: null,
      },
    ],
    [
      'adm_super_bhumi',
      {
        id: 'adm_super_bhumi',
        email: 'bhumireddy@inferxe.com',
        full_name: 'Bhumi Reddy',
        role: 'superadmin',
        is_active: true,
        status: 'active',
        session_version: 1,
        password_hash: DEFAULT_ADMIN_PASSWORD_HASH,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_login: null,
      },
    ],
    [
      'adm_regular_alex',
      {
        id: 'adm_regular_alex',
        email: 'alex.chen@inferxe.internal',
        full_name: 'Alex Chen',
        role: 'admin',
        is_active: true,
        status: 'active',
        session_version: 1,
        password_hash: DEFAULT_ADMIN_PASSWORD_HASH,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_login: null,
      },
    ],
  ]),
  admin_sessions: new Map(),
  audit_logs: [],
  profiles: new Map(),
  organizations: [
    {
      id: 'org_inferxe_dev',
      name: 'Local Dev Workspace',
      slug: 'local-dev-workspace',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  organization_members: [],
  gpu_providers: [...DEFAULT_GPU_PROVIDERS],
  gpu_listings: [...DEFAULT_GPU_LISTINGS],
  saved_gpu_listings: [],
  deployments: [
    {
      id: 'dep_llama3_70b',
      user_id: '',
      listing_id: 'list_h100_sxm5',
      name: 'Llama-3-70B-Instruct-v1',
      status: 'running',
      endpoint_url: 'https://llm.inferxe.dev/v1',
      gpu_count: 2,
      hourly_cost: 4.98,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
    {
      id: 'dep_sdxl_turbo',
      user_id: '',
      listing_id: 'list_rtx4090_24',
      name: 'Stable-Diffusion-XL-Turbo',
      status: 'running',
      endpoint_url: 'https://sd.inferxe.dev/v1',
      gpu_count: 1,
      hourly_cost: 0.69,
      created_at: '2026-02-05T00:00:00Z',
      updated_at: '2026-02-05T00:00:00Z',
    },
  ],
  orders: [
    {
      id: 'd9a494cb-1e8d-4bca-8142-19687fa91301',
      user_id: '',
      organization_id: 'org_inferxe_dev',
      deployment_id: 'dep_1',
      order_number: 'ORD-8492',
      item_name: 'Qwen 2.5 7B · 1x NVIDIA L4',
      provider_name: 'Yotta NM1 (Mumbai)',
      order_date: '2026-10-10T14:30:00Z',
      duration_minutes: 1440,
      total_cost: 1440,
      currency: 'INR',
      status: 'running',
      details: {
        gpu_model: '1x NVIDIA L4',
        workload: 'Qwen 2.5 7B',
        datacenter: 'Yotta NM1 (Mumbai)',
        specs: '24GB VRAM · 300 GB/s · PCIe Gen 4',
        start_date: '10 Oct 2026, 14:30',
        end_date: '11 Oct 2026, 14:30',
        duration: '24 hours',
        estimated_cost: '₹1,440',
        actual_cost: '₹1,440',
        payment_method: 'Prepaid Wallet',
        payment_status: 'Active Debit',
        transaction_id: 'TX-1048',
        invoice_number: 'INV-2026-08492',
      },
      created_at: '2026-10-10T14:30:00Z',
      updated_at: '2026-10-10T14:30:00Z',
    },
    {
      id: 'd9a494cb-1e8d-4bca-8142-19687fa91302',
      user_id: '',
      organization_id: 'org_inferxe_dev',
      deployment_id: 'dep_2',
      order_number: 'ORD-8431',
      item_name: 'Llama 3.1 8B · 1x NVIDIA L40S',
      provider_name: 'E2E Cloud (Noida)',
      order_date: '2026-10-08T09:15:00Z',
      duration_minutes: 720,
      total_cost: 1200,
      currency: 'INR',
      status: 'completed',
      details: {
        gpu_model: '1x NVIDIA L40S',
        workload: 'Llama 3.1 8B',
        datacenter: 'E2E Cloud (Noida)',
        specs: '48GB VRAM · 864 GB/s · Ada Lovelace',
        start_date: '08 Oct 2026, 09:15',
        end_date: '08 Oct 2026, 21:15',
        duration: '12 hours',
        estimated_cost: '₹1,200',
        actual_cost: '₹1,200',
        payment_method: 'Prepaid Wallet',
        payment_status: 'Paid & Settled',
        transaction_id: 'TX-1032',
        invoice_number: 'INV-2026-08431',
      },
      created_at: '2026-10-08T09:15:00Z',
      updated_at: '2026-10-08T21:15:00Z',
    },
    {
      id: 'd9a494cb-1e8d-4bca-8142-19687fa91303',
      user_id: '',
      organization_id: 'org_inferxe_dev',
      deployment_id: null,
      order_number: 'ORD-8390',
      item_name: 'DeepSeek R1 671B · 8x NVIDIA H100',
      provider_name: 'CtrlS Datacenters (Hyderabad)',
      order_date: '2026-10-04T16:00:00Z',
      duration_minutes: 240,
      total_cost: 8800,
      currency: 'INR',
      status: 'completed',
      details: {
        gpu_model: '8x NVIDIA H100',
        workload: 'DeepSeek R1 671B',
        datacenter: 'CtrlS Datacenters (Hyderabad)',
        specs: '640GB SXM5 · 3.35 TB/s · NVLink 4',
        start_date: '04 Oct 2026, 16:00',
        end_date: '04 Oct 2026, 20:00',
        duration: '4 hours',
        estimated_cost: '₹8,800',
        actual_cost: '₹8,800',
        payment_method: 'Prepaid Wallet',
        payment_status: 'Paid & Settled',
        transaction_id: 'TX-1011',
        invoice_number: 'INV-2026-08390',
      },
      created_at: '2026-10-04T16:00:00Z',
      updated_at: '2026-10-04T20:00:00Z',
    },
    {
      id: 'd9a494cb-1e8d-4bca-8142-19687fa91304',
      user_id: '',
      organization_id: 'org_inferxe_dev',
      deployment_id: null,
      order_number: 'ORD-8312',
      item_name: 'Mistral 7B · 1x NVIDIA L4',
      provider_name: 'Yotta NM1 (Mumbai)',
      order_date: '2026-10-01T11:00:00Z',
      duration_minutes: 480,
      total_cost: 480,
      currency: 'INR',
      status: 'cancelled',
      details: {
        gpu_model: '1x NVIDIA L4',
        workload: 'Mistral 7B',
        datacenter: 'Yotta NM1 (Mumbai)',
        specs: '24GB VRAM · 300 GB/s · PCIe Gen 4',
        start_date: '01 Oct 2026, 11:00',
        end_date: '01 Oct 2026, 11:05',
        duration: '8 hours (Cancelled after 5m)',
        estimated_cost: '₹480',
        actual_cost: '₹0',
        payment_method: 'Prepaid Wallet',
        payment_status: 'Refunded',
        transaction_id: 'TX-998',
        invoice_number: 'INV-2026-08312',
      },
      created_at: '2026-10-01T11:00:00Z',
      updated_at: '2026-10-01T11:05:00Z',
    },
    {
      id: 'd9a494cb-1e8d-4bca-8142-19687fa91305',
      user_id: '',
      organization_id: 'org_inferxe_dev',
      deployment_id: null,
      order_number: 'ORD-8201',
      item_name: 'CodeQwen 7B · 1x NVIDIA L40S',
      provider_name: 'Sify Infinit (Chennai)',
      order_date: '2026-09-25T08:00:00Z',
      duration_minutes: 4320,
      total_cost: 7200,
      currency: 'INR',
      status: 'archived',
      details: {
        gpu_model: '1x NVIDIA L40S',
        workload: 'CodeQwen 7B',
        datacenter: 'Sify Infinit (Chennai)',
        specs: '48GB VRAM · 864 GB/s · Ada Lovelace',
        start_date: '25 Sep 2026, 08:00',
        end_date: '28 Sep 2026, 08:00',
        duration: '72 hours',
        estimated_cost: '₹7,200',
        actual_cost: '₹7,200',
        payment_method: 'Prepaid Wallet',
        payment_status: 'Paid & Archived',
        transaction_id: 'TX-942',
        invoice_number: 'INV-2026-08201',
      },
      created_at: '2026-09-25T08:00:00Z',
      updated_at: '2026-09-28T08:00:00Z',
    },
  ],
  usage_records: [
    {
      id: 'usage_1',
      user_id: '',
      model: 'meta-llama/Llama-3-70b-instruct',
      tokens_input: 1420,
      tokens_output: 680,
      total_tokens: 2100,
      latency_ms: 382,
      status: 'success',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'usage_2',
      user_id: '',
      model: 'stabilityai/stable-diffusion-xl-turbo',
      tokens_input: 45,
      tokens_output: 1,
      total_tokens: 46,
      latency_ms: 1240,
      status: 'success',
      created_at: new Date(Date.now() - 7200000).toISOString(),
    },
  ],
  wallets: new Map(),
  wallet_transactions: [
    {
      id: 'tx_welcome_credit',
      wallet_id: '',
      user_id: '',
      amount: 250.00,
      currency: 'INR',
      type: 'credit',
      status: 'completed',
      description: 'Welcome GPU Compute Credits',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  api_keys: [],
  ssh_public_keys: [],
  notifications: [
    {
      id: 'notif_welcome',
      user_id: '',
      title: 'Welcome to Inferxe Compute Platform',
      message: 'Your developer workspace is ready with ₹250.00 compute credits.',
      type: 'info',
      read: false,
      created_at: new Date().toISOString(),
    },
  ],
  customer_plans: [],
  notebook_sessions: [],
  inference_requests: [],
  order_reviews: [],
  user_access_policies: [],
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    return {}
  }
}

function extractItemBody(body) {
  if (Array.isArray(body)) return body[0] || {}
  return body || {}
}

function sendResponse(res, status, data, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Prefer')
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v)
  }
  res.end(JSON.stringify(data))
}

export function createMockSupabaseMiddleware() {
  if (!isLocalMockSupabaseEnabled()) {
    return function mockSupabaseDisabled(_req, _res, next) {
      return next()
    }
  }
  console.warn('[mock-supabase] Local Supabase REST mock ENABLED (INFERXE_LOCAL_MOCK_SUPABASE=1); never use outside local development.')
  return async function mockSupabaseMiddleware(req, res, next) {
    // Defence in depth: only this machine may reach the mock, even if the flag leaks into a deployment.
    if (!LOOPBACK.has(req.socket?.remoteAddress || '')) return next()
    const parsedUrl = new URL(req.url, 'http://127.0.0.1:5174')
    const pathname = parsedUrl.pathname

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Prefer')
      return res.end()
    }

    // Wallet, budget and notifications are served only by the real notifications service (8002):
    // a canned answer here would show every customer the same made-up balance.
    if (!pathname.startsWith('/rest/v1/')) {
      return next()
    }

    const table = pathname.replace('/rest/v1/', '').split('?')[0].trim()
    const searchParams = parsedUrl.searchParams
    const isSingleObject = (req.headers.accept || '').includes('vnd.pgrst.object+json')

    // Handle audit logs
    if (table === 'audit_logs') {
      if (req.method === 'POST') {
        const body = await readJson(req)
        const log = { id: `log_${Date.now()}`, ...body, created_at: new Date().toISOString() }
        store.audit_logs.push(log)
        return sendResponse(res, 201, isSingleObject ? log : [log])
      }
      if (req.method === 'GET') {
        return sendResponse(res, 200, store.audit_logs)
      }
    }

    // ADMIN USERS
    if (table === 'admin_users') {
      const eqEmail = searchParams.get('email')?.replace(/^eq\./, '')?.toLowerCase()
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')

      if (req.method === 'GET') {
        let matched = Array.from(store.admin_users.values())
        if (eqEmail) {
          matched = matched.filter((a) => (a.email || '').toLowerCase() === eqEmail)
        }
        if (eqId) {
          matched = matched.filter((a) => a.id === eqId)
        }

        if (isSingleObject) {
          if (matched.length === 0) {
            return sendResponse(res, 200, null)
          }
          return sendResponse(res, 200, matched[0])
        }
        return sendResponse(res, 200, matched)
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req)
        let target = null
        if (eqId && store.admin_users.has(eqId)) {
          target = store.admin_users.get(eqId)
        } else if (eqEmail) {
          target = Array.from(store.admin_users.values()).find((a) => (a.email || '').toLowerCase() === eqEmail)
        }
        if (target) {
          Object.assign(target, body, { updated_at: new Date().toISOString() })
          return sendResponse(res, 200, isSingleObject ? target : [target])
        }
        return sendResponse(res, 200, isSingleObject ? null : [])
      }

      if (req.method === 'POST') {
        const body = await readJson(req)
        const newAdmin = {
          id: body.id || `adm_${Date.now()}`,
          email: (body.email || '').toLowerCase(),
          full_name: body.full_name || 'Admin',
          role: body.role || 'admin',
          is_active: body.is_active !== false,
          status: body.status || 'active',
          session_version: body.session_version || 1,
          password_hash: body.password_hash || DEFAULT_ADMIN_PASSWORD_HASH,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_login: null,
        }
        store.admin_users.set(newAdmin.id, newAdmin)
        return sendResponse(res, 201, isSingleObject ? newAdmin : [newAdmin])
      }
    }

    // ADMIN SESSIONS
    if (table === 'admin_sessions') {
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')
      const eqAdminId = searchParams.get('admin_user_id')?.replace(/^eq\./, '')

      if (req.method === 'GET') {
        let matched = Array.from(store.admin_sessions.values())
        if (eqId) {
          matched = matched.filter((s) => s.id === eqId)
        }
        if (eqAdminId) {
          matched = matched.filter((s) => s.admin_user_id === eqAdminId)
        }
        if (isSingleObject) {
          return sendResponse(res, 200, matched[0] || null)
        }
        return sendResponse(res, 200, matched)
      }

      if (req.method === 'POST') {
        const body = await readJson(req)
        const session = {
          id: body.id || crypto.randomUUID(),
          admin_user_id: body.admin_user_id,
          session_version: body.session_version || 1,
          expires_at: body.expires_at || new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          revoked_at: null,
        }
        store.admin_sessions.set(session.id, session)
        return sendResponse(res, 201, isSingleObject ? session : [session])
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req)
        let target = eqId ? store.admin_sessions.get(eqId) : null
        if (target) {
          Object.assign(target, body)
          return sendResponse(res, 200, isSingleObject ? target : [target])
        }
        return sendResponse(res, 200, isSingleObject ? null : [])
      }

      if (req.method === 'DELETE') {
        if (eqId) {
          store.admin_sessions.delete(eqId)
        }
        return sendResponse(res, 200, [])
      }
    }

    // PROFILES TABLE
    if (table === 'profiles') {
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')
      const eqEmail = searchParams.get('email')?.replace(/^eq\./, '')?.toLowerCase()

      if (req.method === 'GET') {
        let matched = Array.from(store.profiles.values())
        if (eqUserId) {
          matched = matched.filter((p) => p.user_id === eqUserId)
        }
        if (eqEmail) {
          matched = matched.filter((p) => (p.email || '').toLowerCase() === eqEmail)
        }

        if (matched.length === 0 && eqUserId) {
          const autoProfile = {
            user_id: eqUserId,
            full_name: 'Local Developer',
            email: 'developer@localhost.test',
            username: 'local-developer',
            avatar_path: null,
            role: 'customer',
            status: 'active',
            organization_id: 'org_inferxe_dev',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            login_count: 1,
            last_login_at: new Date().toISOString(),
          }
          store.profiles.set(eqUserId, autoProfile)
          matched = [autoProfile]
        }

        if (isSingleObject) {
          if (matched.length === 0) {
            return sendResponse(res, 200, null)
          }
          return sendResponse(res, 200, matched[0])
        }
        return sendResponse(res, 200, matched)
      }

      if (req.method === 'POST') {
        const body = await readJson(req)
        const profile = {
          user_id: body.user_id || body.cognito_sub || crypto.randomUUID(),
          full_name: body.full_name || 'Customer',
          email: (body.email || '').toLowerCase(),
          username: body.username || (body.email || '').split('@')[0] || 'customer',
          avatar_path: body.avatar_path || null,
          role: body.role || 'customer',
          status: body.status || 'active',
          organization_id: body.organization_id || 'org_inferxe_dev',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          login_count: (body.login_count || 0) + 1,
          last_login_at: new Date().toISOString(),
        }
        store.profiles.set(profile.user_id, profile)
        return sendResponse(res, 201, isSingleObject ? profile : [profile])
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req)
        let target = null
        if (eqUserId && store.profiles.has(eqUserId)) {
          target = store.profiles.get(eqUserId)
        } else if (eqEmail) {
          target = Array.from(store.profiles.values()).find((p) => p.email?.toLowerCase() === eqEmail)
        }
        if (!target && eqUserId) {
          target = {
            user_id: eqUserId,
            full_name: body.full_name || 'Customer',
            email: body.email || '',
            username: (body.email || 'customer').split('@')[0],
            avatar_path: null,
            role: 'customer',
            status: 'active',
            organization_id: 'org_inferxe_dev',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          store.profiles.set(eqUserId, target)
        }
        if (target) {
          Object.assign(target, body, { updated_at: new Date().toISOString() })
          return sendResponse(res, 200, isSingleObject ? target : [target])
        }
        return sendResponse(res, 200, isSingleObject ? null : [])
      }
    }

    // GPU PROVIDERS
    if (table === 'gpu_providers' && req.method === 'GET') {
      return sendResponse(res, 200, store.gpu_providers)
    }

    // GPU LISTINGS
    if (table === 'gpu_listings' && req.method === 'GET') {
      return sendResponse(res, 200, store.gpu_listings)
    }

    // WALLETS
    if (table === 'wallets') {
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')
      if (req.method === 'GET') {
        let wallet = eqUserId ? store.wallets.get(eqUserId) : null
        if (!wallet && eqUserId) {
          wallet = {
            id: `wal_${eqUserId.slice(0, 8)}`,
            user_id: eqUserId,
            currency: 'INR',
            balance: 250.00,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          }
          store.wallets.set(eqUserId, wallet)
        }
        const results = wallet ? [wallet] : Array.from(store.wallets.values())
        return sendResponse(res, 200, isSingleObject ? results[0] || null : results)
      }
    }

    // ORGANIZATIONS & MEMBERS
    if (table === 'organizations' && req.method === 'GET') {
      return sendResponse(res, 200, store.organizations)
    }
    if (table === 'organization_members' && req.method === 'GET') {
      return sendResponse(res, 200, store.organization_members)
    }

    // DEPLOYMENTS
    if (table === 'deployments') {
      if (req.method === 'GET') {
        return sendResponse(res, 200, store.deployments)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = {
          id: body.id || crypto.randomUUID(),
          user_id: body.user_id || '',
          organization_id: body.organization_id || null,
          listing_id: body.listing_id || null,
          name: body.name || 'Untitled deployment',
          model_name: body.model_name || 'Llama-3-70b-instruct',
          gpu_model: body.gpu_model || 'NVIDIA H100 80GB',
          region: body.region || 'Mumbai, IN',
          status: body.status || 'provisioning',
          hourly_rate: body.hourly_rate ?? 60,
          currency: body.currency || 'INR',
          endpoint_url: body.endpoint_url || `https://${(body.name || 'endpoint').toLowerCase().replace(/[^a-z0-9]/g, '-')}.endpoints.inferxe.com/v1`,
          started_at: body.started_at || new Date().toISOString(),
          stopped_at: null,
          metadata: body.metadata || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        store.deployments.unshift(row)
        return sendResponse(res, 201, [row])
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const id = searchParams.get('id')?.replace(/^eq\./, '')
        const item = store.deployments.find((d) => d.id === id)
        if (item) {
          Object.assign(item, body, { updated_at: new Date().toISOString() })
          return sendResponse(res, 200, [item])
        }
        return sendResponse(res, 404, { message: 'Not found' })
      }
      if (req.method === 'DELETE') {
        const id = searchParams.get('id')?.replace(/^eq\./, '')
        if (id) {
          store.deployments = store.deployments.filter((d) => d.id !== id)
        }
        return sendResponse(res, 200, [])
      }
    }

    // ORDERS
    if (table === 'orders') {
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')
      const eqStatus = searchParams.get('status')?.replace(/^eq\./, '')

      if (req.method === 'GET') {
        let results = store.orders
        if (eqId) {
          results = results.filter((o) => (o.id || '').toLowerCase() === eqId.toLowerCase())
        }
        if (eqUserId) {
          results = results.filter((o) => !o.user_id || o.user_id === eqUserId)
        }
        if (eqStatus) {
          results = results.filter((o) => (o.status || '').toLowerCase() === eqStatus.toLowerCase())
        }
        return sendResponse(res, 200, isSingleObject ? (results[0] || null) : results)
      }

      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = {
          id: body.id || crypto.randomUUID(),
          order_number: body.order_number || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
          status: body.status || 'running',
          currency: body.currency || 'INR',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...body,
        }
        store.orders.unshift(row)
        return sendResponse(res, 201, isSingleObject ? row : [row])
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const id = eqId || body.id
        const item = store.orders.find((o) => o.id === id)
        if (item) {
          Object.assign(item, body, { updated_at: new Date().toISOString() })
          return sendResponse(res, 200, isSingleObject ? item : [item])
        }
        return sendResponse(res, 404, { message: 'Order not found' })
      }

      if (req.method === 'DELETE') {
        const id = eqId
        if (id) {
          store.orders = store.orders.filter((o) => o.id !== id)
        }
        return sendResponse(res, 200, [])
      }
    }

    // USAGE RECORDS
    if (table === 'usage_records' && req.method === 'GET') {
      return sendResponse(res, 200, store.usage_records)
    }

    // WALLET TRANSACTIONS
    if (table === 'wallet_transactions' && req.method === 'GET') {
      return sendResponse(res, 200, store.wallet_transactions)
    }

    // NOTIFICATIONS
    if (table === 'notifications') {
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')

      if (req.method === 'GET') {
        let results = store.notifications
        if (eqId) results = results.filter((n) => n.id === eqId)
        if (eqUserId) results = results.filter((n) => !n.user_id || n.user_id === eqUserId)
        return sendResponse(res, 200, isSingleObject ? (results[0] || null) : results)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = { id: body.id || `notif_${Date.now()}`, ...body, created_at: new Date().toISOString() }
        store.notifications.push(row)
        return sendResponse(res, 201, isSingleObject ? row : [row])
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const matched = store.notifications.filter((n) => {
          if (eqId && n.id !== eqId) return false
          if (eqUserId && n.user_id && n.user_id !== eqUserId) return false
          return true
        })
        for (const m of matched) {
          Object.assign(m, body)
        }
        return sendResponse(res, 200, isSingleObject ? (matched[0] || null) : matched)
      }
      if (req.method === 'DELETE') {
        store.notifications = store.notifications.filter((n) => !eqId || n.id !== eqId)
        return sendResponse(res, 200, [])
      }
    }

    // SAVED GPU LISTINGS
    if (table === 'saved_gpu_listings') {
      if (req.method === 'GET') {
        return sendResponse(res, 200, store.saved_gpu_listings)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = { id: `save_${Date.now()}`, ...body, created_at: new Date().toISOString() }
        store.saved_gpu_listings.push(row)
        return sendResponse(res, 201, [row])
      }
      if (req.method === 'DELETE') {
        const listingId = searchParams.get('listing_id')?.replace(/^eq\./, '')
        if (listingId) {
          store.saved_gpu_listings = store.saved_gpu_listings.filter((r) => r.listing_id !== listingId)
        }
        return sendResponse(res, 200, [])
      }
    }

    // NOTEBOOK SESSIONS
    if (table === 'notebook_sessions') {
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')
      const eqSshKeyId = searchParams.get('selected_ssh_key_id')?.replace(/^eq\./, '')

      if (req.method === 'GET') {
        let results = store.notebook_sessions
        if (eqId) results = results.filter((s) => s.id === eqId)
        if (eqUserId) results = results.filter((s) => s.user_id === eqUserId)
        if (eqSshKeyId) results = results.filter((s) => s.selected_ssh_key_id === eqSshKeyId)
        return sendResponse(res, 200, isSingleObject ? (results[0] || null) : results)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = { id: body.id || crypto.randomUUID(), ...body, created_at: new Date().toISOString() }
        store.notebook_sessions.push(row)
        return sendResponse(res, 201, isSingleObject ? row : [row])
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const matched = store.notebook_sessions.filter((s) => {
          if (eqId && s.id !== eqId) return false
          if (eqUserId && s.user_id !== eqUserId) return false
          if (eqSshKeyId && s.selected_ssh_key_id !== eqSshKeyId) return false
          return true
        })
        for (const m of matched) {
          Object.assign(m, body)
        }
        return sendResponse(res, 200, isSingleObject ? (matched[0] || null) : matched)
      }
      if (req.method === 'DELETE') {
        store.notebook_sessions = store.notebook_sessions.filter((s) => !eqId || s.id !== eqId)
        return sendResponse(res, 200, [])
      }
    }

    // SSH PUBLIC KEYS
    if (table === 'ssh_public_keys') {
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')

      if (req.method === 'GET') {
        let results = store.ssh_public_keys
        if (eqId) results = results.filter((s) => s.id === eqId)
        if (eqUserId) results = results.filter((s) => s.user_id === eqUserId)
        return sendResponse(res, 200, isSingleObject ? (results[0] || null) : results)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = { id: body.id || crypto.randomUUID(), ...body, created_at: new Date().toISOString() }
        store.ssh_public_keys.push(row)
        return sendResponse(res, 201, isSingleObject ? row : [row])
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const matched = store.ssh_public_keys.filter((s) => {
          if (eqId && s.id !== eqId) return false
          if (eqUserId && s.user_id !== eqUserId) return false
          return true
        })
        for (const m of matched) {
          Object.assign(m, body)
        }
        return sendResponse(res, 200, isSingleObject ? (matched[0] || null) : matched)
      }
      if (req.method === 'DELETE') {
        const deleted = []
        store.ssh_public_keys = store.ssh_public_keys.filter((s) => {
          if (eqId && s.id === eqId) {
            if (!eqUserId || s.user_id === eqUserId) {
              deleted.push(s)
              return false
            }
          }
          return true
        })
        return sendResponse(res, 200, isSingleObject ? (deleted[0] || null) : deleted)
      }
    }

    // API KEYS
    if (table === 'api_keys') {
      const eqId = searchParams.get('id')?.replace(/^eq\./, '')
      const eqUserId = searchParams.get('user_id')?.replace(/^eq\./, '')
      const eqStatus = searchParams.get('status')?.replace(/^eq\./, '')
      const eqHash = searchParams.get('secret_hash')?.replace(/^eq\./, '')
      const eqRevokedAt = searchParams.get('revoked_at')
      const limit = parseInt(searchParams.get('limit') || '0', 10)

      if (req.method === 'GET') {
        let results = store.api_keys
        if (eqId) results = results.filter((k) => (k.id || '').toLowerCase() === eqId.toLowerCase())
        if (eqUserId) results = results.filter((k) => (k.user_id || '').toLowerCase() === eqUserId.toLowerCase())
        if (eqStatus) results = results.filter((k) => (k.status || '').toLowerCase() === eqStatus.toLowerCase())
        if (eqHash) results = results.filter((k) => (k.secret_hash || '').toLowerCase() === eqHash.toLowerCase())
        if (eqRevokedAt === 'is.null') results = results.filter((k) => k.revoked_at == null || k.revoked_at === '' || k.revoked_at === 'null')
        if (limit > 0) results = results.slice(0, limit)
        return sendResponse(res, 200, isSingleObject ? (results[0] || null) : results)
      }

      if (req.method === 'POST') {
        const body = extractItemBody(await readJson(req))
        const row = {
          id: body.id || crypto.randomUUID(),
          status: 'active',
          revoked_at: null,
          created_at: new Date().toISOString(),
          ...body,
        }
        row.status = row.status || 'active'
        row.revoked_at = row.revoked_at || null
        store.api_keys.push(row)
        return sendResponse(res, 201, isSingleObject ? row : [row])
      }

      if (req.method === 'PATCH') {
        const body = extractItemBody(await readJson(req))
        const matched = store.api_keys.filter((k) => {
          if (eqId && (k.id || '').toLowerCase() !== eqId.toLowerCase()) return false
          if (eqUserId && (k.user_id || '').toLowerCase() !== eqUserId.toLowerCase()) return false
          if (eqStatus && (k.status || '').toLowerCase() !== eqStatus.toLowerCase()) return false
          if (eqRevokedAt === 'is.null' && k.revoked_at != null && k.revoked_at !== '' && k.revoked_at !== 'null') return false
          return true
        })
        for (const m of matched) {
          Object.assign(m, body)
        }
        return sendResponse(res, 200, isSingleObject ? (matched[0] || null) : matched)
      }

      if (req.method === 'DELETE') {
        const deleted = []
        store.api_keys = store.api_keys.filter((k) => {
          if (eqId && (k.id || '').toLowerCase() === eqId.toLowerCase()) {
            if (!eqUserId || (k.user_id || '').toLowerCase() === eqUserId.toLowerCase()) {
              deleted.push(k)
              return false
            }
          }
          return true
        })
        return sendResponse(res, 200, isSingleObject ? (deleted[0] || null) : deleted)
      }
    }

    // Default fallback for any other table
    if (req.method === 'GET') {
      const records = store[table] || []
      return sendResponse(res, 200, isSingleObject ? records[0] || null : records)
    }

    return sendResponse(res, 200, [])
  }
}
