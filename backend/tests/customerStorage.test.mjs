// @ts-nocheck
import './support/networkGuard.mjs' // test isolation guard: must stay the first import
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleCustomerApi } from '../api/supabaseApi.js'

function createFakeSupabase(initialStore = {}) {
  const store = {
    customer_workspace_files: initialStore.customer_workspace_files ? [...initialStore.customer_workspace_files] : [],
    profiles: initialStore.profiles ? [...initialStore.profiles] : [],
    organization_members: initialStore.organization_members ? [...initialStore.organization_members] : [],
  }

  const storageObjects = initialStore.storageObjects ? { ...initialStore.storageObjects } : {}

  function from(table) {
    if (!store[table]) store[table] = []

    return {
      select(cols = '*', options = {}) {
        let filters = []
        let orFilter = null
        let orderFields = []

        const queryObj = {
          eq(field, val) {
            filters.push({ field, val })
            return queryObj
          },
          ilike(field, pattern) {
            filters.push({ field, pattern, isIlike: true })
            return queryObj
          },
          or(clause) {
            orFilter = clause
            return queryObj
          },
          order(field, opts) {
            orderFields.push({ field, opts })
            return queryObj
          },
          single() {
            return queryObj.then((res) => {
              if (res.data && res.data.length > 0) return { data: res.data[0], error: null }
              return { data: null, error: { message: 'Row not found' } }
            })
          },
          maybeSingle() {
            return queryObj.then((res) => {
              if (res.data && res.data.length > 0) return { data: res.data[0], error: null }
              return { data: null, error: null }
            })
          },
          then(resolve, reject) {
            try {
              let rows = store[table].filter((row) => {
                for (const f of filters) {
                  if (f.isIlike) {
                    const str = String(row[f.field] || '').toLowerCase()
                    const cleanPattern = f.pattern.replace(/%/g, '').toLowerCase()
                    if (!str.includes(cleanPattern)) return false
                  } else {
                    if (row[f.field] !== f.val) return false
                  }
                }
                if (orFilter) {
                  const parts = orFilter.split(',')
                  let matched = false
                  for (const part of parts) {
                    if (part.includes('.eq.')) {
                      const [col, val] = part.split('.eq.')
                      if (row[col] === val) matched = true
                    } else if (part.includes('.like.')) {
                      const [col, val] = part.split('.like.')
                      const prefix = val.replace('%', '')
                      if (String(row[col] || '').startsWith(prefix)) matched = true
                    }
                  }
                  if (!matched) return false
                }
                return true
              })
              for (const o of orderFields) {
                rows.sort((a, b) => {
                  if (a[o.field] < b[o.field]) return o.opts?.ascending === false ? 1 : -1
                  if (a[o.field] > b[o.field]) return o.opts?.ascending === false ? -1 : 1
                  return 0
                })
              }
              return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject)
            } catch (err) {
              reject(err)
            }
          },
        }
        return queryObj
      },
      insert(rows) {
        const rowList = Array.isArray(rows) ? rows : [rows]
        const inserted = rowList.map((r) => ({
          id: r.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...r,
        }))
        store[table].push(...inserted)

        return {
          select() {
            return {
              single() {
                return Promise.resolve({ data: inserted[0], error: null })
              },
              then(resolve) {
                resolve({ data: inserted, error: null })
              },
            }
          },
          then(resolve) {
            resolve({ data: inserted, error: null })
          },
        }
      },
      upsert(row, opts = {}) {
        const existingIdx = store[table].findIndex(
          (r) => r.user_id === row.user_id && r.folder_path === row.folder_path && r.name === row.name
        )
        let record
        if (existingIdx >= 0) {
          record = { ...store[table][existingIdx], ...row, updated_at: new Date().toISOString() }
          store[table][existingIdx] = record
        } else {
          record = {
            id: row.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...row,
          }
          store[table].push(record)
        }

        return {
          select() {
            return {
              single() {
                return Promise.resolve({ data: record, error: null })
              },
            }
          },
        }
      },
      delete() {
        let filters = []
        let inFilter = null
        const delObj = {
          eq(field, val) {
            filters.push({ field, val })
            return delObj
          },
          in(field, vals) {
            inFilter = { field, vals }
            return delObj
          },
          then(resolve) {
            store[table] = store[table].filter((row) => {
              for (const f of filters) {
                if (row[f.field] !== f.val) return true
              }
              if (inFilter) {
                if (inFilter.vals.includes(row[inFilter.field])) return false
              }
              return false
            })
            resolve({ data: null, error: null })
          },
        }
        return delObj
      },
    }
  }

  const storage = {
    from(bucket) {
      return {
        async upload(path, buffer, opts) {
          storageObjects[`${bucket}:${path}`] = buffer
          return { data: { path }, error: null }
        },
        async createSignedUrl(path, expiresIn, opts) {
          return {
            data: { signedUrl: `https://storage.inferxe.com/signed/${bucket}/${path}?token=sig_test_123` },
            error: null,
          }
        },
        async createSignedUploadUrl(path) {
          return {
            data: { signedUrl: `https://storage.inferxe.com/upload/${bucket}/${path}?token=up_test_123`, path },
            error: null,
          }
        },
        async remove(paths) {
          for (const p of paths) {
            delete storageObjects[`${bucket}:${p}`]
          }
          return { data: paths, error: null }
        },
      }
    },
  }

  return { from, storage, _store: store, _storageObjects: storageObjects }
}

