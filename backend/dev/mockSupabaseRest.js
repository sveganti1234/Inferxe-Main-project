/**
 * mockSupabaseRest.js
 * ===================
 * Lightweight in-memory / local PostgREST REST mock middleware for local development.
 * Enables full customer workspace functionality (GPU marketplace, deployments, wallet,
 * profiles, SSH keys, API keys) when Supabase cloud credentials are not configured.
 *
 * Runs strictly on local development loopback (e.g. http://127.0.0.1:5174/rest/v1).
 */

import crypto from 'node:crypto'

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

// In-memory data store for local dev
const store = {
  profiles: new Map(),
  organizations: [
    {
      id: 'org_inferxe_dev',
      name: 'Sahith Workspace',
      slug: 'sahith-workspace',
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
  orders: [],
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
  return async function mockSupabaseMiddleware(req, res, next) {
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
    if (table === 'audit_logs' && req.method === 'POST') {
      return sendResponse(res, 201, { ok: true })
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
    if (table === 'deployments' && req.method === 'GET') {
      return sendResponse(res, 200, store.deployments)
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
    if (table === 'notifications' && req.method === 'GET') {
      return sendResponse(res, 200, store.notifications)
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

    // SSH PUBLIC KEYS
    if (table === 'ssh_public_keys') {
      if (req.method === 'GET') {
        return sendResponse(res, 200, store.ssh_public_keys)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = { id: `ssh_${Date.now()}`, ...body, created_at: new Date().toISOString() }
        store.ssh_public_keys.push(row)
        return sendResponse(res, 201, [row])
      }
    }

    // API KEYS
    if (table === 'api_keys') {
      if (req.method === 'GET') {
        return sendResponse(res, 200, store.api_keys)
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const row = { id: `key_${Date.now()}`, ...body, created_at: new Date().toISOString() }
        store.api_keys.push(row)
        return sendResponse(res, 201, [row])
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
