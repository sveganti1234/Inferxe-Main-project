import {
  Shuffle,
  Scale,
  Gauge,
  Network,
  ServerCog,
  ShieldCheck,
  Database,
  Activity,
  KeyRound,
  Globe2,
  Timer,
  Wallet,
  GitBranch,
  Radar,
  Terminal,
  FlaskConical,
  Building2,
  Code2,
  LineChart,
  Container,
  Fingerprint,
  EyeOff,
  FileSearch,
  RefreshCw,
  HeartPulse,
  Microscope,
  Sparkles,
  Plug,
  ListChecks,
  Zap,
  Coins,
  Layers,
  Cpu,
  Lock,
  Rocket,
  Brain,
  Receipt,
  Bot,
  ScanSearch,
  Route,
  type LucideIcon,
} from 'lucide-react'

/* ── Problem (deck slide 2) ───────────────────────────── */
export const PROBLEMS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Shuffle,
    title: 'Too many GPU choices',
    body: 'Customers map workloads to GPU models, VRAM and provider SKUs on their own.',
  },
  {
    icon: Scale,
    title: 'Hard-to-compare pricing',
    body: 'GPU-hour, minute, reserved and usage pricing differ by provider and region.',
  },
  {
    icon: Plug,
    title: 'Provider-specific APIs',
    body: 'Each provider has its own inventory, deployment steps and lifecycle API.',
  },
  {
    icon: Radar,
    title: 'Uncertain availability',
    body: 'Capacity shifts, and there is little comparable performance data per workload.',
  },
]

/* ── Intents (deck slide 3) ───────────────────────────── */
export const INTENTS = [
  {
    id: 'cost',
    label: 'Cost',
    icon: Coins,
    quote: 'Give me the cheapest GPU that can run this workload.',
    detail:
      'Hard constraints first — model, VRAM, context — then rank every compatible option by effective price and pick the cheapest that fits.',
    outcome: 'Lowest compatible ₹/hr',
  },
  {
    id: 'speed',
    label: 'Speed',
    icon: Zap,
    quote: 'Give me the fastest available GPU within my budget.',
    detail:
      'Compatible GPUs are scored on throughput and latency, then filtered by the budget you set. You get the quickest option you can afford.',
    outcome: 'Highest throughput under cap',
  },
  {
    id: 'policy',
    label: 'Policy',
    icon: Globe2,
    quote: 'Run this model in India with a specified latency target.',
    detail:
      'Region, residency and latency targets become routing constraints. The engine only considers placements that satisfy your policy.',
    outcome: 'Placement that satisfies policy',
  },
] as const

/* ── How it works (deck slide 4) ──────────────────────── */
export const STEPS: { n: string; icon: LucideIcon; title: string; body: string }[] = [
  { n: '01', icon: ListChecks, title: 'Describe workload', body: 'Model, memory, latency, budget, region and policy.' },
  { n: '02', icon: ScanSearch, title: 'Filter by compatibility', body: 'Remove GPUs and providers that fail hard constraints.' },
  { n: '03', icon: Gauge, title: 'Score and select', body: 'Rank on price, latency, throughput and availability.' },
  { n: '04', icon: ServerCog, title: 'Provision through adapter', body: 'Provider-specific calls stay behind one contract.' },
  { n: '05', icon: RefreshCw, title: 'Run, observe, learn', body: 'Telemetry and cost feed back into future routing.' },
]

/* ── Architecture (deck slide 5) ──────────────────────── */
export const LAYERS: {
  id: string
  tag: string
  title: string
  body: string
  chips: string[]
  icon: LucideIcon
}[] = [
  {
    id: 'experience',
    tag: 'LAYER 01',
    title: 'Experience + API',
    body: 'Web console and an OpenAPI-first developer API, with API keys and quotas.',
    chips: ['Web console', 'OpenAPI-first API', 'API keys', 'Quotas'],
    icon: Terminal,
  },
  {
    id: 'control',
    tag: 'LAYER 02',
    title: 'Control plane',
    body: 'Workload profile, compatibility, routing, policy and telemetry.',
    chips: ['Workload profile', 'Compatibility', 'Routing', 'Policy', 'Telemetry'],
    icon: Brain,
  },
  {
    id: 'abstraction',
    tag: 'LAYER 03',
    title: 'Provider abstraction',
    body: 'One adapter contract: catalogue, capacity, lifecycle and errors.',
    chips: ['Catalogue', 'Capacity', 'Lifecycle', 'Errors'],
    icon: Plug,
  },
  {
    id: 'providers',
    tag: 'LAYER 04',
    title: 'GPU providers',
    body: 'Adding a provider means adding an adapter. The public API stays the same.',
    chips: ['JarvisLabs · live in MVP', 'Mock adapter', 'Contract test', 'More providers · Phase 2'],
    icon: Cpu,
  },
]

