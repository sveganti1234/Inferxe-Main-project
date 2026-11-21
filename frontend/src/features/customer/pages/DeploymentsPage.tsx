/**
 * Deployments — Model endpoints and deployment lifecycle management.
 * Connected directly to customer workspace, Supabase records, and backend lifecycle APIs.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { MODELS } from '../../../data/gpus'
import {
  filterDeployments,
  SAMPLE_GPU_LISTINGS,
  selectBurn,
  selectDeployments,
  type DeploymentView,
} from '../data/marketplace'
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  humaniseCode,
} from '../data/selectors'
import {
  createDeployment,
  deleteDeployment,
  updateDeploymentStatus,
} from '../data/serviceClients'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection, sectionHref } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { ConfirmDialog, Dialog } from '../ui/Dialog'
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  Notice,
  PageHeader,
  Stat,
  StatusPill,
  type Column,
} from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

type StatusFilter = 'all' | 'running' | 'provisioning' | 'stopped'

export default function DeploymentsPage() {
  const section = getSection('deployments')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()

  const rows = useMemo(() => (workspace ? selectDeployments(workspace) : []), [workspace])

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Action states
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentView | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeploymentView | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)

  // Create form state
  const [formData, setFormData] = useState({
    name: '',
    modelName: 'Llama 3.1 8B Instruct',
    gpuModel: 'NVIDIA L4',
    region: 'Mumbai, IN',
    hourlyRate: 60,
  })
  const [createSubmitting, setCreateSubmitting] = useState(false)

  // Pre-fill from URL query params (e.g. from GPU Marketplace "Select & Deploy →")
  useEffect(() => {
    const modelParam = searchParams.get('model')
    const regionParam = searchParams.get('region')
    const gpuParam = searchParams.get('gpu')
    const actionParam = searchParams.get('action')

    if (modelParam || gpuParam || regionParam || actionParam === 'new') {
      const matchedGpu = gpuParam || modelParam || 'NVIDIA L4'
      const matchedListing = SAMPLE_GPU_LISTINGS.find(
        (l) => l.gpuModel.toLowerCase().includes(matchedGpu.toLowerCase()) || l.name.toLowerCase().includes(matchedGpu.toLowerCase()),
      )
      const matchedModel = MODELS.find((m) => m.name.toLowerCase().includes((modelParam || '').toLowerCase())) || MODELS[1]

      setFormData({
        name: `${matchedModel.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-endpoint`,
        modelName: matchedModel.name,
        gpuModel: matchedListing ? matchedListing.gpuModel : matchedGpu,
        region: regionParam || (matchedListing?.region ?? 'Mumbai, IN'),
        hourlyRate: matchedListing?.hourlyPrice ?? 60,
      })
      setCreateOpen(true)
    }
  }, [searchParams])

  // Clear query params when create dialog closes
  const handleCloseCreate = () => {
    setCreateOpen(false)
    if (searchParams.get('model') || searchParams.get('gpu') || searchParams.get('action')) {
      const next = new URLSearchParams(searchParams)
      next.delete('model')
      next.delete('gpu')
      next.delete('region')
      next.delete('action')
      setSearchParams(next, { replace: true })
    }
  }

  // Summary counts
  const runningCount = rows.filter((d) => (d.recordedStatus ?? '').toLowerCase() === 'running').length
  const provisioningCount = rows.filter((d) => (d.recordedStatus ?? '').toLowerCase() === 'provisioning').length
  const stoppedCount = rows.filter((d) => {
    const s = (d.recordedStatus ?? '').toLowerCase()
    return s === 'stopped' || s === 'terminated' || s === 'failed'
  }).length

  const burn = useMemo(() => selectBurn(rows, 'INR'), [rows])
  const hourlySpendLabel = burn.perHour !== null && burn.perHour > 0
    ? `${formatCurrency(burn.perHour, 'INR').replace(/\.00$/, '')}/hr`
    : '₹0/hr'

  // Filtered rows for the table
  const filteredRows = useMemo(
    () => filterDeployments(rows, searchQuery, statusFilter),
    [rows, searchQuery, statusFilter],
  )

  // Status Change handlers
  const handleStatusChange = async (id: string, newStatus: 'running' | 'stopped' | 'provisioning') => {
    setBusyId(id)
    setActionError(null)
    setActionSuccess(null)
    try {
      await updateDeploymentStatus(id, newStatus)
      setActionSuccess(`Deployment status updated to ${newStatus}.`)
      refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update deployment status.')
    } finally {
      setBusyId(null)
    }
  }

  const handleRestart = async (id: string) => {
    setBusyId(id)
    setActionError(null)
    setActionSuccess(null)
    try {
      await updateDeploymentStatus(id, 'provisioning')
      setTimeout(async () => {
        try {
          await updateDeploymentStatus(id, 'running')
          refresh()
        } catch {
          // background state transition
        }
      }, 1500)
      setActionSuccess('Restart sequence initiated.')
      refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not restart deployment.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    setActionError(null)
    setActionSuccess(null)
    try {
      await deleteDeployment(deleteTarget.id)
      setActionSuccess(`Deployment "${deleteTarget.name}" deleted.`)
      setDeleteTarget(null)
      refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete deployment.')
    } finally {
      setBusyId(null)
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      setActionError('Endpoint name cannot be empty.')
      return
    }
    setCreateSubmitting(true)
    setActionError(null)
    try {
      await createDeployment({
        name: formData.name.trim(),
        model_name: formData.modelName,
        gpu_model: formData.gpuModel,
        region: formData.region,
        hourly_rate: formData.hourlyRate,
        currency: 'INR',
      })
      setActionSuccess(`Endpoint "${formData.name.trim()}" deployment initiated.`)
      handleCloseCreate()
      refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create deployment.')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const copyToClipboard = async (textToCopy: string, label: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedText(label)
      setTimeout(() => setCopiedText(null), 2000)
    } catch {
      // ignore
    }
  }

  const columns: Column<DeploymentView>[] = [
    {
      key: 'name',
      header: 'ENDPOINT NAME',
      render: (d) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="cx-keycell__name">{d.name}</span>
          <span className="cx-mono cx-muted cx-deploy-id" title={d.id}>
            {d.id.length > 20 ? `${d.id.slice(0, 8)}…${d.id.slice(-6)}` : d.id}
          </span>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'MODEL',
      render: (d) => <span className="cx-deploy-model">{d.model ?? <span className="cx-muted">—</span>}</span>,
    },
    {
      key: 'gpu',
      header: 'GPU',
      render: (d) => <span className="cx-deploy-gpu">{d.gpu ?? <span className="cx-muted">—</span>}</span>,
    },
    {
      key: 'region',
      header: 'REGION',
      render: (d) => <span className="cx-deploy-region">{d.region ?? <span className="cx-muted">—</span>}</span>,
    },
    {
      key: 'rate',
      header: 'RATE',
      render: (d) =>
        d.hourlyRate !== null && d.currency ? (
          <span className="cx-mono cx-deploy-rate">
            {formatCurrency(d.hourlyRate, d.currency).replace(/\.00$/, '')}/hr
          </span>
        ) : (
          <span className="cx-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'STATUS',
      render: (d) => {
        const s = (d.recordedStatus ?? '').toLowerCase()
        if (s === 'running') {
          return <StatusPill tone="success" dot>Running</StatusPill>
        }
        if (s === 'provisioning') {
          return <StatusPill tone="warning" dot>Provisioning</StatusPill>
        }
        if (s === 'stopped') {
          return <StatusPill tone="neutral">Stopped</StatusPill>
        }
        if (s === 'terminated' || s === 'failed') {
          return <StatusPill tone="danger">{humaniseCode(d.recordedStatus || 'failed')}</StatusPill>
        }
        return <StatusPill tone="info">{d.recordedStatus ? humaniseCode(d.recordedStatus) : 'No status'}</StatusPill>
      },
    },
    {
      key: 'actions',
      header: <span className="cx-sr-only">Actions</span>,
      render: (d) => {
        const s = (d.recordedStatus ?? '').toLowerCase()
        const isBusy = busyId === d.id
        return (
          <div className="cx-deploy-actions">
            {s === 'running' ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleStatusChange(d.id, 'stopped')}
                  disabled={isBusy}
                  aria-label={`Stop deployment ${d.name}`}
                  title="Stop endpoint"
                >
                  <Square size={13} style={{ fill: 'currentColor' }} />
                  <span className="cx-btn-text">Stop</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleRestart(d.id)}
                  disabled={isBusy}
                  aria-label={`Restart deployment ${d.name}`}
                  title="Restart endpoint"
                >
                  <RefreshCw size={13} className={isBusy ? 'cx-spin' : undefined} />
                </Button>
              </>
            ) : s === 'stopped' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusChange(d.id, 'running')}
                disabled={isBusy}
                aria-label={`Start deployment ${d.name}`}
                title="Start endpoint"
              >
                <Play size={13} style={{ fill: 'currentColor' }} />
                <span className="cx-btn-text">Start</span>
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedDeployment(d)}
              aria-label={`View details for ${d.name}`}
              title="Deployment details"
            >
              <Eye size={13} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(d)}
              disabled={isBusy}
              aria-label={`Delete deployment ${d.name}`}
              title="Delete deployment"
              className="cx-btn--danger-ghost"
            >
              <Trash2 size={13} />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <>
      <div className="cx-deploy-context-nav">
        <Link to="/dashboard/app" className="cx-breadcrumb-link">
          <ChevronLeft size={14} /> Back to overview
        </Link>
      </div>

      <PageHeader
        title="Deployments"
        description="Manage your model endpoints and deployment lifecycle."
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              aria-label="New deployment"
            >
              <Plus size={15} style={{ marginRight: 4 }} /> New Deployment
            </Button>
            <Button
              variant="secondary"
              onClick={refresh}
              disabled={state.status === 'loading'}
              aria-label="Refresh deployments"
            >
              <RefreshCw size={15} className={state.status === 'loading' ? 'cx-spin' : undefined} />
            </Button>
          </div>
        }
      />

      {actionError ? (
        <Notice tone="danger" icon={<X size={16} />}>
          {actionError}
        </Notice>
      ) : null}

      {actionSuccess ? (
        <Notice tone="info" icon={<Check size={16} />}>
          {actionSuccess}
        </Notice>
      ) : null}

      {/* 4 Summary Stat Cards */}
      <div className="cx-stats-grid" role="list" aria-label="Deployments summary">
        <Card as="div">
          <div role="listitem">
            <Stat
              icon={<Server size={15} />}
              label="TOTAL DEPLOYMENTS"
              value={formatInteger(rows.length)}
              hint={`${formatInteger(rows.length)} configured instance${rows.length === 1 ? '' : 's'}`}
            />
          </div>
        </Card>
        <Card as="div">
          <div role="listitem">
            <Stat
              icon={<Activity size={15} />}
              label="RUNNING ENDPOINTS"
              value={formatInteger(runningCount)}
              hint={runningCount > 0 ? 'Actively serving inference' : 'No active endpoints'}
            />
          </div>
        </Card>
        <Card as="div">
          <div role="listitem">
            <Stat
              icon={<Clock size={15} />}
              label="PROVISIONING"
              value={formatInteger(provisioningCount)}
              hint={provisioningCount > 0 ? 'Allocating sovereign compute' : 'None in queue'}
            />
          </div>
        </Card>
        <Card as="div">
          <div role="listitem">
            <Stat
              icon={<Zap size={15} />}
              label="HOURLY SPEND"
              value={hourlySpendLabel}
              hint="Active deployment burn rate"
            />
          </div>
        </Card>
      </div>

      {/* Main Table Card with Toolbar */}
      <Card flush aria-labelledby="cx-deploy-title">
        <div className="cx-card__pad cx-deploy-toolbar-wrap">
          <div className="cx-deploy-toolbar-head">
            <div>
              <h2 id="cx-deploy-title" className="cx-deploy-toolbar-title">Model Deployments</h2>
              <p className="cx-deploy-toolbar-sub">
                Deploy serverless and dedicated LLM inference endpoints across sovereign clusters.
              </p>
            </div>
            <div className="cx-deploy-toolbar-actions">
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} style={{ marginRight: 4 }} /> New Deployment
              </Button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="cx-deploy-filter-bar">
            <div className="cx-deploy-search">
              <Search size={15} className="cx-deploy-search-icon" />
              <input
                type="text"
                placeholder="Search by name, model, GPU, or region…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search deployments"
                className="cx-input cx-deploy-search-input"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="cx-deploy-search-clear"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <div className="cx-deploy-status-pills" role="tablist" aria-label="Filter by status">
              <button
                type="button"
                className={`cx-deploy-pill-btn ${statusFilter === 'all' ? 'cx-deploy-pill-btn--active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All <span className="cx-deploy-pill-count">{rows.length}</span>
              </button>
              <button
                type="button"
                className={`cx-deploy-pill-btn ${statusFilter === 'running' ? 'cx-deploy-pill-btn--active' : ''}`}
                onClick={() => setStatusFilter('running')}
              >
                Running <span className="cx-deploy-pill-count">{runningCount}</span>
              </button>
              <button
                type="button"
                className={`cx-deploy-pill-btn ${statusFilter === 'provisioning' ? 'cx-deploy-pill-btn--active' : ''}`}
                onClick={() => setStatusFilter('provisioning')}
              >
                Provisioning <span className="cx-deploy-pill-count">{provisioningCount}</span>
              </button>
              <button
                type="button"
                className={`cx-deploy-pill-btn ${statusFilter === 'stopped' ? 'cx-deploy-pill-btn--active' : ''}`}
                onClick={() => setStatusFilter('stopped')}
              >
                Stopped <span className="cx-deploy-pill-count">{stoppedCount}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content States */}
        {state.status === 'error' && !workspace ? (
          <ErrorState
            error={state.error}
            onRetry={refresh}
            onSignIn={() => void signOutToLogin()}
            what="your deployment records"
            compact
          />
        ) : !workspace ? (
          <div className="cx-card__pad">
            <LoadingBlock lines={4} label="Loading deployments" />
          </div>
        ) : (
          <DataTable
            caption="Endpoint Instances"
            columns={columns}
            rows={filteredRows}
            rowKey={(d) => d.id}
            stackOnMobile
            empty={
              <EmptyState
                compact
                icon={<Rocket size={26} />}
                title={rows.length === 0 ? 'No deployment records' : 'No deployments match your filter'}
                body={
                  rows.length === 0
                    ? 'You have not deployed any model endpoints yet. Select sovereign GPU capacity from the marketplace or launch a dedicated LLM endpoint.'
                    : 'Try clearing your search query or switching status filters to view configured instances.'
                }
                actions={
                  rows.length === 0 ? (
                    <>
                      <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus size={14} style={{ marginRight: 4 }} /> New Deployment
                      </Button>
                      <ButtonLink to={sectionHref(getSection('gpus'))} variant="secondary" size="sm">
                        Browse GPU Marketplace <ExternalLink size={13} style={{ marginLeft: 4 }} />
                      </ButtonLink>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSearchQuery('')
                        setStatusFilter('all')
                      }}
                    >
                      Clear filters
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Card>

      {/* New Deployment Dialog */}
      <Dialog
        open={createOpen}
        title="Deploy New Model Endpoint"
        description="Configure and launch a dedicated sovereign LLM inference endpoint."
        onClose={handleCloseCreate}
        dismissible={!createSubmitting}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="secondary" onClick={handleCloseCreate} disabled={createSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateSubmit}
              disabled={createSubmitting || !formData.name.trim()}
            >
              {createSubmitting ? (
                <>
                  <RefreshCw size={14} className="cx-spin" style={{ marginRight: 6 }} /> Deploying…
                </>
              ) : (
                <>Deploy Endpoint →</>
              )}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreateSubmit} className="cx-deploy-form">
          <div className="cx-form-group">
            <label className="cx-label" htmlFor="cx-deploy-name">
              Endpoint Name <span className="cx-required">*</span>
            </label>
            <input
              id="cx-deploy-name"
              type="text"
              className="cx-input"
              placeholder="e.g. llama3-70b-customer-service"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              autoFocus
            />
            <span className="cx-hint">Alphanumeric identifier for your dedicated model endpoint URL.</span>
          </div>

          <div className="cx-form-group">
            <label className="cx-label" htmlFor="cx-deploy-model">
              Model Selection
            </label>
            <select
              id="cx-deploy-model"
              className="cx-input cx-select"
              value={formData.modelName}
              onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name} ({m.params}B · {m.family})
                </option>
              ))}
            </select>
          </div>

          <div className="cx-form-row">
            <div className="cx-form-group" style={{ flex: 1 }}>
              <label className="cx-label" htmlFor="cx-deploy-gpu">
                GPU Hardware
              </label>
              <select
                id="cx-deploy-gpu"
                className="cx-input cx-select"
                value={formData.gpuModel}
                onChange={(e) => {
                  const val = e.target.value
                  const listing = SAMPLE_GPU_LISTINGS.find((l) => l.gpuModel === val)
                  setFormData({
                    ...formData,
                    gpuModel: val,
                    hourlyRate: listing?.hourlyPrice ?? formData.hourlyRate,
                  })
                }}
              >
                {SAMPLE_GPU_LISTINGS.map((gpu) => (
                  <option key={gpu.id} value={gpu.gpuModel}>
                    {gpu.gpuModel} ({gpu.vram}) — ₹{gpu.hourlyPrice}/hr
                  </option>
                ))}
              </select>
            </div>

            <div className="cx-form-group" style={{ flex: 1 }}>
              <label className="cx-label" htmlFor="cx-deploy-region">
                Datacenter Region
              </label>
              <select
                id="cx-deploy-region"
                className="cx-input cx-select"
                value={formData.region}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
              >
                <option value="Mumbai, IN">Mumbai, IN (Yotta NM1)</option>
                <option value="Hyderabad, IN">Hyderabad, IN (CtrlS)</option>
                <option value="Chennai, IN">Chennai, IN (Sify Infinit)</option>
                <option value="Noida, IN">Noida, IN (JarvisLabs)</option>
                <option value="Pune, IN">Pune, IN (Azure Central)</option>
              </select>
            </div>
          </div>

          <div className="cx-deploy-calc-summary">
            <div className="cx-deploy-calc-row">
              <span className="cx-muted">Estimated Hourly Burn:</span>
              <span className="cx-mono cx-deploy-rate-bold">₹{formData.hourlyRate}/hr</span>
            </div>
            <div className="cx-deploy-calc-row">
              <span className="cx-muted">Currency:</span>
              <span className="cx-mono">INR (Sovereign Cloud)</span>
            </div>
            <div className="cx-deploy-calc-row">
              <span className="cx-muted">Initial State:</span>
              <StatusPill tone="warning" dot>Provisioning</StatusPill>
            </div>
          </div>
        </form>
      </Dialog>

      {/* Deployment Details Dialog */}
      <Dialog
        open={selectedDeployment !== null}
        title={selectedDeployment?.name || 'Deployment Details'}
        description="Endpoint connectivity and runtime telemetry specifications."
        onClose={() => setSelectedDeployment(null)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="secondary" onClick={() => setSelectedDeployment(null)}>
              Close
            </Button>
          </div>
        }
      >
        {selectedDeployment ? (
          <div className="cx-deploy-details-content">
            <dl className="cx-deploy-details-dl">
              <div>
                <dt>DEPLOYMENT ID</dt>
                <dd className="cx-deploy-details-copy-row">
                  <span className="cx-mono">{selectedDeployment.id}</span>
                  <button
                    type="button"
                    className="cx-iconbtn-sm"
                    onClick={() => copyToClipboard(selectedDeployment.id, 'id')}
                    title="Copy ID"
                    aria-label="Copy deployment ID"
                  >
                    {copiedText === 'id' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </dd>
              </div>

              <div>
                <dt>ENDPOINT URL</dt>
                <dd className="cx-deploy-details-copy-row">
                  <span className="cx-mono">
                    {`https://${selectedDeployment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.endpoints.inferxe.com/v1`}
                  </span>
                  <button
                    type="button"
                    className="cx-iconbtn-sm"
                    onClick={() =>
                      copyToClipboard(
                        `https://${selectedDeployment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.endpoints.inferxe.com/v1`,
                        'url',
                      )
                    }
                    title="Copy URL"
                    aria-label="Copy endpoint URL"
                  >
                    {copiedText === 'url' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </dd>
              </div>

              <div>
                <dt>MODEL</dt>
                <dd>{selectedDeployment.model || 'Custom Model'}</dd>
              </div>

              <div>
                <dt>GPU ACCELERATOR</dt>
                <dd>{selectedDeployment.gpu || 'Sovereign GPU'}</dd>
              </div>

              <div>
                <dt>REGION</dt>
                <dd>{selectedDeployment.region || 'Mumbai, IN'}</dd>
              </div>

              <div>
                <dt>RECORDED STATUS</dt>
                <dd>
                  <StatusPill
                    tone={
                      (selectedDeployment.recordedStatus ?? '').toLowerCase() === 'running'
                        ? 'success'
                        : (selectedDeployment.recordedStatus ?? '').toLowerCase() === 'provisioning'
                          ? 'warning'
                          : 'neutral'
                    }
                    dot={(selectedDeployment.recordedStatus ?? '').toLowerCase() === 'running' || (selectedDeployment.recordedStatus ?? '').toLowerCase() === 'provisioning'}
                  >
                    {humaniseCode(selectedDeployment.recordedStatus || 'Unknown')}
                  </StatusPill>
                </dd>
              </div>

              <div>
                <dt>HOURLY RATE</dt>
                <dd className="cx-mono">
                  {selectedDeployment.hourlyRate !== null && selectedDeployment.currency
                    ? `${formatCurrency(selectedDeployment.hourlyRate, selectedDeployment.currency).replace(/\.00$/, '')}/hr`
                    : 'Unpriced'}
                </dd>
              </div>

              <div>
                <dt>CREATED AT</dt>
                <dd>{formatDateTime(selectedDeployment.createdAt)}</dd>
              </div>

              {selectedDeployment.startedAt ? (
                <div>
                  <dt>STARTED AT</dt>
                  <dd>{formatDateTime(selectedDeployment.startedAt)}</dd>
                </div>
              ) : null}

              {selectedDeployment.stoppedAt ? (
                <div>
                  <dt>STOPPED AT</dt>
                  <dd>{formatDateTime(selectedDeployment.stoppedAt)}</dd>
                </div>
              ) : null}
            </dl>

            <div className="cx-deploy-quickstart">
              <div className="cx-deploy-quickstart-header">
                <span className="cx-label">QUICK START (cURL)</span>
                <button
                  type="button"
                  className="cx-iconbtn-sm"
                  onClick={() =>
                    copyToClipboard(
                      `curl -X POST "https://${selectedDeployment.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.endpoints.inferxe.com/v1/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $INFERXE_API_KEY" \\\n  -d '{"model": "${selectedDeployment.model || 'default'}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
                      'curl',
                    )
                  }
                  title="Copy cURL command"
                  aria-label="Copy cURL command"
                >
                  {copiedText === 'curl' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              <pre className="cx-deploy-curl-code">
{`curl -X POST "https://${selectedDeployment.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.endpoints.inferxe.com/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $INFERXE_API_KEY" \\
  -d '{"model": "${selectedDeployment.model || 'default'}", "messages": [{"role": "user", "content": "Hello!"}]}'`}
              </pre>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Confirmation Dialog for Delete */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete deployment "${deleteTarget?.name}"?`}
        description="This will permanently delete the deployment record from your sovereign workspace. This action cannot be undone."
        confirmLabel="Delete deployment"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        danger
        busy={busyId === deleteTarget?.id}
      />
    </>
  )
}
