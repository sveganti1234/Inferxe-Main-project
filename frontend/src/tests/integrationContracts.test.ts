import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiErrorDetail } from '../lib/apiConfig'
import { createBackendNotebook, getBackendNotebook } from '../lib/notebookService'
import { createBackendApiKey } from '../lib/apiKeyService'
import { getSession } from '../lib/authStore'

vi.mock('../lib/authStore', () => ({
  getSession: vi.fn(),
  // services refresh the session first (upstream bd3824a); return the same mocked session.
  ensureFreshSession: vi.fn(async () => (await import('../lib/authStore')).getSession()),
  decodeJwt: vi.fn(() => ({ iss: 'https://cognito-idp.ap-south-1.amazonaws.com/pool', token_use: 'id', exp: 9999999999 })),
}))

const mockGetSession = vi.mocked(getSession)
const mockFetch = vi.mocked(globalThis.fetch)
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInRva2VuX3VzZSI6ImlkIn0.sig'

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockReturnValue({
    token: JWT,
    user: { id: 'user-123', fullName: 'T', email: 't@example.test', username: 't', role: 'customer' },
    expiresAt: Date.now() + 3600000,
  })
})

describe('apiErrorDetail', () => {
  it('returns string detail as-is', () => {
    expect(apiErrorDetail({ detail: 'Invalid key' }, 'fallback')).toBe('Invalid key')
  })
  it('joins FastAPI 422 validation messages instead of returning the raw array', () => {
    const body = { detail: [{ loc: ['body', 'name'], msg: 'String should have at most 100 characters', type: 'string_too_long' }] }
    expect(apiErrorDetail(body, 'fallback')).toBe('String should have at most 100 characters')
  })
  it('falls back for empty or missing detail', () => {
    expect(apiErrorDetail({}, 'fallback')).toBe('fallback')
    expect(apiErrorDetail(null, 'fallback')).toBe('fallback')
    expect(apiErrorDetail({ detail: [] }, 'fallback')).toBe('fallback')
  })
})

// backend/inference/routes.py: POST /notebooks and GET /notebooks/{id} use response_model=NotebookResponse,
// i.e. the notebook object itself, not {notebook: ...}.
const NOTEBOOK = { id: 'nb-1', user_id: 'user-123', name: 'NB', status: 'provisioning', access_token: 'one-time-token' }

describe('notebook response contract', () => {
  it('createBackendNotebook returns the created notebook (bare NotebookResponse) with its one-time token', async () => {
    respond(201, NOTEBOOK)
    const r = await createBackendNotebook({ name: 'NB', gpu_profile: 'NVIDIA L4' })
    expect(r.ok).toBe(true)
    expect(r.notebook?.id).toBe('nb-1')
    expect(r.notebook?.access_token).toBe('one-time-token')
  })
  it('getBackendNotebook returns the notebook (bare NotebookResponse)', async () => {
    respond(200, NOTEBOOK)
    const r = await getBackendNotebook('nb-1')
    expect(r.ok).toBe(true)
    expect(r.notebook?.id).toBe('nb-1')
  })
})

describe('422 errors surface a readable message', () => {
  it('createBackendApiKey with an over-long name reports the validation message', async () => {
    respond(422, { detail: [{ loc: ['body', 'name'], msg: 'String should have at most 100 characters', type: 'string_too_long' }] })
    const r = await createBackendApiKey('x'.repeat(101))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('String should have at most 100 characters')
  })
})
