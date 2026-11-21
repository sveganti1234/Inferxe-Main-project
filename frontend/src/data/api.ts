import { ENDPOINTS, type Endpoint } from './content'
import { defaultWorkload, estimateMemory, recommend } from '../lib/calc'

/**
 * Illustrative request/response contracts for the endpoints named in the DPR (§9).
 * The final OpenAPI specification is the source of truth.
 */
export interface Doc {
  status: number
  req?: unknown
  query?: string
  res: unknown
}

const w = defaultWorkload
const mem = estimateMemory(w)
const rec = recommend(w)
const pick = rec.pick!
const round = (n: number, d = 1) => Number(n.toFixed(d))

export const DOCS: Record<string, Doc> = {
  register: {
    status: 201,
    req: { email: 'dev@example.com', password: '<password>' },
    res: { user_id: 'usr_01J9K2', status: 'pending_verification' },
  },
  login: {
    status: 200,
    req: { email: 'dev@example.com', password: '<password>' },
    res: { access_token: '<jwt>', expires_in: 3600, mfa_required: false },
  },
  gpus: {
    status: 200,
    res: {
      gpus: [
        { id: 'l4', name: 'NVIDIA L4', vram_gb: 24, provider: 'jarvislabs', list_rate_inr_per_hour: 60 },
        { id: 'l40s', name: 'NVIDIA L40S', vram_gb: 48, provider: 'jarvislabs', list_rate_inr_per_hour: 100 },
        { id: 'h100', name: 'NVIDIA H100', vram_gb: 80, provider: 'jarvislabs', list_rate_inr_per_hour: 275 },
      ],
    },
  },
  recommend: {
    status: 200,
    req: {
      model: 'llama-3.1-8b-instruct',
      quantization: w.quant,
      context_length: w.context,
      concurrency: w.concurrency,
      priority: w.priority,
      budget_inr_per_hour: w.budget,
      region: 'IN',
    },
    res: {
      recommendation: {
        gpu: pick.label,
        vram_gb: pick.total,
        provider: 'jarvislabs',
        estimated_cost_inr_per_hour: pick.rate,
        compatibility: {
          required_vram_gb: round(mem.need),
          usable_vram_gb: round(pick.usable),
          headroom_pct: Math.round(pick.headroom * 100),
        },
        rationale: 'Cheapest configuration that holds weights, KV cache and runtime overhead.',
      },
      alternatives: rec.candidates
        .filter((c) => c.state === 'over-budget' || (c.state === 'fits' && c.key !== pick.key))
        .slice(0, 2)
        .map((c) => ({ gpu: c.label, estimated_cost_inr_per_hour: c.rate, reason: c.state === 'over-budget' ? 'over budget' : 'compatible' })),
    },
  },
  models: {
    status: 200,
    res: {
      models: [
        { id: 'qwen2.5-7b-instruct', family: 'Qwen', min_vram_gb: 16 },
        { id: 'llama-3.1-8b-instruct', family: 'Llama', min_vram_gb: 18 },
        { id: 'mistral-7b-instruct-v0.3', family: 'Mistral', min_vram_gb: 16 },
      ],
    },
  },
  'create-dep': {
    status: 202,
    req: { model: 'llama-3.1-8b-instruct', gpu: pick.label, provider: 'jarvislabs', auto_stop_minutes: 60 },
    res: { id: 'dep_01J9KQ7', state: 'provisioning', endpoint: null, estimated_cost_inr_per_hour: pick.rate, created_at: '2026-10-07T10:42:00Z' },
  },
  'get-dep': {
    status: 200,
    res: {
      id: 'dep_01J9KQ7',
      state: 'running',
      gpu: pick.label,
      model: 'llama-3.1-8b-instruct',
      endpoint: 'https://<deployment-endpoint>/v1',
      lifecycle: ['requested', 'provisioning', 'deploying', 'running'],
    },
  },
  'stop-dep': { status: 202, res: { id: 'dep_01J9KQ7', state: 'stopping' } },
  inference: {
    status: 200,
    req: {
      deployment_id: 'dep_01J9KQ7',
      messages: [{ role: 'user', content: 'Summarise this ticket in two sentences.' }],
      max_tokens: 200,
      stream: false,
    },
    res: {
      id: 'inf_01J9KRC',
      choices: [{ index: 0, message: { role: 'assistant', content: '…' } }],
      usage: { prompt_tokens: 42, completion_tokens: 87 },
      metrics: { ttft_ms: '<measured>', latency_ms: '<measured>' },
    },
  },
  usage: {
    status: 200,
    query: '?deployment_id=dep_01J9KQ7',
    res: { deployment_id: 'dep_01J9KQ7', requests: '<count>', tokens_in: '<count>', tokens_out: '<count>', runtime_minutes: '<minutes>', estimated_cost_inr: '<amount>' },
  },
  pricing: {
    status: 200,
    res: { unit: 'inr_per_gpu_hour', as_of: '<timestamp>', gpus: [{ gpu: 'L40S', list_rate: 100, source: 'provider+fee' }] },
  },
  health: { status: 200, res: { status: 'ok', providers: { jarvislabs: 'healthy' }, inference: 'healthy' } },
  metrics: { status: 200, res: '# Prometheus exposition format\ninferxe_deployments_active 3\ninferxe_request_latency_seconds_bucket{le="0.5"} …' },
}

const BASE = '$INFERXE_BASE_URL'

export function toCurl(e: Endpoint, d: Doc): string {
  const body = d.req ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(d.req, null, 2).replace(/\n/g, '\n  ')}'` : ''
  return `curl -X ${e.method} "${BASE}${e.path}${d.query ?? ''}" \\\n  -H "Authorization: Bearer $INFERXE_API_KEY"${body}`
}

export function toPython(e: Endpoint, d: Doc): string {
  const json = d.req ? `,\n    json=${JSON.stringify(d.req, null, 4).replace(/\n/g, '\n    ').replace(/: true/g, ': True').replace(/: false/g, ': False').replace(/: null/g, ': None')}` : ''
  return `import os, requests

r = requests.${e.method.toLowerCase()}(
    f"{os.environ['INFERXE_BASE_URL']}${e.path}${d.query ?? ''}",
    headers={"Authorization": f"Bearer {os.environ['INFERXE_API_KEY']}"}${json},
)
print(r.status_code, r.json())`
}

export function toTs(e: Endpoint, d: Doc): string {
  const body = d.req ? `,\n  body: JSON.stringify(${JSON.stringify(d.req, null, 2).replace(/\n/g, '\n  ')})` : ''
  return `const res = await fetch(\`\${process.env.INFERXE_BASE_URL}${e.path}${d.query ?? ''}\`, {
  method: "${e.method}",
  headers: {
    Authorization: \`Bearer \${process.env.INFERXE_API_KEY}\`,
    "Content-Type": "application/json",
  }${body},
})
console.log(res.status, await res.json())`
}

export const GROUPS = Array.from(new Set(ENDPOINTS.map((e) => e.group))).map((g) => ({ group: g, items: ENDPOINTS.filter((e) => e.group === g) }))
