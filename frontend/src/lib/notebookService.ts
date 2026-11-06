/**
 * notebookService.ts
 * ==================
 * Service layer connecting the Inferxe Dashboard and Notebooks module
 * to the backend Notebook Management endpoints (/api/v1/notebooks).
 *
 * Enforces:
 * - Bearer JWT authentication derived exclusively from active session.
 * - Zero user_id transmission from client.
 * - Raw token security: never persisted in localStorage.
 */

import { getSession } from './authStore'

export interface BackendNotebook {
  id: string
  user_id: string
  name: string
  gpu_profile: string
  status: 'provisioning' | 'running' | 'stopped' | 'failed' | 'terminated'
  runtime_type: string
  runtime_reference?: string | null
  selected_ssh_key_id?: string | null
  ssh_command?: string | null
  jupyter_url?: string | null
  access_token?: string | null
  is_simulated: boolean
  simulation_notice: string
  created_at: string
  updated_at: string
  last_active_at?: string | null
}

export interface NotebookCreatePayload {
  name: string
  gpu_profile?: string
  selected_ssh_key_id?: string | null
}

export interface BackendNotebookListResponse {
  success: boolean
  notebooks: BackendNotebook[]
}

export interface BackendNotebookActionResponse {
  success: boolean
  message: string
  notebook: BackendNotebook
}

const INFERENCE_API_BASE =
  (import.meta.env.VITE_INFERENCE_API_ENDPOINT as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8001'

function getAuthHeaders(): HeadersInit {
  const session = getSession()
  const token = session?.token || ''
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * Fetch all notebook instances belonging to the authenticated customer.
 * User identity is extracted by the backend strictly from the Cognito token claims.
 */
export async function fetchBackendNotebooks(): Promise<{
  ok: boolean
  notebooks?: BackendNotebook[]
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to view your notebooks.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to fetch notebooks from backend.' }
    }

    return { ok: true, notebooks: data.notebooks || [] }
  } catch (err) {
    return {
      ok: false,
      error: `Inference API server is unreachable at ${INFERENCE_API_BASE}. Please ensure the backend is running.`,
    }
  }
}

/**
 * Fetch a single notebook instance by ID.
 */
export async function getBackendNotebook(id: string): Promise<{
  ok: boolean
  notebook?: BackendNotebook
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to view notebook details.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks/${id}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Notebook not found.' }
    }

    return { ok: true, notebook: data }
  } catch (err) {
    return {
      ok: false,
      error: `Inference API server is unreachable at ${INFERENCE_API_BASE}.`,
    }
  }
}

/**
 * Create and provision a new notebook session.
 * Raw session access token is returned only in this response if generated.
 * Never persists raw token in client-side storage.
 */
export async function createBackendNotebook(payload: NotebookCreatePayload): Promise<{
  ok: boolean
  notebook?: BackendNotebook
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to create a notebook.' }
    }

    const body: Record<string, any> = {
      name: payload.name.trim() || 'Untitled Notebook',
      gpu_profile: payload.gpu_profile || 'NVIDIA L4',
    }
    if (payload.selected_ssh_key_id) {
      body.selected_ssh_key_id = payload.selected_ssh_key_id
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to create notebook instance.' }
    }

    return { ok: true, notebook: data }
  } catch (err) {
    return {
      ok: false,
      error: `Inference API server is unreachable at ${INFERENCE_API_BASE}.`,
    }
  }
}

/**
 * Start a stopped notebook instance.
 */
export async function startBackendNotebook(id: string): Promise<{
  ok: boolean
  notebook?: BackendNotebook
  message?: string
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to start a notebook.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks/${id}/start`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to start notebook.' }
    }

    return { ok: true, notebook: data.notebook, message: data.message }
  } catch (err) {
    return {
      ok: false,
      error: `Inference API server is unreachable at ${INFERENCE_API_BASE}.`,
    }
  }
}

/**
 * Stop a running notebook instance.
 */
export async function stopBackendNotebook(id: string): Promise<{
  ok: boolean
  notebook?: BackendNotebook
  message?: string
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to stop a notebook.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks/${id}/stop`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to stop notebook.' }
    }

    return { ok: true, notebook: data.notebook, message: data.message }
  } catch (err) {
    return {
      ok: false,
      error: `Inference API server is unreachable at ${INFERENCE_API_BASE}.`,
    }
  }
}

/**
 * Terminate a notebook instance permanently.
 */
export async function deleteBackendNotebook(id: string): Promise<{
  ok: boolean
  notebook?: BackendNotebook
  message?: string
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to terminate a notebook.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to terminate notebook.' }
    }

    return { ok: true, notebook: data.notebook, message: data.message }
  } catch (err) {
    return {
      ok: false,
      error: `Inference API server is unreachable at ${INFERENCE_API_BASE}.`,
    }
  }
}