function createHttpMock({ method = 'GET', url = '/', body = null, headers = {} } = {}) {
  const req = {
    method,
    url,
    headers: {
      authorization: 'Bearer fake-jwt-token',
      ...headers,
    },
    [Symbol.asyncIterator]: async function* () {
      if (body) {
        yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      }
    },
  }

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(chunk) {
      if (chunk) {
        try {
          this.body = JSON.parse(chunk.toString())
        } catch {
          this.body = chunk.toString()
        }
      }
    },
  }

  return { req, res }
}

test('Customer Storage — GET /api/customer/storage/files returns empty listing and full 10 GB quota', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust_alpha', role: 'customer', status: 'active', organization_id: 'org_1' }],
  })

  const { req, res } = createHttpMock({
    method: 'GET',
    url: '/api/customer/storage/files?folder=/',
  })

  await handleCustomerApi(req, res, '/api/customer/storage/files', {
    authenticate: async () => ({ sub: 'cust_alpha', email: 'alpha@test.com' }),
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.items, [])
  assert.equal(res.body.folder, '/')
  assert.equal(res.body.usage.used_bytes, 0)
  assert.equal(res.body.usage.total_bytes, 10737418240)
  assert.equal(res.body.usage.available_bytes, 10737418240)
  assert.equal(res.body.usage.total_files, 0)
})

test('Customer Storage — POST /api/customer/storage/folders creates folder and prevents traversal and duplicates', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust_alpha', role: 'customer', status: 'active', organization_id: 'org_1' }],
  })

  // 1. Success folder creation
  const mock1 = createHttpMock({
    method: 'POST',
    url: '/api/customer/storage/folders',
    body: { folder_path: '/', name: 'datasets' },
  })
  await handleCustomerApi(mock1.req, mock1.res, '/api/customer/storage/folders', {
    authenticate: async () => ({ sub: 'cust_alpha' }),
    supabase: fakeSupabase,
  })
  assert.equal(mock1.res.statusCode, 201)
  assert.equal(mock1.res.body.ok, true)
  assert.equal(mock1.res.body.item.name, 'datasets')
  assert.equal(mock1.res.body.item.is_folder, true)
  assert.equal(mock1.res.body.item.path, '/datasets')

  // 2. Prevent duplicate folder (409)
  const mockDup = createHttpMock({
    method: 'POST',
    url: '/api/customer/storage/folders',
    body: { folder_path: '/', name: 'datasets' },
  })
  await handleCustomerApi(mockDup.req, mockDup.res, '/api/customer/storage/folders', {
    authenticate: async () => ({ sub: 'cust_alpha' }),
    supabase: fakeSupabase,
  })
  assert.equal(mockDup.res.statusCode, 409)

  // 3. Prevent path traversal in folder name (400)
  const mockTraversal = createHttpMock({
    method: 'POST',
    url: '/api/customer/storage/folders',
    body: { folder_path: '/', name: '../secret' },
  })
  await handleCustomerApi(mockTraversal.req, mockTraversal.res, '/api/customer/storage/folders', {
    authenticate: async () => ({ sub: 'cust_alpha' }),
    supabase: fakeSupabase,
  })
  assert.equal(mockTraversal.res.statusCode, 400)
})