/* ── Moat (deck slide 7) ──────────────────────────────── */
export const MOAT: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Database, title: 'Normalized provider & GPU data', body: 'One comparable schema across providers, regions and billing models.' },
  { icon: FlaskConical, title: 'Measured benchmark corpus', body: 'TTFT, latency and tokens/sec measured per workload — not assumed.' },
  { icon: Route, title: 'Routing & policy engine', body: 'Deterministic compatibility plus scored, policy-aware placement.' },
  { icon: Code2, title: 'Developer API adoption', body: 'A stable, OpenAPI-first contract applications build against once.' },
  { icon: Plug, title: 'Provider adapter ecosystem', body: 'Every new adapter widens supply without touching the public API.' },
  { icon: HeartPulse, title: 'Telemetry & reliability history', body: 'Operational data compounds into better placement and failover.' },
  { icon: ShieldCheck, title: 'Enterprise governance layer', body: 'Audit events, quotas, rate limits and private control-plane options.' },
]

export const MARKET = {
  supply: {
    title: 'GPU providers',
    caption: 'Rent capacity',
    names: ['JarvisLabs (MVP)', 'E2E Networks', 'Yotta', 'Cyfuture', 'Tata Communications', 'Sify'],
    note: 'India-focused providers under evaluation as future adapters, subject to commercial and API availability.',
  },
  intermediaries: {
    title: 'Marketplaces & intermediaries',
    caption: 'Aggregate supply',
    names: ['Shadeform', 'Spheron AI', 'GPUNET', 'SphereCompute', 'Vast.ai', 'TensorDock'],
    note: 'Provider aggregation and supplier matchmaking already exist.',
  },
}

/* ── Business model (deck slide 8, DPR §14) ───────────── */
export const STREAMS: {
  icon: LucideIcon
  title: string
  body: string
  phase: string
  tone: 'lime' | 'cyan' | 'amber' | 'violet'
}[] = [
  { icon: Coins, title: 'Usage margin', body: 'A fee over normalized provider compute cost.', phase: 'Early commercial phase', tone: 'lime' },
  { icon: Container, title: 'Managed inference fee', body: 'An added fee when Inferxe manages the runtime.', phase: 'After runtime is stable', tone: 'cyan' },
  { icon: Building2, title: 'Enterprise subscription', body: 'Private control plane, governance and SLA.', phase: 'Enterprise phase', tone: 'violet' },
  { icon: Wallet, title: 'Reserved capacity margin', body: 'Margin on committed capacity.', phase: 'Later phase', tone: 'amber' },
  { icon: Network, title: 'Provider revenue share', body: 'Commercial terms for routed demand.', phase: 'After multi-provider launch', tone: 'lime' },
]

export const PRICING_MODELS = [
  { title: 'GPU-based', basis: 'GPU capacity allocated or consumed', unit: 'GPU-hour / GPU-minute' },
  { title: 'Request-based', basis: 'Number of inference requests', unit: 'Per request' },
  { title: 'Reserved / committed', basis: 'Reserved capacity for a defined period', unit: 'Hour / day / week / month' },
]

export const PRICING_FAQ = [
  {
    q: 'What do I actually pay?',
    a: 'Customer price = provider cost + service fee. The fee is applied over the normalized provider compute cost, so you always see what the GPU costs and what Inferxe adds.',
  },
  {
    q: 'Are the rates on this page final?',
    a: 'No. They are planning figures — indicative ranges and suggested list rates. Provider pricing, taxes, region, discounts and availability are verified against live provider rate cards before any commercial commitment.',
  },
  {
    q: 'Does Inferxe own the GPUs?',
    a: 'No. Inferxe is the decision and orchestration layer. In the MVP, JarvisLabs supplies the underlying GPU infrastructure; we do not own physical GPUs.',
  },
  {
    q: 'How is billing handled during the MVP?',
    a: 'The MVP shows estimated infrastructure cost for every deployment — estimated up front, recorded from usage afterwards. Unified multi-provider billing is part of the later roadmap.',
  },
  {
    q: 'What happens if a provider fails?',
    a: 'The platform records the error, marks the resource unhealthy, returns a controlled error and keeps deployment state clean so nothing is orphaned. Automatic multi-provider failover arrives with Phase 3.',
  },
  {
    q: 'Which models can I run?',
    a: 'Open-weight models such as Qwen, Llama and Mistral, subject to hardware compatibility. The engine checks weights, KV-cache and runtime overhead against VRAM before it recommends a GPU.',
  },
]

/* ── Roadmap (deck slide 9, DPR §12–§13) ──────────────── */
export const MVP_TRACKS: { id: string; title: string; weeks: [number, number]; items: string; color: string }[] = [
  { id: 'foundation', title: 'Foundation', weeks: [1, 4], items: 'Control plane, auth, API keys, GPU catalogue', color: 'var(--brand)' },
  { id: 'engine', title: 'Core engine', weeks: [3, 7], items: 'Compatibility, routing, JarvisLabs adapter, vLLM', color: 'var(--cyan)' },
  { id: 'console', title: 'Console + ops', weeks: [5, 9], items: 'Cost views, monitoring, audit events, rate limits', color: 'var(--amber)' },
  { id: 'validation', title: 'Validation', weeks: [8, 12], items: 'End-to-end tests, mock adapter, benchmarks, handover', color: 'var(--violet)' },
]

