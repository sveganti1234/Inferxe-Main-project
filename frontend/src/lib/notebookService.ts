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

import { ensureFreshSession } from './authStore'
import {
  INFERENCE_API_BASE,
  formatApiConnectionError,
  apiErrorDetail,
  getAuthHeaders,
} from './apiConfig'

export interface BackendNotebook {
  id: string
  user_id: string
  name: string
  gpu_profile: string
  status: 'starting' | 'provisioning' | 'running' | 'stopped' | 'failed' | 'terminated'
  runtime_type: string
  runtime_reference?: string | null
  selected_ssh_key_id?: string | null
  /** Set for GPU-backed notebooks; absent/null for simulated records. */
  deployment_id?: string | null
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
  /** GPU id from /api/v1/gpu/offerings. Omit for a simulated record. */
  gpu_id?: string
  /** Required with gpu_id: retries with the same key never launch a second GPU. */
  idempotency_key?: string
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
    const session = await ensureFreshSession()
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
      return { ok: false, error: apiErrorDetail(data, 'Failed to fetch notebooks from backend.') }
    }

    return { ok: true, notebooks: data.notebooks || [] }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
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
    const session = await ensureFreshSession()
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
      return { ok: false, error: apiErrorDetail(data, 'Notebook not found.') }
    }

    // Create and get return the notebook itself; start/stop wrap it as { notebook }.
    return { ok: true, notebook: data.notebook ?? data }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
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
    const session = await ensureFreshSession()
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
    if (payload.gpu_id) {
      body.gpu_id = payload.gpu_id
      body.idempotency_key = payload.idempotency_key
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
      return { ok: false, error: apiErrorDetail(data, 'Failed to create notebook instance.') }
    }

    // Create and get return the notebook itself; start/stop wrap it as { notebook }.
    return { ok: true, notebook: data.notebook ?? data }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
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
    const session = await ensureFreshSession()
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
      return { ok: false, error: apiErrorDetail(data, 'Failed to start notebook.') }
    }

    return { ok: true, notebook: data.notebook, message: data.message }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
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
    const session = await ensureFreshSession()
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
      return { ok: false, error: apiErrorDetail(data, 'Failed to stop notebook.') }
    }

    return { ok: true, notebook: data.notebook, message: data.message }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
    }
  }
}

/**
 * Ask for a one-time link that opens a running GPU notebook's JupyterLab through the Inferxe notebook proxy.
 * The link carries a short-lived single-use ticket; it is handed straight to the browser tab and never stored.
 */
export async function openBackendNotebook(id: string): Promise<{
  ok: boolean
  url?: string
  error?: string
  unauthorized?: boolean
  notFound?: boolean
  conflict?: boolean
}> {
  try {
    const session = await ensureFreshSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to open a notebook.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/notebooks/${id}/access`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        notFound: res.status === 404,
        conflict: res.status === 409,
        error: apiErrorDetail(data, 'The notebook could not be opened.'),
      }
    }
    if (typeof data.url !== 'string' || !data.url.startsWith('http')) {
      return { ok: false, error: 'The notebook could not be opened.' }
    }
    return { ok: true, url: data.url }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
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
    const session = await ensureFreshSession()
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
      return { ok: false, error: apiErrorDetail(data, 'Failed to terminate notebook.') }
    }

    return { ok: true, notebook: data.notebook, message: data.message }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
    }
  }
}

