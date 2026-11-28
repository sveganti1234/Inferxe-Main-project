/**
 * Workspace Storage Management — Upload, organize, download, and delete
 * customer-isolated workspace files, datasets, model weights, and scripts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import {
  createStorageFolder,
  deleteStorageItem,
  fetchStorageFiles,
  getStorageFileDownloadUrl,
  uploadStorageFile,
} from '../data/serviceClients'
import type { StorageUsage, WorkspaceFile } from '../data/types'
import { getSection } from '../navigation'
import { Field, TextInput } from '../ui/controls'
import { ConfirmDialog, Dialog } from '../ui/Dialog'
import { Button, Card, CardHeader, Notice, PageHeader, Stat, StatusPill } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '0 B'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function getFileIcon(file: WorkspaceFile) {
  if (file.is_folder) return <Folder size={18} className="text-amber-400 shrink-0" />
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (['py', 'js', 'ts', 'jsx', 'tsx', 'sh', 'bash', 'json', 'yaml', 'yml'].includes(ext)) {
    return <FileCode size={18} className="text-cyan-400 shrink-0" />
  }
  if (['csv', 'tsv', 'parquet', 'arrow', 'xlsx'].includes(ext)) {
    return <FileSpreadsheet size={18} className="text-emerald-400 shrink-0" />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return <FileImage size={18} className="text-purple-400 shrink-0" />
  }
  if (['pt', 'bin', 'safetensors', 'onnx', 'ckpt', 'h5'].includes(ext)) {
    return <Database size={18} className="text-orange-400 shrink-0" />
  }
  return <FileText size={18} className="text-zinc-400 shrink-0" />
}

function getFileTypeLabel(file: WorkspaceFile): string {
  if (file.is_folder) return 'Folder'
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const types: Record<string, string> = {
    py: 'Python Script',
    js: 'JavaScript',
    ts: 'TypeScript',
    json: 'JSON Data',
    csv: 'CSV Dataset',
    tsv: 'TSV Dataset',
    parquet: 'Parquet Dataset',
    pt: 'PyTorch Weights',
    safetensors: 'SafeTensors Weights',
    bin: 'Binary Model',
    onnx: 'ONNX Model',
    zip: 'ZIP Archive',
    tar: 'TAR Archive',
    gz: 'GZ Archive',
    txt: 'Text Document',
    md: 'Markdown',
    pdf: 'PDF Document',
    png: 'PNG Image',
    jpg: 'JPEG Image',
  }
  return types[ext] || (file.mime_type ? file.mime_type.split('/')[1]?.toUpperCase() || 'File' : 'File')
}

export default function StoragePage() {
  const section = getSection('storage')
  usePageMeta('Workspace Storage · Inferxe', section.description)

  // Current navigation folder
  const [currentFolder, setCurrentFolder] = useState<string>('/')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Data state
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CustomerApiError | null>(null)

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  // Create folder dialog
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgressText, setUploadProgressText] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Downloading target ID
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Load files
  const loadFiles = useCallback(async (folder: string, search?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchStorageFiles(folder, search)
      setFiles(res.items)
      setUsage(res.usage)
    } catch (err) {
      if (err instanceof CustomerApiError) {
        setError(err)
      } else {
        setError(new CustomerApiError('server', 'Failed to load storage files.'))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFiles(currentFolder, searchQuery)
  }, [currentFolder, searchQuery, loadFiles])

  // Clear feedback after 5 seconds
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(timer)
  }, [feedback])

  // Breadcrumb items
  const breadcrumbs = useMemo(() => {
    const parts = currentFolder.split('/').filter(Boolean)
    const crumbs = [{ name: 'Root', path: '/' }]
    let accumulated = ''
    for (const part of parts) {
      accumulated += `/${part}`
      crumbs.push({ name: part, path: accumulated })
    }
    return crumbs
  }, [currentFolder])

  // Navigate up one folder
  const handleNavigateUp = () => {
    if (currentFolder === '/') return
    const segments = currentFolder.split('/').filter(Boolean)
    segments.pop()
    const parent = segments.length === 0 ? '/' : `/${segments.join('/')}`
    setCurrentFolder(parent)
  }

  // Create folder handler
  const handleCreateFolder = async (e: FormEvent) => {
    e.preventDefault()
    setFolderError(null)
    const name = newFolderName.trim()
    if (!name) {
      setFolderError('Folder name is required.')
      return
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      setFolderError('Folder name cannot contain slashes or relative segments.')
      return
    }

    setCreatingFolder(true)
    try {
      await createStorageFolder(currentFolder, name)
      setCreateFolderOpen(false)
      setNewFolderName('')
      setFeedback({ tone: 'success', text: `Folder "${name}" created successfully.` })
      await loadFiles(currentFolder, searchQuery)
    } catch (err) {
      setFolderError(err instanceof CustomerApiError ? err.message : 'Failed to create folder.')
    } finally {
      setCreatingFolder(false)
    }
  }

  // Upload handler
  const handleUpload = async (e: FormEvent) => {
    e.preventDefault()
    setUploadError(null)
    if (!selectedFile) {
      setUploadError('Please select a file to upload.')
      return
    }

    const maxBytes = 500 * 1024 * 1024 // 500 MB
    if (selectedFile.size > maxBytes) {
      setUploadError('File exceeds the 500 MB upload limit.')
      return
    }

    if (usage && usage.available_bytes < selectedFile.size) {
      setUploadError('Not enough available storage quota for this file.')
      return
    }

    setUploading(true)
    setUploadProgressText('Reading file into memory...')

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const base64 = result.split(',')[1] || ''
          resolve(base64)
        }
        reader.onerror = () => reject(new Error('Failed to read file contents.'))
        reader.readAsDataURL(selectedFile)
      })

      setUploadProgressText('Uploading to secure workspace storage...')
      await uploadStorageFile(
        currentFolder,
        selectedFile.name,
        base64Data,
        selectedFile.type || 'application/octet-stream'
      )

      setUploadOpen(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setFeedback({ tone: 'success', text: `File "${selectedFile.name}" uploaded successfully.` })
      await loadFiles(currentFolder, searchQuery)
    } catch (err) {
      setUploadError(err instanceof CustomerApiError ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      setUploadProgressText('')
    }
  }

  // Download handler
  const handleDownload = async (file: WorkspaceFile) => {
    if (file.is_folder) return
    setDownloadingId(file.id)
    try {
      const { download_url } = await getStorageFileDownloadUrl(file.id)
      const a = document.createElement('a')
      a.href = download_url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      setFeedback({
        tone: 'error',
        text: err instanceof CustomerApiError ? err.message : 'Failed to generate download link.',
      })
    } finally {
      setDownloadingId(null)
    }
  }

  // Delete handler
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteStorageItem(deleteTarget.id)
      setFeedback({
        tone: 'success',
        text: `${deleteTarget.is_folder ? 'Folder' : 'File'} "${deleteTarget.name}" deleted.`,
      })
      setDeleteTarget(null)
      await loadFiles(currentFolder, searchQuery)
    } catch (err) {
      setFeedback({
        tone: 'error',
        text: err instanceof CustomerApiError ? err.message : 'Failed to delete item.',
      })
    } finally {
      setDeleting(false)
    }
  }

  const quotaPercent = usage?.quota_percent ?? 0
  const progressToneClass =
    quotaPercent > 90 ? 'bg-red-500' : quotaPercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="cx-page space-y-6">
      <PageHeader
        title="Workspace Storage"
        description="Persistent cloud storage for customer datasets, model weights, code scripts, and artifacts."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setCreateFolderOpen(true)}>
              <FolderPlus size={16} />
              <span>New Folder</span>
            </Button>
            <Button variant="primary" onClick={() => setUploadOpen(true)}>
              <FileUp size={16} />
              <span>Upload File</span>
            </Button>
          </div>
        }
      />

      {feedback && (
        <Notice
          icon={feedback.tone === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          tone={feedback.tone === 'success' ? 'info' : 'warning'}
        >
          {feedback.text}
        </Notice>
      )}

      {/* Storage Capacity Overview Card */}
      <Card>
        <CardHeader
          title="Storage Capacity & Quota"
          description="Real-time capacity tracking across your customer workspace."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadFiles(currentFolder, searchQuery)}
              disabled={loading}
              title="Refresh storage"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <Stat
            icon={<HardDrive size={16} />}
            label="Total Capacity"
            value={formatBytes(usage?.total_bytes)}
            hint="Maximum allocated quota"
          />
          <Stat
            icon={<Database size={16} />}
            label="Storage Used"
            value={formatBytes(usage?.used_bytes)}
            hint={`${quotaPercent}% utilized`}
          />
          <Stat
            icon={<HardDrive size={16} />}
            label="Available Space"
            value={formatBytes(usage?.available_bytes)}
            hint="Ready for new files"
          />
          <Stat
            icon={<FileText size={16} />}
            label="Total Files"
            value={usage?.total_files ?? 0}
            hint="Excluding virtual folders"
          />
        </div>

        {/* Visual Progress Bar */}
        <div className="mt-5 pt-4 border-t border-zinc-800">
          <div className="flex justify-between items-center text-xs text-zinc-400 mb-1.5">
            <span>Storage Allocation</span>
            <span>{quotaPercent}% Used</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${progressToneClass}`}
              style={{ width: `${Math.min(100, quotaPercent)}%` }}
            />
          </div>
        </div>
      </Card>

      {/* Navigation Toolbar & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800">
        {/* Breadcrumb Path Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-sm text-zinc-300 py-1">
          {currentFolder !== '/' && (
            <button
              type="button"
              onClick={handleNavigateUp}
              className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors mr-1"
              title="Go up one folder"
            >
              <ArrowLeft size={16} />
            </button>
          )}

          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.path} className="flex items-center gap-1.5 shrink-0">
              {idx > 0 && <ChevronRight size={14} className="text-zinc-600" />}
              <button
                type="button"
                onClick={() => {
                  setCurrentFolder(crumb.path)
                  setSearchQuery('')
                }}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  idx === breadcrumbs.length - 1
                    ? 'bg-zinc-800 text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                }`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Files & Folders Table Card */}
      <Card flush>
        {loading ? (
          <div className="p-8">
            <LoadingBlock label="Loading workspace files..." />
          </div>
        ) : error ? (
          <div className="p-8">
            <ErrorState
              error={error}
              what="workspace storage"
              onRetry={() => void loadFiles(currentFolder, searchQuery)}
            />
          </div>
        ) : files.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<Folder size={32} className="text-zinc-500" />}
              title={searchQuery ? 'No matching files found' : 'This folder is empty'}
              body={
                searchQuery
                  ? `No files or folders matched "${searchQuery}".`
                  : 'Upload datasets, scripts, or create subfolders to get started.'
              }
              actions={
                searchQuery ? (
                  <Button variant="secondary" onClick={() => setSearchQuery('')}>
                    Clear search
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setCreateFolderOpen(true)}>
                      <FolderPlus size={16} /> New Folder
                    </Button>
                    <Button variant="primary" onClick={() => setUploadOpen(true)}>
                      <FileUp size={16} /> Upload File
                    </Button>
                  </div>
                )
              }
            />
          </div>
        ) : (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th className="w-1/2">Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Last Modified</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className={file.is_folder ? 'cursor-pointer hover:bg-zinc-800/40' : ''}
                    onClick={() => {
                      if (file.is_folder) {
                        setCurrentFolder(file.path)
                        setSearchQuery('')
                      }
                    }}
                  >
                    <td>
                      <div className="flex items-center gap-2.5 font-medium text-white">
                        {getFileIcon(file)}
                        <span className="truncate max-w-[280px] sm:max-w-md">{file.name}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill tone={file.is_folder ? 'info' : 'neutral'}>
                        {getFileTypeLabel(file)}
                      </StatusPill>
                    </td>
                    <td className="is-num text-zinc-400">
                      {file.is_folder ? '—' : formatBytes(file.size_bytes)}
                    </td>
                    <td className="text-zinc-400 text-xs">
                      {formatDate(file.updated_at || file.created_at)}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {!file.is_folder && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDownload(file)}
                            disabled={downloadingId === file.id}
                            title="Download file"
                          >
                            {downloadingId === file.id ? (
                              <Loader2 size={14} className="animate-spin text-cyan-400" />
                            ) : (
                              <Download size={14} />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(file)}
                          className="hover:text-red-400"
                          title={`Delete ${file.is_folder ? 'folder' : 'file'}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Folder Dialog */}
      <Dialog
        open={createFolderOpen}
        onClose={() => setCreateFolderOpen(false)}
        title="Create New Folder"
        description={`Creates a subfolder in ${currentFolder}`}
      >
        <form onSubmit={handleCreateFolder} className="space-y-4">
          <Field label="Folder Name" error={folderError || undefined}>
            {({ inputId, invalid }) => (
              <TextInput
                id={inputId}
                aria-invalid={invalid}
                value={newFolderName}
                onChange={(e) => {
                  setNewFolderName(e.target.value)
                  setFolderError(null)
                }}
                placeholder="e.g. datasets, weights, scripts"
                autoFocus
              />
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateFolderOpen(false)} disabled={creatingFolder}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={creatingFolder}>
              {creatingFolder ? 'Creating...' : 'Create Folder'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Upload File Dialog */}
      <Dialog
        open={uploadOpen}
        onClose={() => !uploading && setUploadOpen(false)}
        title="Upload Workspace File"
        description={`Destination: ${currentFolder}`}
      >
        <form onSubmit={handleUpload} className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg p-6 text-center cursor-pointer transition-colors bg-zinc-900/40"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setSelectedFile(e.target.files[0])
                  setUploadError(null)
                }
              }}
            />
            <FileUp size={32} className="mx-auto text-zinc-400 mb-2" />
            <p className="text-sm font-medium text-white">
              {selectedFile ? selectedFile.name : 'Click to select a file'}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {selectedFile ? `${formatBytes(selectedFile.size)}` : 'Max 500 MB per file'}
            </p>
          </div>

          {uploadError && (
            <Notice icon={<AlertCircle size={16} />} tone="warning">
              {uploadError}
            </Notice>
          )}

          {uploadProgressText && (
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium">
              <Loader2 size={14} className="animate-spin" />
              <span>{uploadProgressText}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={uploading || !selectedFile}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title={`Delete ${deleteTarget?.is_folder ? 'Folder' : 'File'}`}
        confirmLabel="Delete Permanently"
        danger
        busy={deleting}
        description={
          deleteTarget?.is_folder
            ? `Are you sure you want to delete folder "${deleteTarget?.name}"? All files and nested subfolders inside it will be permanently removed.`
            : `Are you sure you want to delete file "${deleteTarget?.name}"? This action cannot be undone.`
        }
      />
    </div>
  )
}
