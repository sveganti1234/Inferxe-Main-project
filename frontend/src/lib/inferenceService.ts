/**
 * Inference API client (POST /api/v1/inference on the inference service, port 8001 via the Vite proxy).
 *
 * Authenticated with an Inferxe customer API key (Authorization: Bearer <key>), not the Cognito session:
 * the backend resolves the user from the key. The key is passed in per call and never stored.
 */

import { INFERENCE_API_BASE, apiErrorDetail, formatApiConnectionError } from './apiConfig'

export interface InferenceUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface InferenceResult {
  success: boolean
  provider: string
  model: string
  response: string
  usage: InferenceUsage
}

export interface RunInferenceParams {
  apiKey: string
  prompt: string
  maxTokens: number
  temperature: number
  model?: string
}

export async function runInference(params: RunInferenceParams): Promise<{
  ok: boolean
  status?: number
  data?: InferenceResult
  error?: string
  /** Seconds from Retry-After on 503 (limiter full) / 429 (upstream rate limit). */
  retryAfter?: number
  latencyMs?: number
}> {
  const apiKey = params.apiKey.trim()
  if (!apiKey) {
    return { ok: false, error: 'Enter one of your Inferxe API keys (create one under API Keys).' }
  }
  if (!params.prompt.trim()) {
    return { ok: false, error: 'Prompt cannot be empty.' }
  }

  const started = performance.now()
  try {
    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/inference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        prompt: params.prompt,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        ...(params.model ? { model: params.model } : {}),
      }),
    })
    const latencyMs = Math.round(performance.now() - started)
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      return { ok: true, status: res.status, data: data as InferenceResult, latencyMs }
    }

    const retryRaw = Number(res.headers.get('Retry-After'))
    const retryAfter = Number.isFinite(retryRaw) && retryRaw > 0 ? retryRaw : undefined
    const fallbacks: Record<number, string> = {
      401: 'This API key was rejected. Check that it is active and copied in full.',
      429: 'The model provider is rate limiting requests. Please retry shortly.',
      503: 'The inference service is at capacity or unavailable. Please retry shortly.',
      504: 'The model provider timed out. Please retry.',
    }
    const message = apiErrorDetail(data, fallbacks[res.status] || `Inference failed (HTTP ${res.status}).`)
    return {
      ok: false,
      status: res.status,
      error: retryAfter ? `${message} (retry in ${retryAfter}s)` : message,
      retryAfter,
      latencyMs,
    }
  } catch {
    return { ok: false, error: formatApiConnectionError('Inference API', INFERENCE_API_BASE) }
  }
}
