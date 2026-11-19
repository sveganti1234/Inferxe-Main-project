import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceProvider, useCustomerWorkspace } from '../../features/customer/data/WorkspaceContext'
import { CustomerApiError } from '../../features/customer/data/http'
import { emptyWorkspace } from './fixtures'

vi.mock('../../lib/authStore', () => ({ ensureFreshSession: vi.fn() }))

function Probe() {
  const { state, refresh } = useCustomerWorkspace()
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="name">{state.data?.profile.full_name ?? ''}</span>
      <span data-testid="error">{state.status === 'error' ? state.error.kind : ''}</span>
      <button onClick={refresh}>refresh</button>
    </div>
  )
}

async function mount(loader: (signal: AbortSignal) => Promise<ReturnType<typeof emptyWorkspace>>) {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <WorkspaceProvider loader={loader}>
        <Probe />
      </WorkspaceProvider>,
    )
  })
  const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)!.textContent
  return { host, root, text }
}

describe('WorkspaceProvider', () => {
  it('moves from loading to ready with the loaded workspace', async () => {
    let resolve!: (ws: ReturnType<typeof emptyWorkspace>) => void
    const { text, root } = await mount(() => new Promise((r) => { resolve = r }))
    expect(text('status')).toBe('loading')
    await act(async () => resolve(emptyWorkspace()))
    expect(text('status')).toBe('ready')
    expect(text('name')).toBe('Test Customer')
    act(() => root.unmount())
  })

  it('exposes typed errors and recovers on refresh, keeping previous data visible meanwhile', async () => {
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<ReturnType<typeof emptyWorkspace>>>()
      .mockRejectedValueOnce(new CustomerApiError('unavailable', 'down', 503))
      .mockResolvedValueOnce(emptyWorkspace())
    const { text, host, root } = await mount(loader)
    expect(text('status')).toBe('error')
    expect(text('error')).toBe('unavailable')
    await act(async () => host.querySelector('button')!.click())
    expect(text('status')).toBe('ready')
    expect(loader).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })

  it('throws a clear error when used outside the provider', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => act(() => root.render(<Probe />))).toThrow(/WorkspaceProvider/)
    spy.mockRestore()
  })
})