export const PHASES: { phase: string; title: string; body: string; icon: LucideIcon }[] = [
  { phase: 'Phase 2', title: 'More providers', body: 'Additional provider adapters and live price normalization.', icon: Plug },
  { phase: 'Phase 3', title: 'Telemetry-driven routing', body: 'Routing learns from observed latency, errors and cost — with automatic failover.', icon: Activity },
  { phase: 'Phases 4–6', title: 'Multi-region & enterprise', body: 'Multi-region placement and an enterprise control plane.', icon: Globe2 },
]

export const DELIVERY_PHASES = [
  { n: 1, title: 'Requirements & architecture', weeks: [1, 2], out: 'Requirements freeze, architecture, database model, API contract, technology setup.' },
  { n: 2, title: 'UI/UX & frontend foundation', weeks: [2, 3], out: 'Dashboard, requirement form, GPU recommendation screens and authentication flow.' },
  { n: 3, title: 'Backend foundation', weeks: [2, 4], out: 'FastAPI services, PostgreSQL schema, auth integration, API security and validation.' },
  { n: 4, title: 'JarvisLabs integration', weeks: [3, 5], out: 'Provider adapter, resource lookup, provisioning, lifecycle and error handling.' },
  { n: 5, title: 'vLLM / model deployment', weeks: [4, 6], out: 'Docker serving environment, model loading, inference endpoint and deployment automation.' },
  { n: 6, title: 'Usage, cost & monitoring', weeks: [5, 7], out: 'Usage records, pricing estimates, Prometheus/Grafana metrics and status dashboard.' },
  { n: 7, title: 'Integration testing', weeks: [7, 9], out: 'End-to-end provisioning, inference, failure and performance tests.' },
  { n: 8, title: 'Optimization & documentation', weeks: [9, 10], out: 'Bug fixes, benchmark tuning, API docs, deployment guide and user guide.' },
  { n: 9, title: 'Staging, demo & go-live', weeks: [10, 12], out: 'Staging validation, final demonstration, handover and production readiness review.' },
] as { n: number; title: string; weeks: [number, number]; out: string }[]

export const FUTURE_SCOPE: { n: string; icon: LucideIcon; title: string; body: string }[] = [
  { n: '01', icon: Network, title: 'Multi-LLM & multi-provider integration', body: 'Add multiple LLMs and third-party inference/GPU providers through a common adapter layer.' },
  { n: '02', icon: Route, title: 'AI-based intelligent routing', body: 'Select the inference source on cost, latency, model capability and observed availability.' },
  { n: '03', icon: Rocket, title: 'Advanced vLLM serving', body: 'Improve throughput, batching and concurrent-request handling.' },
  { n: '04', icon: ScanSearch, title: 'Intelligent request classification', body: 'Classify request complexity and choose the suitable execution path.' },
  { n: '05', icon: Coins, title: 'Dynamic cost optimization', body: 'Compare current pricing and usage patterns to pick cost-efficient execution.' },
  { n: '06', icon: LineChart, title: 'Real-time monitoring & latency optimization', body: 'Use observed response time, errors and provider health to improve selection.' },
  { n: '07', icon: RefreshCw, title: 'Automatic failover & recovery', body: 'Move eligible workloads to another provider when the primary is unavailable.' },
  { n: '08', icon: EyeOff, title: 'Privacy-aware routing', body: 'Use workload sensitivity and data-handling requirements to select controlled execution.' },
  { n: '09', icon: Building2, title: 'Enterprise & on-premise deployment', body: 'Private deployments, governance and enterprise infrastructure requirements.' },
  { n: '10', icon: Microscope, title: 'Continuous benchmarking & quality evaluation', body: 'Continuously compare latency, cost and response quality across supported sources.' },
]

/* ── Platform capabilities (DPR §5.2) ─────────────────── */
export const CAPABILITIES: {
  icon: LucideIcon
  title: string
  body: string
  span?: 'wide' | 'tall'
}[] = [
  { icon: ListChecks, title: 'Requirement collector', body: 'Captures model, VRAM, context, concurrency, latency preference, budget and region in one structured workload profile.', span: 'wide' },
  { icon: Brain, title: 'GPU recommendation engine', body: 'Maps workload characteristics to supported GPU configurations — deterministic compatibility first, scored ranking second.' },
  { icon: Plug, title: 'Provider adapter', body: 'Isolates provider-specific API operations behind one contract: catalogue, capacity, lifecycle, errors.' },
  { icon: ServerCog, title: 'Deployment manager', body: 'Creates, updates and stops GPU instances with explicit lifecycle states that prevent orphaned resources.', span: 'tall' },
  { icon: Container, title: 'Model deployment service', body: 'Prepares Docker + vLLM serving configuration and model selection for Qwen, Llama and Mistral.' },
  { icon: Terminal, title: 'Inference gateway', body: 'A controlled, authenticated and validated inference interface in front of every deployment.', span: 'wide' },
  { icon: Wallet, title: 'Usage & cost tracker', body: 'Records request counts, TTFT, token usage and estimated cost where telemetry is available.' },
  { icon: Activity, title: 'Monitoring', body: 'Application and inference health, resource metrics and operational alerts via Prometheus and Grafana.' },
]

