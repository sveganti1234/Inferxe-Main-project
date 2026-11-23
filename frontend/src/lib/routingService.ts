/**
 * routingService.ts
 * =================
 * Client service for DPR automated placement routing, catalogue queries,
 * and notebook container logs.
 */

import type { Workload } from './calc'

export interface BackendMemoryBreakdown {
  weights_gb: number
  kv_cache_gb: number
  overhead_gb: number
  total_needed_gb: number
}

export interface BackendCandidate {
  key: string
  label: string
  gpu_id: string
  count: number
  total_vram_gb: number
  usable_vram_gb: number
  rate_inr_hr: number
  rate_usd_hr: number
  decode_tps_ceiling: number
  state: string
  headroom_pct: number
  score: number
}

export interface BackendRoutingRecommendation {
  success: boolean
  workload: Record<string, unknown>
  memory_breakdown: BackendMemoryBreakdown
  recommended_placement: BackendCandidate | null
  candidates: BackendCandidate[]
  note: string
}

export interface NotebookLogEntry {
  timestamp: string
  level: string
  source?: string
  message: string
}

export interface NotebookLogsResult {
  success: boolean
  notebook_id: string
  name: string
  status: string
  logs: NotebookLogEntry[]
  is_simulated: boolean
}

export async function fetchBackendPlacementRecommendation(
  workload: Workload,
): Promise<BackendRoutingRecommendation | null> {
  try {
    const res = await fetch('/api/v1/routing/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: workload.modelId,
        quantization: workload.quant,
        context_tokens: workload.context,
        concurrency: workload.concurrency,
        priority: workload.priority,
        budget_inr_hr: workload.budget >= 1200 ? null : workload.budget,
        min_tokens_per_sec: workload.minTps,
      }),
    })
    if (!res.ok) return null
    return (await res.json()) as BackendRoutingRecommendation
  } catch {
    return null
  }
}

export async function fetchNotebookLogs(
  notebookId: string,
  token?: string,
): Promise<NotebookLogsResult | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`/api/v1/notebooks/${notebookId}/logs`, { headers })
    if (!res.ok) return null
    return (await res.json()) as NotebookLogsResult
  } catch {
    return null
  }
}
