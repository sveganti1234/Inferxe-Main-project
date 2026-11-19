/**
 * Client for POST /api/v1/inference (8001).
 *
 * Contract (backend/inference/schemas.py):
 *   request   { prompt: string, max_tokens?: 1..4096, temperature?: 0..2 }  (+ model, which the server ignores)
 *   response  { success, provider, model, response, usage: { prompt_tokens, completion_tokens, total_tokens } }
 *   auth      Authorization: Bearer <Inferxe customer API key>   — NOT the session token
 *
 * Safety:
 *  - The API key is a call argument only: never logged, stored, cached or put in a URL.
 *  - No model is sent: the backend currently selects the model itself.
 *  - A response is returned only when the server actually produced one. Malformed or
 *    unsuccessful answers throw — nothing is ever simulated or filled in.
 *  - Error text is built from the server's `detail`/`msg` only (never echoed `input`), with the
 *    key and token-like strings removed.
 */
import { INFERENCE_API_BASE } from '../../../lib/apiConfig'

export const PROMPT_MAX_CHARS = 8000
export const MAX_TOKENS_MIN = 1
export const MAX_TOKENS_MAX = 4096
export const MAX_TOKENS_DEFAULT = 300
export const TEMPERATURE_MIN = 0
export const TEMPERATURE_MAX = 2
export const TEMPERATURE_DEFAULT = 0.2
export const REQUEST_TIMEOUT_MS = 180_000

export type InferenceErrorKind =
  | 'invalid_key'
  | 'forbidden'
  | 'validation'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'unexpected'
  | 'cancelled'

export class InferenceError extends Error {
  readonly kind: InferenceErrorKind
  readonly status: number | null
  constructor(kind: InferenceErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'InferenceError'
    this.kind = kind
    this.status = status
  }
}

export interface InferenceResult {
  text: string
  model: string
  provider: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Round-trip time measured in this browser, in milliseconds. */
  roundTripMs: number
}

/** Client-side check of the key's shape. Returns a message, or null when it looks plausible. */
export function validateApiKeyInput(key: string): string | null {
  const value = key.trim()
  if (!value) return 'Paste one of your Inferxe API keys.'
  if (/\s/.test(value)) return 'API keys do not contain spaces or line breaks.'
  if (/^nvapi-/i.test(value)) return 'That looks like an NVIDIA key. Use an Inferxe API key — it starts with inf_.'
  if (value.length < 16) return 'That does not look like a complete API key.'
  if (value.length > 256) return 'That is too long to be an API key.'
  return null
}

export function validatePrompt(prompt: string): string | null {
  if (!prompt.trim()) return 'Write a prompt to send.'
  if (prompt.length > PROMPT_MAX_CHARS) return `Keep the prompt under ${PROMPT_MAX_CHARS.toLocaleString('en-IN')} characters.`
  return null
}

/** Remove the API key and anything token-shaped from text that may be shown to the user. */
export function scrubSecrets(text: string, apiKey: string): string {
  let out = text
  if (apiKey) out = out.split(apiKey).join('[API key]')
  return out
    .replace(/\b(?:inf|ix)_(?:live|test)_[A-Za-z0-9_-]{6,}/g, '[API key]')
    .replace(/\bnvapi-[A-Za-z0-9_-]{6,}/g, '[provider key]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[token]')
}

/** FastAPI errors: `{ detail: string }` or `{ detail: [{ msg, ... }] }`. Only messages are used. */
function detailText(body: unknown, apiKey: string): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const raw = record.detail ?? record.error ?? record.message
  let message: string | null = null
  if (typeof raw === 'string') message = raw
  else if (Array.isArray(raw)) {
    message = raw
      .map((item) => (item && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string' ? (item as { msg: string }).msg : null))
      .filter((m): m is string => Boolean(m))
      .join(' ')
  }
  const cleaned = message ? scrubSecrets(message.trim(), apiKey) : ''
  return cleaned && cleaned.length <= 240 ? cleaned : null
}

function failureFor(status: number, body: unknown, apiKey: string): InferenceError {
  const detail = detailText(body, apiKey)
  switch (status) {
    case 401:
      return new InferenceError('invalid_key', 'Your API key was rejected. It may be invalid, revoked or expired.', 401)
    case 403:
      return new InferenceError('forbidden', detail ?? 'This account is not allowed to run inference.', 403)
    case 422:
      return new InferenceError('validation', detail ?? 'The request was not accepted. Check the prompt and settings.', 422)
    case 429:
      return new InferenceError('rate_limited', detail ?? 'The model is rate limited right now. Try again shortly.', 429)
    case 504:
      return new InferenceError('timeout', detail ?? 'The model provider timed out. Try again.', 504)
    case 502:
    case 503:
      return new InferenceError('provider_unavailable', detail ?? 'The inference service is temporarily unavailable.', status)
    default:
      return new InferenceError('unexpected', detail ?? `The inference request failed (HTTP ${status}).`, status)
  }
}

const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export async function runInference(params: {
  apiKey: string
  prompt: string
  maxTokens: number
  temperature: number
  signal?: AbortSignal
}): Promise<InferenceResult> {
  const { apiKey, prompt, maxTokens, temperature, signal } = params
  const keyProblem = validateApiKeyInput(apiKey)
  if (keyProblem) throw new InferenceError('validation', keyProblem)
  const promptProblem = validatePrompt(prompt)
  if (promptProblem) throw new InferenceError('validation', promptProblem)
  if (!Number.isInteger(maxTokens) || maxTokens < MAX_TOKENS_MIN || maxTokens > MAX_TOKENS_MAX) {
    throw new InferenceError('validation', `Max tokens must be a whole number from ${MAX_TOKENS_MIN} to ${MAX_TOKENS_MAX}.`)
  }
  if (!Number.isFinite(temperature) || temperature < TEMPERATURE_MIN || temperature > TEMPERATURE_MAX) {
    throw new InferenceError('validation', `Temperature must be between ${TEMPERATURE_MIN} and ${TEMPERATURE_MAX}.`)
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  const started = performance.now()

  try {
    let response: Response
    try {
      response = await fetch(`${INFERENCE_API_BASE}/api/v1/inference`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        // `model` is intentionally not sent: the server currently chooses the model.
        body: JSON.stringify({ prompt: prompt.trim(), max_tokens: maxTokens, temperature }),
        signal: controller.signal,
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw timedOut
          ? new InferenceError('timeout', 'The request took too long and was stopped.')
          : new InferenceError('cancelled', 'The request was cancelled.')
      }
      throw new InferenceError('network', 'Unable to reach the inference service. Check your connection and try again.')
    }

    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) throw failureFor(response.status, body, apiKey)

    const data = body as Record<string, unknown> | null
    const usage = data?.usage as Record<string, unknown> | undefined
    if (
      !data ||
      data.success === false ||
      typeof data.response !== 'string' ||
      typeof data.model !== 'string' ||
      !usage ||
      !finiteNonNegative(usage.prompt_tokens) ||
      !finiteNonNegative(usage.completion_tokens) ||
      !finiteNonNegative(usage.total_tokens)
    ) {
      throw new InferenceError('invalid_response', 'The inference service returned an unexpected response, so nothing is shown.', response.status)
    }
    return {
      text: data.response,
      model: data.model,
      provider: typeof data.provider === 'string' ? data.provider : null,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      roundTripMs: Math.max(0, Math.round(performance.now() - started)),
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
