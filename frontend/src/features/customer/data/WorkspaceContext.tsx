/**
 * Loads the authenticated customer's workspace once and shares it with every dashboard
 * section. Sections render their own empty/error states from this single source.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { fetchCustomerWorkspace } from './workspaceClient'
import { useAsyncResource, type ResourceState } from './useAsyncResource'
import { setCacheWorkspace } from './resourceCache'
import { getSession } from '../../../lib/authStore'
import type { CustomerWorkspace } from './types'

export interface WorkspaceContextValue {
  state: ResourceState<CustomerWorkspace>
  /** Convenience: the most recent successfully loaded workspace (may be stale while reloading). */
  workspace: CustomerWorkspace | null
  refresh: () => void
  lastUpdated: number | null
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  children,
  loader = fetchCustomerWorkspace,
}: {
  children: ReactNode
  /** Injectable for tests. */
  loader?: (signal: AbortSignal) => Promise<CustomerWorkspace>
}) {
  const { state, refresh, lastUpdated } = useAsyncResource(loader, { cacheKey: 'workspace' })
  const organizationId = state.data?.profile.organization_id ?? null
  // A different workspace (organization) must never see another workspace's cached pages.
  useEffect(() => {
    if (state.status === 'ready') setCacheWorkspace(organizationId)
  }, [state.status, organizationId])
  // Another account signed in (e.g. in another tab) while this console holds a workspace in
  // memory: start over from a clean page so the previous user's data can never be shown.
  const loadedUserId = state.data?.profile.user_id ?? null
  useEffect(() => {
    if (!loadedUserId) return
    const check = () => {
      const current = getSession()?.user?.id ?? null
      if (current && current !== loadedUserId) window.location.reload()
    }
    window.addEventListener('inferxe_auth_change', check)
    window.addEventListener('storage', check)
    return () => {
      window.removeEventListener('inferxe_auth_change', check)
      window.removeEventListener('storage', check)
    }
  }, [loadedUserId])
  const value = useMemo<WorkspaceContextValue>(
    () => ({ state, workspace: state.data, refresh, lastUpdated }),
    [state, refresh, lastUpdated],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useCustomerWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useCustomerWorkspace must be used inside <WorkspaceProvider>.')
  return ctx
}
