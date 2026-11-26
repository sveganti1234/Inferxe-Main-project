/**
 * The workspace carries only the last 90 days of inference requests plus a server-side all-time count;
 * the console must use that count wherever it means "all requests ever".
 */
import { describe, expect, it } from 'vitest'
import { normaliseWorkspace } from '../../features/customer/data/workspaceClient'
import { selectUsageReport } from '../../features/customer/data/usage'
import { isWorkspaceEmpty } from '../../features/customer/data/selectors'
import { emptyWorkspace } from './fixtures'

const envelope = (extra: Record<string, unknown>) => ({
  ok: true,
  workspace: { profile: { user_id: 'u1', full_name: 'U', email: 'u@example.test', username: 'u', role: 'customer', status: 'active' }, ...extra },
})

describe('all-time inference request count', () => {
  it('keeps a valid server total and ignores anything else', () => {
    expect(normaliseWorkspace(envelope({ inference_requests: [], inference_requests_total: 1234 })).inference_requests_total).toBe(1234)
    for (const bad of [-1, 'many', null, Number.NaN]) {
      expect(normaliseWorkspace(envelope({ inference_requests_total: bad })).inference_requests_total).toBeUndefined()
    }
  })

  it('reports the all-time count from the server and falls back to the rows for older backends', () => {
    const ws = emptyWorkspace()
    ws.inference_requests_total = 50000
    expect(selectUsageReport(ws, { windowDays: 7 }).allTimeRequests).toBe(50000)
    delete ws.inference_requests_total
    expect(selectUsageReport(ws, { windowDays: 7 }).allTimeRequests).toBe(0)
  })

  it('a customer whose requests are all older than 90 days is not treated as a fresh account', () => {
    const ws = emptyWorkspace()
    expect(isWorkspaceEmpty(ws)).toBe(true)
    ws.inference_requests_total = 3
    expect(isWorkspaceEmpty(ws)).toBe(false)
  })
})