test('Customer Storage — POST /api/customer/storage/upload uploads file and calculates usage', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust_alpha', role: 'customer', status: 'active', organization_id: 'org_1' }],
  })

  const fileContent = 'import torch\nprint("Model loaded")'
  const base64Content = Buffer.from(fileContent).toString('base64')

  const mockUpload = createHttpMock({
    method: 'POST',
    url: '/api/customer/storage/upload',
    body: {
      folder_path: '/datasets',
      name: 'train.py',
      content_base64: base64Content,
      mime_type: 'text/x-python',
    },
  })

  await handleCustomerApi(mockUpload.req, mockUpload.res, '/api/customer/storage/upload', {
    authenticate: async () => ({ sub: 'cust_alpha' }),
    supabase: fakeSupabase,
  })

  assert.equal(mockUpload.res.statusCode, 201)
  assert.equal(mockUpload.res.body.ok, true)
  assert.equal(mockUpload.res.body.item.name, 'train.py')
  assert.equal(mockUpload.res.body.item.folder_path, '/datasets')
  assert.equal(mockUpload.res.body.item.is_folder, false)
  assert.equal(mockUpload.res.body.item.size_bytes, Buffer.from(fileContent).length)
  assert.equal(mockUpload.res.body.item.storage_path, 'cust_alpha/datasets/train.py')

  // Verify file was saved in mock storage object
  assert(fakeSupabase._storageObjects['workspace-files:cust_alpha/datasets/train.py'])

  // Verify list & usage reflects the new file
  const mockList = createHttpMock({
    method: 'GET',
    url: '/api/customer/storage/files?folder=/datasets',
  })
  await handleCustomerApi(mockList.req, mockList.res, '/api/customer/storage/files', {
    authenticate: async () => ({ sub: 'cust_alpha' }),
    supabase: fakeSupabase,
  })
  assert.equal(mockList.res.statusCode, 200)
  assert.equal(mockList.res.body.items.length, 1)
  assert.equal(mockList.res.body.items[0].name, 'train.py')
  assert.equal(mockList.res.body.usage.used_bytes, Buffer.from(fileContent).length)
  assert.equal(mockList.res.body.usage.total_files, 1)
})

test('Customer Storage — Rejects uploads with invalid path or traversal', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust_alpha', role: 'customer', status: 'active', organization_id: 'org_1' }],
  })

  const mockInvalidName = createHttpMock({
    method: 'POST',
    url: '/api/customer/storage/upload',
    body: { folder_path: '/', name: 'sub/file.py', content: 'abc' },
  })
  await handleCustomerApi(mockInvalidName.req, mockInvalidName.res, '/api/customer/storage/upload', {
    authenticate: async () => ({ sub: 'cust_alpha' }),
    supabase: fakeSupabase,
  })
  assert.equal(mockInvalidName.res.statusCode, 400)
})