/* ── Evaluation framework (DPR §7.5) ──────────────────── */
export const CRITERIA: { name: string; weight: 'Mandatory' | 'High' | 'Medium'; body: string }[] = [
  { name: 'GPU memory / model fit', weight: 'Mandatory', body: 'Model weights + KV cache + runtime overhead must fit.' },
  { name: 'Security / compliance', weight: 'Mandatory', body: 'Credentials, isolation, encryption and data-handling controls.' },
  { name: 'Performance', weight: 'High', body: 'Measured tokens/sec, prompt processing and concurrency.' },
  { name: 'Cost', weight: 'High', body: 'Effective GPU-hour and estimated workload cost.' },
  { name: 'Latency', weight: 'High', body: 'TTFT and response latency under representative load.' },
  { name: 'Availability', weight: 'High', body: 'Provisioning success and current capacity.' },
  { name: 'Reliability', weight: 'High', body: 'Failure rate, recovery and provider service stability.' },
  { name: 'API / provisioning', weight: 'High', body: 'Automation capability and consistency of provider integration.' },
  { name: 'Networking', weight: 'Medium', body: 'Model download, API access and distributed workloads.' },
]

export const ADAPTER_DUTIES = [
  'Translate platform resource requests into provider-specific requests',
  'Map platform GPU identifiers to provider resource identifiers',
  'Attach provider credentials securely',
  'Normalize provider responses into internal deployment/resource structures',
  'Map provider errors into platform-standard errors',
  'Stay generic enough for E2E, Yotta, Cyfuture or other future adapters',
]

export const BENCH_METRICS = [
  'Time-to-first-token (TTFT)',
  'End-to-end response latency',
  'Output tokens per second',
  'Model loading time',
  'GPU memory utilization',
  'VRAM consumption',
  'CPU / RAM utilization',
  'Concurrent-request behaviour',
  'Request success / error rate',
  'Streaming responsiveness',
]

export const VLLM_POINTS = [
  { icon: Rocket, title: 'High-throughput serving', body: 'vLLM is the inference runtime that serves the selected open model on the provisioned GPU.' },
  { icon: Layers, title: 'Efficient request handling', body: 'Continuous batching and KV-cache management improve utilization when many requests are active.' },
  { icon: Plug, title: 'OpenAI-compatible API', body: 'A standard request shape lets applications reach any deployed model the same way.' },
  { icon: Activity, title: 'Observable by default', body: 'Serving health, latency, TTFT, throughput and errors are captured where telemetry is available.' },
]

/* ── End-to-end workflow (DPR §5.3) ───────────────────── */
export const E2E_STEPS = [
  'Customer registers or logs in',
  'Selects a supported model and enters workload requirements',
  'Backend validates requirements and checks compatible GPU options',
  'Recommendation logic selects a suitable GPU configuration',
  'Backend calls the provider through the adapter',
  'GPU instance is provisioned and its lifecycle state is stored',
  'Docker and vLLM are configured on the GPU resource',
  'The open LLM is loaded and exposed through an inference endpoint',
  'Customer sends prompts through the console or API',
  'Response, latency and usage are recorded',
  'Customer stops or terminates the deployment when finished',
]

export const ARCH_LAYERS = [
  { layer: 'Client', main: 'React + TypeScript', does: 'Requirements, GPU selection, deployment status, pricing and inference UI.' },
  { layer: 'Identity / API', main: 'Demo sessions, API keys, HTTPS', does: 'Local demo identity and secure programmatic access.' },
  { layer: 'Application', main: 'FastAPI + Python', does: 'Requirement analysis, GPU recommendation, provisioning orchestration, deployment state and inference coordination.' },
  { layer: 'Provider integration', main: 'Provider API / SDK adapter', does: 'Availability and resource lookup, instance creation and lifecycle operations.' },
  { layer: 'Execution', main: 'GPU + Docker + vLLM + Qwen / Llama / Mistral', does: 'Actual model serving and inference.' },
  { layer: 'Data / observability', main: 'PostgreSQL, Redis, Prometheus, Grafana', does: 'Users, resources, deployments, usage, pricing, logs/metrics and cached state.' },
]

export const FLOW_NODES = [
  'Customer',
  'Requirements',
  'GPU recommendation',
  'Inferxe / FastAPI',
  'Provider GPU',
  'Docker + vLLM',
  'Open LLM',
  'Inference API',
  'Usage · performance · cost',
]

