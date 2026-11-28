/**
 * Console adapters over the existing `lib/sshKeyService` and `lib/notebookService`
 * (8001 `/api/v1/ssh-keys` and `/api/v1/notebooks`).
 *
 * Safety by construction:
 *  - Views are built by picking explicit fields. A notebook's `ssh_command`, `jupyter_url`
 *    and one-time `access_token` are never copied into UI state — the console cannot display
 *    or store them. GPU notebooks are opened through `openNotebook`, which asks the backend for
 *    a single-use proxy link and hands it straight to the new browser tab.
 *  - The SSH public key body is not kept either; the list shows name, type and fingerprint.
 *  - No user id is ever sent: the backend derives the customer from the Cognito token.
 */
import {
  createBackendSshKey,
  deleteBackendSshKey,
  fetchBackendSshKeys,
  type BackendSshKey,
} from '../../../lib/sshKeyService'
import {
  createBackendNotebook,
  deleteBackendNotebook,
  fetchBackendNotebooks,
  getBackendNotebook,
  openBackendNotebook,
  startBackendNotebook,
  stopBackendNotebook,
  type BackendNotebook,
} from '../../../lib/notebookService'
import { CustomerApiError } from './http'

type ServiceFailure = { unauthorized?: boolean; notFound?: boolean; conflict?: boolean; error?: unknown }

function messageOf(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (Array.isArray(error)) {
    const first = error[0] as { msg?: unknown } | undefined
    if (first && typeof first.msg === 'string') return first.msg
  }
  return fallback
}

function toError(result: ServiceFailure, fallback: string): CustomerApiError {
  const message = messageOf(result.error, fallback)
  if (result.unauthorized) return new CustomerApiError('unauthenticated', message, 401)
  if (result.notFound) return new CustomerApiError('not_found', message, 404)
  if (result.conflict) return new CustomerApiError('bad_request', message, 409)
  if (/unreachable/i.test(message)) return new CustomerApiError('unavailable', message)
  return new CustomerApiError('server', message)
}

/* ── SSH keys ── */

export const SSH_KEY_NAME_MAX = 100
export const SSH_PUBLIC_KEY_MAX = 8000

export interface SshKeyView {
  id: string
  name: string
  keyType: string
  fingerprint: string
  createdAt: string | null
}

export function toSshKeyView(key: BackendSshKey): SshKeyView {
  return {
    id: key.id,
    name: key.name,
    keyType: key.key_type || 'unknown',
    fingerprint: key.fingerprint || '',
    createdAt: key.created_at ?? null,
  }
}

export async function listSshKeys(): Promise<SshKeyView[]> {
  const result = await fetchBackendSshKeys()
  if (!result.ok) throw toError(result, 'Your SSH keys could not be loaded.')
  return (result.keys ?? [])
    .map(toSshKeyView)
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
}

/** Reject private key material and malformed input before anything is sent over the network. */
export function validateSshPublicKey(publicKey: string): string | null {
  const value = publicKey.trim()
  if (!value) return 'Paste your SSH public key.'
  if (/PRIVATE KEY/i.test(value)) {
    return 'That looks like a private key. Never share it — paste the public key instead (the .pub file, for example id_ed25519.pub).'
  }
  if (value.length > SSH_PUBLIC_KEY_MAX) return 'That key is too long to be an SSH public key.'
  return null
}

export async function addSshKey(name: string, publicKey: string): Promise<SshKeyView> {
  const trimmedName = name.trim()
  if (!trimmedName || trimmedName.length > SSH_KEY_NAME_MAX) {
    throw new CustomerApiError('bad_request', `Key name must be between 1 and ${SSH_KEY_NAME_MAX} characters.`)
  }
  const keyProblem = validateSshPublicKey(publicKey)
  if (keyProblem) throw new CustomerApiError('bad_request', keyProblem)
  const result = await createBackendSshKey(trimmedName, publicKey)
  if (!result.ok || !result.data) throw toError(result, 'The SSH key could not be added.')
  return toSshKeyView(result.data)
}

export async function removeSshKey(id: string): Promise<void> {
  const result = await deleteBackendSshKey(id)
  if (!result.ok) throw toError(result, 'The SSH key could not be deleted.')
}