test('Customer Storage — Strict Customer Isolation: Customer B cannot access or download Customer A files', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [
      { user_id: 'cust_alpha', role: 'customer', status: 'active', organization_id: 'org_1' },
      { user_id: 'cust_bravo', role: 'customer', status: 'active', organization_id: 'org_2' },
    ],
    customer_workspace_files: [
      {
        id: 'file_alpha_secret_123',
        user_id: 'cust_alpha',
        name: 'secret_keys.json',
        path: '/secret_keys.json',
        folder_path: '/',
        is_folder: false,
        size_bytes: 1024,
        storage_bucket: 'workspace-files',
        storage_path: 'cust_alpha/secret_keys.json',
      },
    ],
  })

  // 1. Customer Bravo lists files -> Customer Alpha's secret file is NOT visible
  const mockBravoList = createHttpMock({
    method: 'GET',
    url: '/api/customer/storage/files?folder=/',
  })
  await handleCustomerApi(mockBravoList.req, mockBravoList.res, '/api/customer/storage/files', {
    authenticate: async () => ({ sub: 'cust_bravo' }),
    supabase: fakeSupabase,
  })
  assert.equal(mockBravoList.res.statusCode, 200)
  assert.equal(mockBravoList.res.body.items.length, 0)
  assert.equal(mockBravoList.res.body.usage.used_bytes, 0)

  // 2. Customer Bravo attempts to download Alpha's file by ID -> 404 forbidden/not found
  const mockBravoDownload = createHttpMock({
    method: 'GET',
    url: '/api/customer/storage/files/file_alpha_secret_123/download',
  })
  await handleCustomerApi(
    mockBravoDownload.req,
    mockBravoDownload.res,
    '/api/customer/storage/files/file_alpha_secret_123/download',
    {
      authenticate: async () => ({ sub: 'cust_bravo' }),
      supabase: fakeSupabase,
    }
  )
  assert.equal(mockBravoDownload.res.statusCode, 404)
  assert.equal(mockBravoDownload.res.body.ok, false)

  // 3. Customer Bravo attempts to delete Alpha's file -> 404
  const mockBravoDelete = createHttpMock({
    method: 'DELETE',
    url: '/api/customer/storage/files/file_alpha_secret_123',
  })
  await handleCustomerApi(
    mockBravoDelete.req,
    mockBravoDelete.res,
    '/api/customer/storage/files/file_alpha_secret_123',
    {
      authenticate: async () => ({ sub: 'cust_bravo' }),
      supabase: fakeSupabase,
    }
  )
  assert.equal(mockBravoDelete.res.statusCode, 404)

  // 4. Customer Alpha (owner) can generate signed download URL
  const mockAlphaDownload = createHttpMock({
    method: 'GET',
    url: '/api/customer/storage/files/file_alpha_secret_123/download',
  })
  await handleCustomerApi(
    mockAlphaDownload.req,
    mockAlphaDownload.res,
    '/api/customer/storage/files/file_alpha_secret_123/download',
    {
      authenticate: async () => ({ sub: 'cust_alpha' }),
      supabase: fakeSupabase,
    }
  )
  assert.equal(mockAlphaDownload.res.statusCode, 200)
  assert.equal(mockAlphaDownload.res.body.ok, true)
  assert(mockAlphaDownload.res.body.download_url.includes('cust_alpha/secret_keys.json'))

  // 5. Customer Alpha deletes own file -> 200
  const mockAlphaDelete = createHttpMock({
    method: 'DELETE',
    url: '/api/customer/storage/files/file_alpha_secret_123',
  })
  await handleCustomerApi(
    mockAlphaDelete.req,
    mockAlphaDelete.res,
    '/api/customer/storage/files/file_alpha_secret_123',
    {
      authenticate: async () => ({ sub: 'cust_alpha' }),
      supabase: fakeSupabase,
    }
  )
  assert.equal(mockAlphaDelete.res.statusCode, 200)
  assert.equal(mockAlphaDelete.res.body.deleted, true)
})
