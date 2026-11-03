import { QUANTS, modelById, gpuById, type Quant } from '../data/gpus'

/**
 * Illustrative placement maths — mirrors the *shape* of the platform's
 * compatibility → scoring pipeline (deck slide 4, DPR §7.4–§7.5).
 *
 *  need   = weights + KV cache (context × concurrency) + runtime overhead
 *  fits   = need ≤ 90 % of device memory   (vLLM's default gpu_memory_utilization)
 *  ceiling = memory-bandwidth ÷ weight bytes  (decode is memory-bound; an upper bound, not a benchmark)
 */

export type Priority = 'cost' | 'speed' | 'policy'

export interface Workload {
  modelId: string
  quant: Quant
  context: number
  concurrency: number
  priority: Priority
  budget: number // ₹/hr — BUDGET_MAX means "no cap"
  minTps: number // tokens/sec per stream (policy mode)
}

export const BUDGET_MAX = 1200
export const UTIL = 0.9

export interface Memory {
  weights: number
  kv: number
  overhead: number
  need: number
}

export function estimateMemory(w: Pick<Workload, 'modelId' | 'quant' | 'context' | 'concurrency'>): Memory {
  const m = modelById(w.modelId)
  const bytes = QUANTS.find((q) => q.id === w.quant)!.bytes
  const weights = m.params * bytes // GB (params in billions × bytes/param)
  const kv = (w.context * w.concurrency * m.kvBytesPerToken) / 1e9
  const overhead = 2 + 0.04 * weights
  return { weights, kv, overhead, need: weights + kv + overhead }
}

export type CandidateState = 'recommended' | 'fits' | 'too-small' | 'over-budget' | 'too-slow' | 'no-price'

export interface Candidate {
  key: string
  label: string
  gpuId: string
  count: number
  total: number // GB
  usable: number // GB
  rate: number | null // ₹/hr for the whole configuration
  ceiling: number // tokens/sec per stream, upper bound
  state: CandidateState
  headroom: number // 0-1 (can be negative)
}

const CONFIGS: { gpuId: string; count: number }[] = [
  { gpuId: 'l4', count: 1 },
  { gpuId: 'l40s', count: 1 },
  { gpuId: 'h100', count: 1 },
  { gpuId: 'h200', count: 1 },
  { gpuId: 'h100', count: 2 },
  { gpuId: 'h100', count: 4 },
  { gpuId: 'h100', count: 8 },
]

export function recommend(w: Workload): { memory: Memory; candidates: Candidate[]; pick: Candidate | null; note: string } {
  const memory = estimateMemory(w)
  const cap = w.budget >= BUDGET_MAX ? Infinity : w.budget

  const candidates: Candidate[] = CONFIGS.map(({ gpuId, count }) => {
    const g = gpuById(gpuId)
    const total = (g.vram ?? 0) * count
    const usable = total * UTIL
    const rate = g.rate == null ? null : g.rate * count
    const eff = count > 1 ? 0.8 : 1
    const ceiling = ((g.bandwidth ?? 0) * count * eff) / Math.max(memory.weights, 0.1)
    const fits = memory.need <= usable
    let state: CandidateState = fits ? 'fits' : 'too-small'
    if (fits && rate != null && rate > cap) state = 'over-budget'
    // A finite budget cap can't be verified against a GPU with no published planning price.
    if (fits && rate == null && cap !== Infinity) state = 'no-price'
    if (fits && state === 'fits' && w.priority === 'policy' && ceiling < w.minTps) state = 'too-slow'
    return {
      key: `${gpuId}x${count}`,
      label: count > 1 ? `${count}× ${g.name}` : g.name,
      gpuId,
      count,
      total,
      usable,
      rate,
      ceiling,
      state,
      headroom: 1 - memory.need / usable,
    }
  })

  const eligible = candidates.filter((c) => c.state === 'fits')
  let pick: Candidate | null = null
  if (eligible.length) {
    const byRate = (a: Candidate, b: Candidate) => (a.rate ?? Infinity) - (b.rate ?? Infinity) || a.total - b.total
    if (w.priority === 'speed') pick = [...eligible].sort((a, b) => b.ceiling - a.ceiling)[0]
    else pick = [...eligible].sort(byRate)[0]
    pick.state = 'recommended'
  }

  let note = ''
  if (!pick) {
    const anyFit = candidates.some((c) => c.headroom >= 0)
    if (!anyFit) note = 'No supported configuration can hold this workload — try a lower precision, shorter context or fewer concurrent requests.'
    else if (candidates.some((c) => c.state === 'over-budget' || c.state === 'no-price')) note = 'Compatible GPUs exist but exceed your budget cap — raise the cap or reduce the workload.'
    else note = 'Compatible GPUs exist but none reaches your tokens/sec target — relax the target or choose a higher-bandwidth class.'
  }
  return { memory, candidates, pick, note }
}

export const fmtGB = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} GB`
export const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`
export const defaultWorkload: Workload = {
  modelId: 'llama-3.1-8b',
  quant: 'fp16',
  context: 8192,
  concurrency: 8,
  priority: 'cost',
  budget: 150,
  minTps: 60,
}