/* ── Notebooks (simulated records and GPU notebooks) ── */

export const NOTEBOOK_NAME_MAX = 255

export type NotebookStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'terminated' | 'unknown'

export interface NotebookView {
  id: string
  name: string
  /** The requested profile LABEL stored on the record. No GPU is allocated for it. */
  profileLabel: string
  status: NotebookStatus
  /** True unless the backend explicitly reports a non-simulated runtime. */
  simulated: boolean
  /** Backed by a real GPU deployment (status follows the instance and JupyterLab readiness). */
  gpuBacked: boolean
  sshKeyId: string | null
  createdAt: string | null
  lastActiveAt: string | null
}

function normaliseStatus(status: string | undefined): NotebookStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'starting':
    case 'provisioning':
      return 'starting'
    case 'running':
      return 'running'
    case 'stopped':
      return 'stopped'
    case 'failed':
      return 'failed'
    case 'terminated':
      return 'terminated'
    default:
      return 'unknown'
  }
}

export function toNotebookView(nb: BackendNotebook): NotebookView {
  return {
    id: nb.id,
    name: nb.name,
    profileLabel: nb.gpu_profile || '—',
    status: normaliseStatus(nb.status),
    simulated: nb.is_simulated !== false,
    gpuBacked: Boolean(nb.deployment_id),
    sshKeyId: nb.selected_ssh_key_id ?? null,
    createdAt: nb.created_at ?? null,
    lastActiveAt: nb.last_active_at ?? null,
  }
}

export async function listNotebooks(): Promise<NotebookView[]> {
  const result = await fetchBackendNotebooks()
  if (!result.ok) throw toError(result, 'Your notebooks could not be loaded.')
  // The list returns stored status; fetching a launching GPU notebook refreshes it from the instance and the
  // JupyterLab readiness check. A failed refresh keeps the listed copy.
  const notebooks = await Promise.all(
    (result.notebooks ?? []).map(async (nb) => {
      if (!nb.deployment_id || (nb.status !== 'provisioning' && nb.status !== 'starting')) return nb
      const fresh = await getBackendNotebook(nb.id)
      return fresh.ok && fresh.notebook ? fresh.notebook : nb
    }),
  )
  return notebooks
    .map(toNotebookView)
    .filter((n) => n.status !== 'terminated')
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
}

export async function createNotebook(
  name: string,
  sshKeyId: string | null,
  gpu?: { gpuId: string; idempotencyKey: string },
): Promise<NotebookView> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > NOTEBOOK_NAME_MAX) {
    throw new CustomerApiError('bad_request', `Notebook name must be between 1 and ${NOTEBOOK_NAME_MAX} characters.`)
  }
  const result = await createBackendNotebook({
    name: trimmed,
    selected_ssh_key_id: sshKeyId,
    ...(gpu ? { gpu_id: gpu.gpuId, idempotency_key: gpu.idempotencyKey } : {}),
  })
  if (!result.ok || !result.notebook) {
    throw toError(result, gpu ? 'The GPU notebook could not be launched.' : 'The notebook record could not be created.')
  }
  return toNotebookView(result.notebook)
}

/** Single-use link to the notebook's JupyterLab (through the Inferxe proxy). Never stored. */
export async function openNotebook(id: string): Promise<string> {
  const result = await openBackendNotebook(id)
  if (!result.ok || !result.url) throw toError(result, 'The notebook could not be opened.')
  return result.url
}

export type NotebookAction = 'start' | 'stop' | 'terminate'

const ACTION_PAST_TENSE: Record<NotebookAction, string> = { start: 'started', stop: 'stopped', terminate: 'terminated' }

export async function runNotebookAction(action: NotebookAction, id: string): Promise<NotebookView> {
  const call = action === 'start' ? startBackendNotebook : action === 'stop' ? stopBackendNotebook : deleteBackendNotebook
  const result = await call(id)
  if (!result.ok || !result.notebook) throw toError(result, `The notebook could not be ${ACTION_PAST_TENSE[action]}.`)
  return toNotebookView(result.notebook)
}