export const LIFECYCLE = ['Requested', 'Validating', 'Provisioning', 'Deploying', 'Running', 'Stopping', 'Terminated']

/* ── Data model (DPR §8.1) ────────────────────────────── */
export const DATA_ENTITIES: { name: string; info: string }[] = [
  { name: 'Users', info: 'Account identity, authentication references, status and roles.' },
  { name: 'Providers', info: 'Provider identity, integration configuration and health/status metadata.' },
  { name: 'GPU configurations', info: 'GPU type, VRAM, capabilities, pricing references and compatibility metadata.' },
  { name: 'Models', info: 'Model family, variant, deployment requirements and supported GPUs.' },
  { name: 'Deployments', info: 'Customer, provider resource, model, state, timestamps, endpoint metadata and lifecycle events.' },
  { name: 'Inference requests', info: 'Deployment, request ID, status, latency/TTFT and timestamps.' },
  { name: 'Usage', info: 'Token and request counts, runtime and estimated cost.' },
  { name: 'Pricing', info: 'GPU/resource price, unit, source, timestamp and validity context.' },
  { name: 'Audit / events', info: 'Provisioning, lifecycle, security and operational events.' },
]

/* ── API (DPR §9) ─────────────────────────────────────── */
export interface Endpoint {
  id: string
  group: string
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  summary: string
}
export const ENDPOINTS: Endpoint[] = [
  { id: 'register', group: 'Authentication', method: 'POST', path: '/api/auth/register', summary: 'Register a customer account' },
  { id: 'login', group: 'Authentication', method: 'POST', path: '/api/auth/login', summary: 'Authenticate and obtain tokens' },
  { id: 'gpus', group: 'GPU catalogue', method: 'GET', path: '/api/gpus', summary: 'List supported GPU configurations' },
  { id: 'recommend', group: 'GPU catalogue', method: 'POST', path: '/api/gpus/recommend', summary: 'Recommend a compatible GPU for a workload' },
  { id: 'models', group: 'Models', method: 'GET', path: '/api/models', summary: 'List supported models and deployment metadata' },
  { id: 'create-dep', group: 'Deployments', method: 'POST', path: '/api/deployments', summary: 'Create a deployment' },
  { id: 'get-dep', group: 'Deployments', method: 'GET', path: '/api/deployments/{id}', summary: 'Inspect a deployment' },
  { id: 'stop-dep', group: 'Deployments', method: 'DELETE', path: '/api/deployments/{id}', summary: 'Stop and release a deployment' },
  { id: 'inference', group: 'Inference', method: 'POST', path: '/api/inference', summary: 'Submit an inference request to an active deployment' },
  { id: 'usage', group: 'Usage', method: 'GET', path: '/api/usage', summary: 'Retrieve request, runtime and usage information' },
  { id: 'pricing', group: 'Pricing', method: 'GET', path: '/api/pricing', summary: 'Pricing references and estimated cost' },
  { id: 'health', group: 'Monitoring', method: 'GET', path: '/api/health', summary: 'Service and provider health' },
  { id: 'metrics', group: 'Monitoring', method: 'GET', path: '/api/metrics', summary: 'Service and performance metrics' },
]

export const ERRORS: { code: string; meaning: string }[] = [
  { code: '400', meaning: 'Invalid requirement, model, GPU or request data.' },
  { code: '401 / 403', meaning: 'Authentication or authorization failure.' },
  { code: '404', meaning: 'Deployment, model or resource not found.' },
  { code: '409', meaning: 'Conflicting deployment or resource state.' },
  { code: '429', meaning: 'Rate limit or controlled admission response.' },
  { code: '500', meaning: 'Unexpected platform-side failure.' },
  { code: '502 / 503', meaning: 'Provider or inference service unavailable.' },
  { code: '504', meaning: 'Provider or inference service timeout.' },
]

export const RELIABILITY_PRACTICES = [
  { icon: Zap, title: 'Async provider I/O', body: 'Asynchronous calls to providers where appropriate.' },
  { icon: Timer, title: 'Timeouts & controlled retries', body: 'Bounded provider timeouts and retries for retryable failures only.' },
  { icon: Fingerprint, title: 'Idempotent provisioning', body: 'Idempotency for provisioning operations where supported.' },
  { icon: Database, title: 'Cached metadata', body: 'Stable GPU/model metadata cached; Redis optional in Phase 1.' },
  { icon: HeartPulse, title: 'Health checks', body: 'Probes for provider and vLLM services.' },
  { icon: GitBranch, title: 'Explicit state transitions', body: 'Deployment states prevent duplicate provisioning.' },
]

