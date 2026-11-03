/**
 * NVIDIA GPU + open-model reference data.
 * Source: pitch deck slide 6, DPR §6.4, §7.2, §7.7, §14.3.
 * Rates are the DPR's *planning* figures (₹ per GPU-hour), not a contractual rate card.
 */

export type GpuTier = 'Entry' | 'Mid-range' | 'Production' | 'High-memory' | 'Frontier' | 'Multi-GPU'
export type GpuStatus = 'MVP' | 'Benchmarking' | 'Roadmap'

export interface Gpu {
  id: string
  name: string
  vram: number | null // GB, null when not a single-device figure
  vramLabel: string
  arch: string
  tier: GpuTier
  status: GpuStatus
  bandwidth: number | null // GB/s (published peak)
  bandwidthLabel: string
  role: string
  uses: string[]
  providerRange?: [number, number]
  listRange?: [number, number]
  rate: number | null // planning midpoint ₹/hr used by the calculator
}

export const GPUS: Gpu[] = [
  {
    id: 'l4',
    name: 'L4',
    vram: 24,
    vramLabel: '24 GB',
    arch: 'Ada Lovelace',
    tier: 'Entry',
    status: 'MVP',
    bandwidth: 300,
    bandwidthLabel: '300 GB/s',
    role: 'Smaller or quantized LLMs, embeddings',
    uses: ['Quantized 7–8B models', 'Embeddings', 'Lightweight assistants', 'Lower-volume inference'],
    providerRange: [41.92, 70],
    listRange: [55, 65],
    rate: 60,
  },
  {
    id: 'l40s',
    name: 'L40S',
    vram: 48,
    vramLabel: '48 GB',
    arch: 'Ada Lovelace',
    tier: 'Mid-range',
    status: 'MVP',
    bandwidth: 864,
    bandwidthLabel: '864 GB/s',
    role: 'Medium models, multimodal, higher throughput',
    uses: ['7–24B models at FP16/FP8', 'Multimodal workloads', 'Higher-throughput assistants'],
    providerRange: [83, 150],
    listRange: [90, 110],
    rate: 100,
  },
  {
    id: 'h100',
    name: 'H100',
    vram: 80,
    vramLabel: '80 GB',
    arch: 'Hopper',
    tier: 'Production',
    status: 'MVP',
    bandwidth: 3350,
    bandwidthLabel: 'up to 3.35 TB/s',
    role: 'Production inference, larger workloads',
    uses: ['Larger models', 'High concurrency', 'Latency-sensitive production traffic'],
    providerRange: [217, 400],
    listRange: [250, 300],
    rate: 275,
  },
  {
    id: 'h200',
    name: 'H200',
    vram: 141,
    vramLabel: '141 GB',
    arch: 'Hopper',
    tier: 'High-memory',
    status: 'Benchmarking',
    bandwidth: 4800,
    bandwidthLabel: 'up to 4.8 TB/s',
    role: 'Long-context, large-memory, high throughput',
    uses: ['Long-context serving', 'Large KV-cache budgets', 'High-throughput inference'],
    rate: null,
  },
  {
    id: 'b200',
    name: 'B200 class',
    vram: 180,
    vramLabel: '180 GB+',
    arch: 'Blackwell',
    tier: 'Frontier',
    status: 'Roadmap',
    bandwidth: null,
    bandwidthLabel: 'Subject to availability',
    role: 'High-end portfolio, subject to availability',
    uses: ['Large-scale, high-throughput workloads', 'Frontier-class capacity'],
    rate: null,
  },
  {
    id: 'gb200',
    name: 'GB200 / GB300',
    vram: null,
    vramLabel: 'Multi-GPU',
    arch: 'Grace Blackwell',
    tier: 'Multi-GPU',
    status: 'Roadmap',
    bandwidth: null,
    bandwidthLabel: 'Rack-scale topology',
    role: 'Topology-aware multi-GPU placement',
    uses: ['Large multi-GPU workloads', 'Topology-aware scheduling'],
    rate: null,
  },
]

export const gpuById = (id: string) => GPUS.find((g) => g.id === id)!

export type Quant = 'fp16' | 'fp8' | 'int4'
export const QUANTS: { id: Quant; label: string; bytes: number; hint: string }[] = [
  { id: 'fp16', label: 'FP16 / BF16', bytes: 2, hint: 'Full quality' },
  { id: 'fp8', label: 'FP8 / INT8', bytes: 1, hint: 'Half the weight memory' },
  { id: 'int4', label: 'INT4 (AWQ/GPTQ)', bytes: 0.56, hint: '≈ ¼ the weight memory' },
]

export interface LlmModel {
  id: string
  family: 'Qwen' | 'Llama' | 'Mistral'
  name: string
  params: number // billions
  kvBytesPerToken: number // FP16 KV cache: 2 × layers × kv_heads × head_dim × 2 bytes
  arch: string
}

export const MODELS: LlmModel[] = [
  { id: 'qwen2.5-7b', family: 'Qwen', name: 'Qwen2.5 7B Instruct', params: 7.6, kvBytesPerToken: 57344, arch: '28 layers · 4 KV heads' },
  { id: 'llama-3.1-8b', family: 'Llama', name: 'Llama 3.1 8B Instruct', params: 8.03, kvBytesPerToken: 131072, arch: '32 layers · 8 KV heads' },
  { id: 'mistral-7b', family: 'Mistral', name: 'Mistral 7B Instruct v0.3', params: 7.25, kvBytesPerToken: 131072, arch: '32 layers · 8 KV heads' },
  { id: 'qwen2.5-14b', family: 'Qwen', name: 'Qwen2.5 14B Instruct', params: 14.8, kvBytesPerToken: 196608, arch: '48 layers · 8 KV heads' },
  { id: 'mistral-small-24b', family: 'Mistral', name: 'Mistral Small 24B', params: 23.6, kvBytesPerToken: 163840, arch: '40 layers · 8 KV heads' },
  { id: 'qwen2.5-32b', family: 'Qwen', name: 'Qwen2.5 32B Instruct', params: 32.5, kvBytesPerToken: 262144, arch: '64 layers · 8 KV heads' },
  { id: 'llama-3.1-70b', family: 'Llama', name: 'Llama 3.1 70B Instruct', params: 70.6, kvBytesPerToken: 327680, arch: '80 layers · 8 KV heads' },
]

export const modelById = (id: string) => MODELS.find((m) => m.id === id)!
