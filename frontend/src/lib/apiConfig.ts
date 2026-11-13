/**
 * Centralized Frontend API Endpoint & Auth Header Configuration
 * ==============================================================
 * Routes all frontend requests through same-origin relative URLs by default
 * so Vite's local proxy handles local backend ports cleanly on every developer laptop
 * without editing source code or hardcoding localhost ports.
 */

import { getSession } from './authStore'

function cleanBaseUrl(raw?: string): string {
  return (raw || '').trim().replace(/\/$/, '')
}

/** Base URL for FastAPI Inference, API Keys, SSH Keys & Notebooks (port 8001 via Vite proxy `/api/v1`) */
export const INFERENCE_API_BASE = cleanBaseUrl(
  import.meta.env.VITE_INFERENCE_API_ENDPOINT as string | undefined,
)

/** Base URL for FastAPI Notifications, Wallet & GPU Telemetry (port 8000 via Vite proxy) */
export const NOTIFICATIONS_API_BASE = cleanBaseUrl(
  import.meta.env.VITE_NOTIFICATIONS_API_ENDPOINT as string | undefined,
)

/** Endpoint for the FastAPI RAG Chatbot pipeline (port 8000 via Vite proxy `/api/chat`) */
export const RAG_CHAT_ENDPOINT =
  cleanBaseUrl(import.meta.env.VITE_RAG_API_ENDPOINT as string | undefined) || '/api/chat'

/** Direct local Ollama fallback endpoint when FastAPI RAG backend is unavailable */
export const OLLAMA_CHAT_ENDPOINT =
  cleanBaseUrl(import.meta.env.VITE_OLLAMA_ENDPOINT as string | undefined) ||
  'http://127.0.0.1:11434/api/chat'

/** Return true if a bearer token looks like a 3-segment JWT. */
export function hasJwtToken(token?: string | null): boolean {
  const candidate = (token ?? getSession()?.token ?? '').trim()
  if (!candidate) return false
  const parts = candidate.split('.')
  return parts.length === 3 && parts.every((segment) => segment.length > 0)
}

/** Build JSON + Bearer Authorization headers from the active session. */
export function getAuthHeaders(): HeadersInit {
  const token = getSession()?.token?.trim() || ''
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** Consistent network error message when the local backend is offline. */
export function formatApiConnectionError(serviceLabel: string, baseUrl: string): string {
  if (baseUrl) {
    return `${serviceLabel} is unreachable at ${baseUrl}. Please ensure the backend is running (\`npm run dev:backend\`).`
  }
  return `${serviceLabel} is unreachable. Please ensure the backend is running (\`npm run dev:backend\`).`
}