/* ── Tech stack (DPR §10) ─────────────────────────────── */
export const STACK: { cat: string; tech: string; role: string }[] = [
  { cat: 'Frontend', tech: 'React + TypeScript', role: 'Customer dashboard, requirement forms, GPU selection, deployment status and inference UI.' },
  { cat: 'Backend', tech: 'FastAPI + Python', role: 'API, orchestration, GPU recommendation, provider integration and inference coordination.' },
  { cat: 'Database', tech: 'PostgreSQL', role: 'Users, GPUs, models, deployments, pricing, usage and performance.' },
  { cat: 'GPU compute', tech: 'NVIDIA GPUs via JarvisLabs.ai', role: 'Actual GPU compute and provider resource lifecycle (single provider in the MVP).' },
  { cat: 'LLM serving', tech: 'vLLM', role: 'GPU-backed model serving and OpenAI-compatible inference endpoint.' },
  { cat: 'Models', tech: 'Qwen / Llama / Mistral', role: 'Open-weight model execution on provisioned GPUs.' },
  { cat: 'Authentication', tech: 'Local demo sessions', role: 'Browser-only demo registration and login; not intended for production identity or access control.' },
  { cat: 'API security', tech: 'API keys + HTTPS', role: 'Programmatic access and encryption in transit.' },
  { cat: 'Cache', tech: 'Redis (optional)', role: 'Availability, pricing and deployment-state cache.' },
  { cat: 'Observability', tech: 'Prometheus + Grafana', role: 'Health, latency, throughput and resource metrics.' },
  { cat: 'Containers', tech: 'Docker', role: 'Reproducible application and vLLM environments.' },
  { cat: 'Cloud', tech: 'AWS', role: 'Customer-facing platform services; the GPU provider stays the compute layer.' },
  { cat: 'Delivery', tech: 'GitLab', role: 'Repository, branches, code review and CI/CD.' },
]

/* ── Security, trust, risk (DPR §6.7, §11) ────────────── */
export const SECURITY_CONTROLS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: KeyRound, title: 'Managed secrets', body: 'Provider credentials and deployment secrets never live in source code — environment variables or secret management, with rotation.' },
  { icon: Fingerprint, title: 'Demo authentication', body: 'Customer demo accounts are stored in the browser and are not production-secure. Production deployments must configure a trusted identity provider.' },
  { icon: Network, title: 'Isolated inference endpoints', body: 'vLLM is never exposed as a public unauthenticated service — the backend is the controlled interface to the model.' },
  { icon: Gauge, title: 'Rate limits & quotas', body: 'Request limits protect both the platform and GPU spend from abuse or accidental spikes.' },
  { icon: ScanSearch, title: 'Input validation', body: 'Request size and parameters are validated before anything is forwarded to a model.' },
  { icon: FileSearch, title: 'Audit trail', body: 'Provisioning, lifecycle, security and operational events recorded for traceability.' },
]

export const PRIVACY_POINTS = [
  'Store only the minimum necessary user-query information.',
  'Define logging and retention rules for assistant requests.',
  'Encrypt data and apply access control to prompts and responses.',
  'Define deletion rules — avoid unnecessary prompt/response storage.',
  'Region-aware controls and compliance assessment for data residency.',
]

export interface Risk {
  id: string
  title: string
  l: number
  i: number
  mitigation: string
}
export const RISKS: Risk[] = [
  { id: 'R-01', title: 'Local vLLM / inference service failure', l: 3, i: 5, mitigation: 'Health checks, service monitoring and controlled recovery.' },
  { id: 'R-02', title: 'Provider outage', l: 3, i: 5, mitigation: 'Provider health checks and future eligible fallback.' },
  { id: 'R-03', title: 'Traffic spike / resource exhaustion', l: 4, i: 4, mitigation: 'Rate limits, quotas, queue and admission controls.' },
  { id: 'R-04', title: 'API security attack', l: 3, i: 5, mitigation: 'Authentication, authorization, validation, rate limits and monitoring.' },
  { id: 'R-05', title: 'Latency degradation', l: 3, i: 4, mitigation: 'P95/P99 monitoring and workload-aware GPU selection.' },
  { id: 'R-06', title: 'Provider pricing change', l: 3, i: 4, mitigation: 'Timestamped pricing and customer cost limits.' },
  { id: 'R-07', title: 'Incorrect GPU recommendation', l: 3, i: 4, mitigation: 'Compatibility rules, benchmark validation and a manual override path.' },
  { id: 'R-08', title: 'Billing / usage discrepancy', l: 3, i: 4, mitigation: 'Usage records, reconciliation and audit trail.' },
  { id: 'R-09', title: 'Provider concentration', l: 3, i: 4, mitigation: 'Provider abstraction and future multi-provider adapters.' },
  { id: 'R-10', title: 'Monitoring blind spot', l: 3, i: 4, mitigation: 'Centralized metrics, logs and alerts.' },
  { id: 'R-11', title: 'Credential compromise', l: 2, i: 5, mitigation: 'Secret storage, rotation, least privilege and audit logs.' },
  { id: 'R-12', title: 'Customer prompt / data exposure', l: 2, i: 5, mitigation: 'Minimize retention, encrypt data and apply access control.' },
  { id: 'R-13', title: 'Database / supporting service failure', l: 2, i: 5, mitigation: 'Backups, recovery and service monitoring.' },
  { id: 'R-14', title: 'Data residency / compliance gap', l: 2, i: 5, mitigation: 'Region-aware controls and compliance assessment.' },
  { id: 'R-15', title: 'Provider API / version change', l: 3, i: 3, mitigation: 'Adapter layer, contract tests and versioned integration.' },
]

