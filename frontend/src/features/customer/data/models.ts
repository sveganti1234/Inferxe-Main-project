/**
 * Model reference catalogue and GPU-fit estimator for the console.
 *
 * Everything here is STATIC REFERENCE INFORMATION: model specifications come from
 * `src/data/gpus.ts` and the memory maths from the existing `lib/calc.ts` calculator.
 * It deliberately never exposes planning prices, roadmap status or any availability claim —
 * the underlying `recommend()` is called with an unlimited budget and the "speed" priority
 * only to reuse its fit/ceiling maths, and its "recommended" pick is neutralised to "fits".
 */
import { BUDGET_MAX, UTIL, estimateMemory, recommend, type Memory } from '../../../lib/calc'
import { MODELS, QUANTS, type LlmModel, type Quant } from '../../../data/gpus'

export type ModelFamily = LlmModel['family']
export const MODEL_FAMILIES: ModelFamily[] = ['Qwen', 'Llama', 'Mistral']
export { QUANTS, type Quant }

export const CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072] as const
export const CONCURRENCY_PRESETS = [1, 2, 4, 8, 16, 32, 64] as const
export const MAX_COMPARE = 3

export interface Scenario {
  modelId: string
  quant: Quant
  context: number
  concurrency: number
}

export const DEFAULT_SCENARIO: Scenario = { modelId: 'llama-3.1-8b', quant: 'fp16', context: 8192, concurrency: 8 }

export interface ModelRow {
  id: string
  name: string
  family: ModelFamily
  /** Parameters in billions. */
  params: number
  architecture: string
  /** FP16 KV cache size per token, in KiB. */
  kvKibPerToken: number
  /** Weight memory in GB at each precision. */
  weightsGb: Record<Quant, number>
}

export function selectModelRows(): ModelRow[] {
  return [...MODELS]
    .sort((a, b) => a.params - b.params || a.name.localeCompare(b.name))
    .map((m): ModelRow => ({
      id: m.id,
      name: m.name,
      family: m.family,
      params: m.params,
      architecture: m.arch,
      kvKibPerToken: m.kvBytesPerToken / 1024,
      weightsGb: Object.fromEntries(QUANTS.map((q) => [q.id, m.params * q.bytes])) as Record<Quant, number>,
    }))
}

export function filterModels(rows: ModelRow[], f: { query: string; family: ModelFamily | 'all' }): ModelRow[] {
  const q = f.query.trim().toLowerCase()
  return rows.filter((m) => {
    if (f.family !== 'all' && m.family !== f.family) return false
    if (!q) return true
    return [m.name, m.family, m.architecture].some((v) => v.toLowerCase().includes(q))
  })
}

export interface FitRow {
  key: string
  label: string
  gpuCount: number
  totalGb: number
  usableGb: number
  fits: boolean
  /** Fraction of usable memory left (negative when it does not fit). */
  headroom: number
  /** GB short of usable memory when it does not fit; 0 when it fits. */
  shortfallGb: number
  /** Theoretical decode ceiling in tokens/s per stream (memory-bandwidth bound; not a benchmark). */
  ceilingTps: number
}

export interface FitEstimate {
  memory: Memory
  usableFraction: number
  rows: FitRow[]
  /** Configuration with the least total VRAM that still fits (not the cheapest, not an availability claim). */
  smallestFit: FitRow | null
  note: string
}

export function estimateFit(s: Scenario): FitEstimate {
  const { memory, candidates, note } = recommend({ ...s, priority: 'speed', budget: BUDGET_MAX, minTps: 0 })
  const rows = candidates
    .map((c): FitRow => {
      const fits = c.state === 'fits' || c.state === 'recommended'
      const usable = c.usable
      return {
        key: c.key,
        label: c.label,
        gpuCount: c.count,
        totalGb: c.total,
        usableGb: usable,
        fits,
        headroom: c.headroom,
        shortfallGb: fits ? 0 : Math.max(0, memory.need - usable),
        ceilingTps: c.ceiling,
      }
    })
    .sort((a, b) => a.totalGb - b.totalGb || a.gpuCount - b.gpuCount)
  const smallestFit = rows.find((r) => r.fits) ?? null
  return { memory, usableFraction: UTIL, rows, smallestFit, note: smallestFit ? '' : note }
}

/** Memory a model needs under a scenario (weights + KV cache + runtime overhead). */
export function memoryFor(modelId: string, s: Omit<Scenario, 'modelId'>): Memory {
  return estimateMemory({ modelId, ...s })
}

export const formatParams = (billions: number) => `${billions % 1 === 0 ? billions.toFixed(0) : billions.toFixed(billions >= 10 ? 1 : 2).replace(/0$/, '')}B`
export const formatKib = (kib: number) => `${kib % 1 === 0 ? kib.toFixed(0) : kib.toFixed(1)} KiB`
export const formatContext = (tokens: number) => (tokens >= 1024 ? `${tokens / 1024}K` : String(tokens))
