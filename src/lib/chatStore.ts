/**
 * chatStore.ts
 * ============
 * Role-isolated, persistent chat storage with automatic 1-day (24-hour) TTL data retention.
 * 
 * Features:
 * 1. Scope Isolation:
 *    - 'guest': Public website visitors & unauthenticated chat.
 *    - 'customer': Customer portal & workspace conversations.
 *    - 'admin': Admin console & cluster telemetry queries.
 * 2. 1-Day TTL: Messages older than 24 hours are automatically pruned.
 * 3. Zero Leakage: Admin data never touches customer/guest storage, and vice versa.
 * 4. Session Resilience: Previous role data is restored when logging back into that role.
 */

import { getSession, getPortalRole } from './authStore'
import type { SourceReference } from './llmService'

export type ChatScope = 'guest' | 'customer' | 'admin'

export interface ChatMessage {
  id: string
  sender: 'user' | 'bot'
  text: string
  time: string
  timestamp: number // Epoch timestamp in ms for 1-day TTL calculation
  sources?: SourceReference[]
}

// 1 Day Data Retention in milliseconds (24 hours = 86,400,000 ms)
export const CHAT_RETENTION_MS = 24 * 60 * 60 * 1000

export const SCOPE_STORAGE_KEYS: Record<ChatScope, string> = {
  guest: 'inferxe_chat_history_guest_v1',
  customer: 'inferxe_chat_history_customer_v1',
  admin: 'inferxe_chat_history_admin_v1',
}

export const GUEST_QUICK_PROMPTS = [
  'Tell me about this website',
  'how wallet works in this web site',
  'What are the pricing options?',
  'Which GPU for 14B model?',
  'Is data kept in India?',
]

export const CUSTOMER_QUICK_PROMPTS = [
  'how wallet works in this web site',
  'Check my wallet balance',
  'How do I deploy an LLM on Inferxe?',
  'Which GPU for 14B model?',
  'OpenAI API compatibility example',
]

export const ADMIN_QUICK_PROMPTS = [
  'how provider analysis works in this web site',
  'give me admin feratures and details',
  'Cluster GPU node telemetry status',
  'User directory and spend quotas',
  'Provider settlement margins',
]

export function getQuickPromptsForScope(scope: ChatScope): string[] {
  switch (scope) {
    case 'admin':
      return ADMIN_QUICK_PROMPTS
    case 'customer':
      return CUSTOMER_QUICK_PROMPTS
    case 'guest':
    default:
      return GUEST_QUICK_PROMPTS
  }
}

export function getInitialMessagesForScope(scope: ChatScope): ChatMessage[] {
  const now = Date.now()
  const timeStr = 'Just now'

  switch (scope) {
    case 'admin':
      return [
        {
          id: `welcome-admin-${now}`,
          sender: 'bot',
          text: "Welcome to the Inferxe Administration Console. I can assist you with cluster health, provider analysis, user management, and sovereign node telemetry.",
          time: timeStr,
          timestamp: now,
        },
      ]
    case 'customer':
      return [
        {
          id: `welcome-customer-${now}`,
          sender: 'bot',
          text: "Welcome to your Customer Workspace! I can help you with GPU deployments, sizing models, prepaid wallet top-ups, and developer API keys.",
          time: timeStr,
          timestamp: now,
        },
      ]
    case 'guest':
    default:
      return [
        {
          id: `welcome-guest-${now}`,
          sender: 'bot',
          text: "Hello! I'm your Inferxe AI Assistant. Ask me about our website, platform features, GPU sizing, pricing, or deploying sovereign LLMs in India.",
          time: timeStr,
          timestamp: now,
        },
      ]
  }
}

/**
 * Determines the active chat scope based on the current URL pathname and authentication session.
 */
export function resolveChatScope(pathname: string): ChatScope {
  const isInsideDashboard = pathname.startsWith('/dashboard')
  if (!isInsideDashboard) {
    return 'guest'
  }

  const session = getSession()
  if (!session) {
    return 'guest'
  }

  const portalRole = getPortalRole(session.user?.role)
  // Admin Portal routes or role admin
  if (
    portalRole === 'admin' ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/provider') ||
    pathname.startsWith('/dashboard/users')
  ) {
    return 'admin'
  }

  return 'customer'
}

/**
 * Loads messages for a specific scope from localStorage, automatically pruning messages older than 1 day.
 */
export function loadScopeMessages(scope: ChatScope): ChatMessage[] {
  try {
    const key = SCOPE_STORAGE_KEYS[scope]
    const raw = localStorage.getItem(key)
    if (!raw) {
      const initial = getInitialMessagesForScope(scope)
      saveScopeMessages(scope, initial)
      return initial
    }

    const parsed = JSON.parse(raw) as ChatMessage[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const initial = getInitialMessagesForScope(scope)
      saveScopeMessages(scope, initial)
      return initial
    }

    const now = Date.now()
    // 1-Day TTL Filter: Keep only messages sent within the last 24 hours
    const validMessages = parsed.filter((m) => {
      const msgTime = m.timestamp || now
      return now - msgTime < CHAT_RETENTION_MS
    })

    if (validMessages.length === 0) {
      const initial = getInitialMessagesForScope(scope)
      saveScopeMessages(scope, initial)
      return initial
    }

    // If any expired messages were dropped, update localStorage
    if (validMessages.length !== parsed.length) {
      saveScopeMessages(scope, validMessages)
    }

    return validMessages
  } catch (err) {
    console.error(`Error loading chat messages for scope ${scope}:`, err)
    return getInitialMessagesForScope(scope)
  }
}

/**
 * Saves messages for a specific scope to localStorage, ensuring 1-day TTL enforcement.
 */
export function saveScopeMessages(scope: ChatScope, messages: ChatMessage[]): void {
  try {
    const key = SCOPE_STORAGE_KEYS[scope]
    const now = Date.now()
    const sanitized = messages
      .map((m) => ({
        ...m,
        timestamp: m.timestamp || now,
      }))
      .filter((m) => now - m.timestamp < CHAT_RETENTION_MS)

    localStorage.setItem(key, JSON.stringify(sanitized))
  } catch (err) {
    console.error(`Failed to save chat messages for scope ${scope}:`, err)
  }
}

/**
 * Clears messages for ONLY the given scope, restarting with that scope's welcome message.
 */
export function clearScopeMessages(scope: ChatScope): ChatMessage[] {
  try {
    localStorage.removeItem(SCOPE_STORAGE_KEYS[scope])
  } catch {
    /* ignore */
  }
  const fresh = getInitialMessagesForScope(scope)
  saveScopeMessages(scope, fresh)
  return fresh
}