export const KRIS = [
  { name: 'Provider error rate', detects: 'Provider instability', response: 'Reduce use, investigate, future failover.' },
  { name: 'vLLM error rate', detects: 'Local inference problems', response: 'Investigate model, service and GPU health.' },
  { name: 'P95 / P99 latency', detects: 'Performance degradation', response: 'Re-evaluate GPU and model fit.' },
  { name: 'Queue / resource utilization', detects: 'Capacity pressure', response: 'Throttle or scale where supported.' },
  { name: 'Auth failures', detects: 'Credential abuse', response: 'Throttle, investigate and rotate credentials.' },
  { name: 'Unusual request volume', detects: 'Abuse or accidental spike', response: 'Apply quotas and rate limits.' },
  { name: 'Usage-cost variance', detects: 'Billing issue', response: 'Reconcile and alert.' },
  { name: 'Deployment failure rate', detects: 'Provisioning / orchestration problems', response: 'Review provider API and state transitions.' },
]

export const RISK_OWNERS = [
  'Project / Risk Owner',
  'Platform / Backend Owner',
  'Inference / vLLM Owner',
  'Security Owner',
  'Data / DB Owner',
  'Provider Integration Owner',
  'Finance / Business Owner',
  'DevOps / Operations Owner',
]

export const TESTS = [
  { area: 'Authentication', t: 'Registration, login, token expiry, authorization and API-key revocation.' },
  { area: 'GPU recommendation', t: 'Minimum VRAM, model fit, invalid requirements and cost comparison.' },
  { area: 'Provisioning', t: 'Create, status, retry, timeout, duplicate-request and termination scenarios.' },
  { area: 'vLLM', t: 'Model loading, endpoint health, inference response and concurrency.' },
  { area: 'API', t: 'Validation, rate limits, error codes and timeout behaviour.' },
  { area: 'Performance', t: 'TTFT, tokens/sec, request latency and resource utilization.' },
  { area: 'Security', t: 'Secret exposure checks, unauthorized access and input validation.' },
  { area: 'Recovery', t: 'Provider/API failure, partial deployment and cleanup scenarios.' },
]

/* ── Solutions (DPR §4.5, image: Users / Clients) ─────── */
export const PERSONAS: { icon: LucideIcon; title: string; sub: string; body: string; img: string; points: string[] }[] = [
  {
    icon: Code2,
    title: 'Developers',
    sub: 'Individuals & teams',
    body: 'Ship GPU-backed features without learning GPU SKUs. Describe the model and constraints; get a compatible, costed recommendation and a working endpoint.',
    img: '/images/code.webp',
    points: ['Requirement-based GPU recommendation', 'Docker + vLLM provisioned for you', 'OpenAI-compatible endpoint'],
  },
  {
    icon: Building2,
    title: 'Enterprises',
    sub: 'Governance & policy',
    body: 'Keep control while you scale. Region and latency policy, quotas, rate limits and audit events sit on top of every placement decision.',
    img: '/images/enterprise.webp',
    points: ['Policy-aware placement', 'Audit events & quotas', 'Private control plane (enterprise phase)'],
  },
  {
    icon: Terminal,
    title: 'Applications',
    sub: 'Via API',
    body: 'Treat GPU compute as an API. Create, inspect and stop deployments programmatically, and read usage and cost back into your own product.',
    img: '/images/dev-desk.webp',
    points: ['OpenAPI-first contract', 'Programmatic lifecycle control', 'Usage and cost endpoints'],
  },
  {
    icon: FlaskConical,
    title: 'Researchers',
    sub: 'Benchmarks & experiments',
    body: 'Compare open models across GPU classes with measured TTFT, latency and tokens/sec instead of vendor datasheets.',
    img: '/images/engineers.webp',
    points: ['Measured benchmark corpus', 'L4 → H200 coverage', 'Reproducible Docker + vLLM setups'],
  },
]

export const USE_CASES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Brain, title: 'GPU selection assistance', body: 'Specify model and workload needs; receive a suitable GPU recommendation with the reasoning.' },
  { icon: Container, title: 'Managed deployment', body: 'Skip manual GPU setup, Docker configuration and vLLM installation entirely.' },
  { icon: Bot, title: 'LLM inference', body: 'Use the deployed open model through the console or the API.' },
  { icon: Receipt, title: 'Cost estimation', body: 'See estimated infrastructure cost for the selected GPU and expected usage — before you commit.' },
  { icon: ServerCog, title: 'Deployment lifecycle', body: 'Monitor a workload and stop or terminate it the moment you are finished.' },
  { icon: Network, title: 'Provider comparison', body: 'The same workflow will compare multiple infrastructure providers as adapters arrive.' },
]

