import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession } from '../../lib/authStore'
import { CONSOLE_SECTIONS, getSection } from '../../features/customer/navigation'
import {
  createStorageFolder,
  deleteStorageItem,
  fetchStorageFiles,
  getStorageFileDownloadUrl,
  uploadStorageFile,
} from '../../features/customer/data/serviceClients'
import StoragePage from '../../features/customer/pages/StoragePage'
import { SESSION, jsonResponse } from './fixtures'

vi.mock('../../lib/authStore', () => ({ ensureFreshSession: vi.fn() }))

const mockSession = vi.mocked(ensureFreshSession)
const mockFetch = vi.mocked(globalThis.fetch)

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  mockSession.mockReset()
  mockFetch.mockReset()
  mockSession.mockResolvedValue(SESSION)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  host.remove()
  vi.restoreAllMocks()
})

describe('Workspace Storage — Navigation and Contracts', () => {
  it('registers storage in CONSOLE_SECTIONS under Compute & AI', () => {
    const storageSection = CONSOLE_SECTIONS.find((s) => s.id === 'storage')
    expect(storageSection).toBeDefined()
    expect(storageSection?.label).toBe('Workspace storage')
    expect(storageSection?.path).toBe('storage')
    expect(storageSection?.group).toBe('Compute & AI')
    expect(storageSection?.availability).toBe('live')
  })

  it('getSection returns the storage section configuration', () => {
    const s = getSection('storage')
    expect(s.id).toBe('storage')
    expect(s.capabilities.length).toBeGreaterThan(0)
  })
})

describe('Workspace Storage — Service Clients', () => {
  it('fetchStorageFiles fetches items and usage without exposing userId', async () => {
    const fakeData = {
      ok: true,
      items: [
        {
          id: 'f1',
          user_id: 'u1',
          name: 'train.py',
          path: '/train.py',
          folder_path: '/',
          is_folder: false,
          size_bytes: 2048,
          mime_type: 'text/x-python',
          storage_bucket: 'workspace-files',
          storage_path: 'u1/train.py',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      folder: '/',
      usage: {
        used_bytes: 2048,
        total_bytes: 10737418240,
        available_bytes: 10737416192,
        total_files: 1,
        quota_percent: 0.01,
      },
    }

    mockFetch.mockResolvedValue(jsonResponse(200, fakeData))
    const res = await fetchStorageFiles('/', 'train')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toContain('/api/customer/storage/files')
    expect(String(url)).toContain('folder=%2F')
    expect(String(url)).toContain('search=train')
    expect(String(url)).not.toContain('u1')
    expect((init as RequestInit).headers).toHaveProperty('Authorization', `Bearer ${SESSION.token}`)
    expect(res.items.length).toBe(1)
    expect(res.usage.total_files).toBe(1)
  })

  it('createStorageFolder sends folder creation request', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(201, {
        ok: true,
        item: {
          id: 'dir_1',
          user_id: 'u1',
          name: 'models',
          path: '/models',
          folder_path: '/',
          is_folder: true,
          size_bytes: 0,
          mime_type: 'inode/directory',
          storage_bucket: 'workspace-files',
          storage_path: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    )

    const item = await createStorageFolder('/', 'models')
    expect(item.name).toBe('models')
    expect(item.is_folder).toBe(true)
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      folder_path: '/',
      name: 'models',
    })
  })

  it('uploadStorageFile posts file payload and returns created item', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(201, {
        ok: true,
        item: {
          id: 'file_2',
          user_id: 'u1',
          name: 'config.json',
          path: '/config.json',
          folder_path: '/',
          is_folder: false,
          size_bytes: 128,
          mime_type: 'application/json',
          storage_bucket: 'workspace-files',
          storage_path: 'u1/config.json',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    )

    const item = await uploadStorageFile('/', 'config.json', 'e30=', 'application/json')
    expect(item.name).toBe('config.json')
    expect(item.size_bytes).toBe(128)
  })

  it('getStorageFileDownloadUrl returns download url and deleteStorageItem deletes item', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        download_url: 'https://storage.inferxe.com/signed/file_2?token=sig',
        name: 'config.json',
      })
    )

    const dl = await getStorageFileDownloadUrl('file_2')
    expect(dl.download_url).toContain('https://storage.inferxe.com')

    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        deleted: true,
        id: 'file_2',
      })
    )

    const del = await deleteStorageItem('file_2')
    expect(del.deleted).toBe(true)
  })
})

describe('Workspace Storage — StoragePage Rendering', () => {
  it('renders storage metrics, breadcrumbs, and empty state when folder is empty', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        items: [],
        folder: '/',
        usage: {
          used_bytes: 0,
          total_bytes: 10737418240,
          available_bytes: 10737418240,
          total_files: 0,
          quota_percent: 0,
        },
      })
    )

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/dashboard/app/storage']}>
          <Routes>
            <Route path="/dashboard/app/storage" element={<StoragePage />} />
          </Routes>
        </MemoryRouter>
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(host.textContent).toContain('Workspace Storage')
    expect(host.textContent).toContain('Storage Capacity & Quota')
    expect(host.textContent).toContain('Total Capacity')
    expect(host.textContent).toContain('Storage Used')
    expect(host.textContent).toContain('Available Space')
    expect(host.textContent).toContain('Total Files')
    expect(host.textContent).toContain('This folder is empty')
    expect(host.textContent).toContain('Upload File')
    expect(host.textContent).toContain('New Folder')
  })

  it('renders files and folders table when data exists', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        items: [
          {
            id: 'd1',
            user_id: 'u1',
            name: 'checkpoints',
            path: '/checkpoints',
            folder_path: '/',
            is_folder: true,
            size_bytes: 0,
            mime_type: 'inode/directory',
            storage_bucket: 'workspace-files',
            storage_path: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'f1',
            user_id: 'u1',
            name: 'dataset.csv',
            path: '/dataset.csv',
            folder_path: '/',
            is_folder: false,
            size_bytes: 1048576,
            mime_type: 'text/csv',
            storage_bucket: 'workspace-files',
            storage_path: 'u1/dataset.csv',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        folder: '/',
        usage: {
          used_bytes: 1048576,
          total_bytes: 10737418240,
          available_bytes: 10736369664,
          total_files: 1,
          quota_percent: 0.01,
        },
      })
    )

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/dashboard/app/storage']}>
          <Routes>
            <Route path="/dashboard/app/storage" element={<StoragePage />} />
          </Routes>
        </MemoryRouter>
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(host.textContent).toContain('checkpoints')
    expect(host.textContent).toContain('dataset.csv')
    expect(host.textContent).toContain('1.00 MB')
  })
})
