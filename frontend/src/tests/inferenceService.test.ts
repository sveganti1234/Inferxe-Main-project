import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runInference } from '../lib/inferenceService'

const mockFetch = vi.mocked(globalThis.fetch)

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }),
  )
}

const base = { apiKey: 'inf_live_example_key', prompt: 'Hello', maxTokens: 64, temperature: 0.2 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runInference', () => {
  it('posts to /api/v1/inference with the API key as bearer and the backend field names', async () => {
    respond(200, {
      success: true,
      provider: 'nvidia',
      model: 'nvidia/default-model',
      response: 'Hi there',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    })
    const r = await runInference(base)
    expect(r.ok).toBe(true)
    expect(r.data?.response).toBe('Hi there')
    expect(r.data?.usage.total_tokens).toBe(5)

    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/v1\/inference$/)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer inf_live_example_key')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({ prompt: 'Hello', max_tokens: 64, temperature: 0.2 })  // no model: server default
  })

  it('sends model only when one is chosen', async () => {
    respond(200, { success: true, provider: 'nvidia', model: 'm', response: '', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })
    await runInference({ ...base, model: 'nvidia/other-model' })
    expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body)).model).toBe('nvidia/other-model')
  })

  it('does not call the API without a key', async () => {
    const r = await runInference({ ...base, apiKey: '   ' })
    expect(r.ok).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('401 surfaces the backend detail', async () => {
    respond(401, { detail: 'Invalid Inferxe API key.' })
    const r = await runInference(base)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Invalid Inferxe API key.')
  })

  it('503 from the concurrency limiter reports Retry-After', async () => {
    respond(503, { detail: 'Inference service at capacity. Please retry shortly.' }, { 'Retry-After': '2' })
    const r = await runInference(base)
    expect(r.ok).toBe(false)
    expect(r.retryAfter).toBe(2)
    expect(r.error).toBe('Inference service at capacity. Please retry shortly. (retry in 2s)')
  })

  it('422 validation errors are readable', async () => {
    respond(422, { detail: [{ loc: ['body', 'model'], msg: 'Unsupported model', type: 'value_error' }] })
    const r = await runInference(base)
    expect(r.error).toBe('Unsupported model')
  })

  it('network failure returns a connection message instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const r = await runInference(base)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unreachable/)
  })
})