export const SCENARIOS = [
  {
    tag: 'Developer team',
    title: 'Ship an assistant without learning GPU SKUs',
    steps: ['Pick a Qwen model and a context target', 'Inferxe sizes weights + KV cache and recommends a compatible GPU', 'Docker + vLLM deploy automatically', 'Call the OpenAI-compatible endpoint'],
  },
  {
    tag: 'Enterprise',
    title: 'Run it in India with a latency target',
    steps: ['Declare region and latency as policy', 'Placement filters to providers that satisfy both', 'Audit events record every provisioning action', 'Quotas and rate limits cap exposure'],
  },
  {
    tag: 'Research lab',
    title: 'Benchmark one model across GPU classes',
    steps: ['Select the model and quantization', 'Run on L4, L40S, H100 and H200', 'Compare TTFT, latency and tokens/sec', 'Feed results into routing decisions'],
  },
]

export const JOURNEY = ['Register', 'Describe workload', 'Review recommendation', 'Deploy', 'Run inference', 'Monitor cost', 'Stop & release']

/* ── India-first (DPR §3.2, §13.1) ────────────────────── */
export const INDIA_PROVIDERS = [
  { name: 'E2E Networks', fit: 'GPU cloud docs, multiple GPU generations, OpenAI-compatible GenAI API.' },
  { name: 'Yotta', fit: 'Sovereign, large-scale AI infrastructure with AI endpoints.' },
  { name: 'Cyfuture', fit: 'API-driven GPUaaS with documented provisioning/SDK patterns.' },
  { name: 'Tata Communications', fit: 'Enterprise and sovereign AI-cloud (Vayu) with GPUaaS.' },
  { name: 'Sify', fit: 'Enterprise GPUaaS across multiple service models.' },
  { name: 'NxtGen', fit: 'Enterprise GPUaaS candidate.' },
  { name: 'Neysa', fit: 'AI/GPU infrastructure suited to larger workloads.' },
  { name: 'Jio Platforms', fit: 'India-hosted GPU-accelerated cloud candidate.' },
]

/* ── Principles + references ──────────────────────────── */
export const PRINCIPLES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Plug, title: 'Provider abstraction', body: 'Provider-specific code stays behind an adapter boundary — always.' },
  { icon: Layers, title: 'Stateless logic, durable state', body: 'Application logic stays stateless where practical; persistent state belongs in PostgreSQL.' },
  { icon: GitBranch, title: 'Explicit deployment states', body: 'Every resource has a known state, which prevents orphaned GPUs and surprise bills.' },
  { icon: Lock, title: 'Least-privilege by default', body: 'Credentials are scoped, stored in secret management and audited.' },
  { icon: Activity, title: 'Observable operations', body: 'Provisioning, deployment and inference all emit useful logs and metrics.' },
  { icon: Sparkles, title: 'Measured, not assumed', body: 'Routing decisions are validated against benchmark data, not datasheets.' },
]

export const REFERENCES: { group: string; items: { cite: string; note?: string }[] }[] = [
  {
    group: 'Research foundations',
    items: [
      { cite: 'Jiang et al. (2025). Demystifying Cost-Efficiency in LLM Serving over Heterogeneous GPUs. ICML 2025.' },
      { cite: 'Griggs et al. (2024). Mélange: Cost-Efficient LLM Serving by Exploiting GPU Heterogeneity. arXiv:2404.14527.' },
      { cite: 'Jiang, Fu & Yoneki (2026). BOute: Cost-Efficient LLM Serving with Heterogeneous LLMs and GPUs. MLSys 2026.' },
      { cite: 'Reddi et al. (2019). MLPerf Inference Benchmark. arXiv:1911.02549.' },
    ],
  },
  {
    group: 'Benchmarking & routing',
    items: [
      { cite: 'MLCommons. MLPerf Inference Benchmark Suite.' },
      { cite: 'Artificial Analysis. LLM Performance Leaderboard.' },
      { cite: 'OpenRouter and LiteLLM — unified APIs, routing, fallbacks and cost tracking across providers.' },
      { cite: 'vLLM Project. OpenAI-Compatible Server documentation.' },
    ],
  },
  {
    group: 'Security & risk',
    items: [
      { cite: 'NIST (2023). AI Risk Management Framework (AI RMF 1.0), NIST AI 100-1.' },
      { cite: 'OWASP Foundation (2023). OWASP API Security Top 10 — 2023.' },
    ],
  },
]

export const STACK_MARQUEE = [
  'NVIDIA GPUs',
  'vLLM',
  'Docker',
  'FastAPI',
  'PostgreSQL',
  'React',
  'TypeScript',
  'Demo authentication',
  'Prometheus',
  'Grafana',
  'Redis',
  'Qwen',
  'Llama',
  'Mistral',
  'JarvisLabs',
  'OpenAPI',
]
