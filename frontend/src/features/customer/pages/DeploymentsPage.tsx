/**
 * Deployments — launch and manage GPU instances through the provider adapter API (8001 `/api/v1/gpu/*`).
 * Prices, providers and connection details come from the server; this page never sets them.
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
import { listSshKeys } from '../data/developer'
import { CustomerApiError } from '../data/http'
import { filterDeployments, selectBurn, toDeploymentView, type DeploymentView } from '../data/marketplace'
import { formatCurrency, formatDateTime, formatInteger, humaniseCode } from '../data/selectors'
import {
  createGpuDeployment,
  fetchGpuDeployments,
  fetchGpuOfferings,
  runGpuDeploymentAction,
  type GpuDeploymentAction,
  type GpuOffering,
} from '../data/serviceClients'
import { useAsyncResource } from '../data/useAsyncResource'
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

const offerKey = (o: GpuOffering) => `${o.provider_id}:${o.gpu_id}`
const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Best offering for a GPU hint from a link (gpu id or display name such as "NVIDIA L40S"). */
function matchOffer(offers: GpuOffering[], hint: string): GpuOffering | undefined {
  const q = hint.trim().toLowerCase()
  if (!q) return undefined
  return offers.find((o) => o.gpu_id === q) ?? offers.find((o) => o.name.toLowerCase().includes(q))
}

const ACTION_DONE: Record<GpuDeploymentAction, string> = {
  stop: 'stopped',
  resume: 'resumed',
  terminate: 'terminated',
}

export default function DeploymentsPage() {
  const section = getSection('deployments')
  usePageMeta(section.label, section.description)
  const [searchParams, setSearchParams] = useSearchParams()

  const deployments = useAsyncResource(fetchGpuDeployments, { cacheKey: 'gpu-deployments' })
  const rows = useMemo(() => (deployments.state.data ?? []).map(toDeploymentView), [deployments.state.data])

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
  const [terminateTarget, setTerminateTarget] = useState<DeploymentView | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)

  // Create form: offerings and SSH keys load only while the dialog is open.
  const offerings = useAsyncResource(fetchGpuOfferings, { cacheKey: 'gpu-offerings', enabled: createOpen })
  const sshKeys = useAsyncResource(listSshKeys, { cacheKey: 'ssh-keys', enabled: createOpen })
  const offers = useMemo(
    () => (offerings.state.data ?? []).filter((o) => o.is_available && o.available_quantity > 0),
    [offerings.state.data],
  )
  const [formData, setFormData] = useState({ name: '', modelName: MODELS[1].name, offerKey: '', sshKeyIds: [] as string[] })
  const [gpuHint, setGpuHint] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const selectedOffer =
    offers.find((o) => offerKey(o) === formData.offerKey) ?? matchOffer(offers, gpuHint) ?? offers[0]

  // Pre-fill from URL query params (e.g. from GPU Marketplace "Select & Deploy →")
  useEffect(() => {
    const gpuParam = searchParams.get('gpu')
    const modelParam = searchParams.get('model')
    if (gpuParam || modelParam || searchParams.get('action') === 'new') {
      const model = (modelParam && MODELS.find((m) => m.name.toLowerCase().includes(modelParam.toLowerCase()))) || MODELS[1]
      setFormData((f) => ({
        ...f,
        name: f.name || `${model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-endpoint`,
        modelName: model.name,
        offerKey: '',
      }))
      setGpuHint(gpuParam ?? '')
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

  const handleAction = async (d: DeploymentView, action: GpuDeploymentAction) => {
    setBusyId(d.id)
    setActionError(null)
    setActionSuccess(null)
    try {
      const updated = await runGpuDeploymentAction(d.id, action)
      setActionSuccess(`Deployment "${d.name}" ${ACTION_DONE[action]} (now ${humaniseCode(updated.status)}).`)
      if (action === 'terminate') setTerminateTarget(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Could not ${action} the deployment.`)
    } finally {
      setBusyId(null)
      deployments.refresh()
    }
  }

  const toggleSshKey = (id: string) =>
    setFormData((f) => ({
      ...f,
      sshKeyIds: f.sshKeyIds.includes(id) ? f.sshKeyIds.filter((k) => k !== id) : [...f.sshKeyIds, id],
    }))

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      setActionError('Endpoint name cannot be empty.')
      return
    }
    if (!selectedOffer) {
      setActionError('Choose an available GPU.')
      return
    }
    setCreateSubmitting(true)
    setActionError(null)
    try {
      const created = await createGpuDeployment({
        name: formData.name.trim(),
        model_name: formData.modelName,
        gpu_id: selectedOffer.gpu_id,
        provider_id: selectedOffer.provider_id,
        ssh_key_ids: formData.sshKeyIds,
        idempotency_key: idempotencyKey,
      })
      setIdempotencyKey(newIdempotencyKey())
      if (created.status === 'failed') {
        // A retry with the kept key returns the earlier attempt's record; it failed, so the next try starts fresh.
        setActionError(`Deployment "${created.name}" could not be launched. Try again.`)
        return
      }
      setActionSuccess(`Deployment "${created.name}" launched (${humaniseCode(created.status)}).`)
      setFormData((f) => ({ ...f, name: '', sshKeyIds: [] }))
      handleCloseCreate()
    } catch (err) {
      // A 4xx means the request was refused, so the next try needs a new key. Network errors and 5xx keep the key:
      // a gateway timeout does not end the backend request, and a retry returns its record instead of a second GPU.
      if (err instanceof CustomerApiError && err.status !== null && err.status < 500) setIdempotencyKey(newIdempotencyKey())
      setActionError(err instanceof Error ? err.message : 'Failed to create deployment.')
    } finally {
      setCreateSubmitting(false)
      deployments.refresh()
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAction(d, 'stop')}
                disabled={isBusy}
                aria-label={`Stop deployment ${d.name}`}
                title="Stop instance (billing for compute pauses)"
              >
                <Square size={13} style={{ fill: 'currentColor' }} />
                <span className="cx-btn-text">Stop</span>
              </Button>
            ) : s === 'stopped' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAction(d, 'resume')}
                disabled={isBusy}
                aria-label={`Resume deployment ${d.name}`}
                title="Resume instance"
              >
                <Play size={13} style={{ fill: 'currentColor' }} />
                <span className="cx-btn-text">Resume</span>
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
            {s !== 'terminated' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTerminateTarget(d)}
                disabled={isBusy}
                aria-label={`Terminate deployment ${d.name}`}
                title="Terminate instance"
                className="cx-btn--danger-ghost"
              >
                <Trash2 size={13} />
              </Button>
            ) : null}
          </div>
        )
      },
    },
  ]

  const listState = deployments.state
  const endpointUrl = selectedDeployment?.endpointUrl ?? null

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
              onClick={deployments.refresh}
              disabled={listState.status === 'loading'}
              aria-label="Refresh deployments"
            >
              <RefreshCw size={15} className={listState.status === 'loading' ? 'cx-spin' : undefined} />
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
        {listState.status === 'error' && !listState.data ? (
          <ErrorState
            error={listState.error}
            onRetry={deployments.refresh}
            onSignIn={() => void signOutToLogin()}
            what="your deployments"
            compact
          />
        ) : !listState.data ? (
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
        description="Launch a dedicated GPU instance. The price is set by the provider and shown before you deploy."
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
              disabled={createSubmitting || !formData.name.trim() || !selectedOffer}
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
              maxLength={100}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              autoFocus
            />
            <span className="cx-hint">A name to recognise this deployment by.</span>
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

          <div className="cx-form-group">
            <label className="cx-label" htmlFor="cx-deploy-gpu">
              GPU Hardware
            </label>
            {offerings.state.status === 'error' ? (
              <span className="cx-hint" role="alert">
                Could not load available GPUs: {offerings.state.error.message}
              </span>
            ) : !offerings.state.data ? (
              <span className="cx-hint">Loading available GPUs…</span>
            ) : offers.length === 0 ? (
              <span className="cx-hint" role="alert">No GPUs are available right now.</span>
            ) : (
              <select
                id="cx-deploy-gpu"
                className="cx-input cx-select"
                value={selectedOffer ? offerKey(selectedOffer) : ''}
                onChange={(e) => setFormData({ ...formData, offerKey: e.target.value })}
              >
                {offers.map((o) => (
                  <option key={offerKey(o)} value={offerKey(o)}>
                    {o.name} ({o.vram_gb} GB) · {o.provider_id} · {o.region} — ₹{o.hourly_price_inr}/hr
                    {o.pricing_type === 'spot' ? ' (spot)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <fieldset className="cx-form-group">
            <legend className="cx-label">SSH Keys (optional)</legend>
            {sshKeys.state.status === 'error' ? (
              <span className="cx-hint" role="alert">Could not load your SSH keys: {sshKeys.state.error.message}</span>
            ) : !sshKeys.state.data ? (
              <span className="cx-hint">Loading your SSH keys…</span>
            ) : sshKeys.state.data.length === 0 ? (
              <span className="cx-hint">
                No SSH keys yet. <Link to={sectionHref(getSection('ssh-keys'))}>Add one</Link> to get shell access.
              </span>
            ) : (
              sshKeys.state.data.map((k) => (
                <label key={k.id} className="cx-check">
                  <input
                    type="checkbox"
                    checked={formData.sshKeyIds.includes(k.id)}
                    onChange={() => toggleSshKey(k.id)}
                  />
                  <span>
                    {k.name} <span className="cx-mono cx-muted">{k.fingerprint}</span>
                  </span>
                </label>
              ))
            )}
            <span className="cx-hint">Selected public keys are installed on the instance for SSH login.</span>
          </fieldset>

          <div className="cx-deploy-calc-summary">
            <div className="cx-deploy-calc-row">
              <span className="cx-muted">Estimated Hourly Burn:</span>
              <span className="cx-mono cx-deploy-rate-bold">
                {selectedOffer ? `₹${selectedOffer.hourly_price_inr}/hr` : '—'}
              </span>
            </div>
            <div className="cx-deploy-calc-row">
              <span className="cx-muted">Provider · Region:</span>
              <span className="cx-mono">{selectedOffer ? `${selectedOffer.provider_id} · ${selectedOffer.region}` : '—'}</span>
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
        description="Endpoint connectivity and instance details."
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
            {selectedDeployment.errorMessage ? (
              <Notice tone="danger" icon={<X size={16} />}>
                {selectedDeployment.errorMessage}
              </Notice>
            ) : null}
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
                  {endpointUrl ? (
                    <>
                      <span className="cx-mono">{endpointUrl}</span>
                      <button
                        type="button"
                        className="cx-iconbtn-sm"
                        onClick={() => copyToClipboard(endpointUrl, 'url')}
                        title="Copy URL"
                        aria-label="Copy endpoint URL"
                      >
                        {copiedText === 'url' ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </>
                  ) : (
                    <span className="cx-muted">Not available yet</span>
                  )}
                </dd>
              </div>

              <div>
                <dt>SSH ACCESS</dt>
                <dd className="cx-deploy-details-copy-row">
                  {selectedDeployment.ssh ? (
                    <>
                      <span className="cx-mono">{selectedDeployment.ssh.command}</span>
                      <button
                        type="button"
                        className="cx-iconbtn-sm"
                        onClick={() => copyToClipboard(selectedDeployment.ssh!.command, 'ssh')}
                        title="Copy SSH command"
                        aria-label="Copy SSH command"
                      >
                        {copiedText === 'ssh' ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </>
                  ) : (
                    <span className="cx-muted">Available while the instance is running</span>
                  )}
                </dd>
              </div>

              <div>
                <dt>MODEL</dt>
                <dd>{selectedDeployment.model || '—'}</dd>
              </div>

              <div>
                <dt>GPU ACCELERATOR</dt>
                <dd>{selectedDeployment.gpu || '—'}</dd>
              </div>

              <div>
                <dt>PROVIDER · REGION</dt>
                <dd>
                  {selectedDeployment.providerId || '—'} · {selectedDeployment.region || '—'}
                </dd>
              </div>

              {selectedDeployment.providerInstanceId ? (
                <div>
                  <dt>INSTANCE ID</dt>
                  <dd className="cx-mono">{selectedDeployment.providerInstanceId}</dd>
                </div>
              ) : null}

              <div>
                <dt>STATUS</dt>
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

            {endpointUrl ? (
              <div className="cx-deploy-quickstart">
                <div className="cx-deploy-quickstart-header">
                  <span className="cx-label">QUICK START (cURL)</span>
                  <button
                    type="button"
                    className="cx-iconbtn-sm"
                    onClick={() =>
                      copyToClipboard(
                        `curl -X POST "${endpointUrl}/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${selectedDeployment.model || 'default'}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
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
{`curl -X POST "${endpointUrl}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${selectedDeployment.model || 'default'}", "messages": [{"role": "user", "content": "Hello!"}]}'`}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {/* Confirmation Dialog for Terminate */}
      <ConfirmDialog
        open={terminateTarget !== null}
        title={`Terminate deployment "${terminateTarget?.name}"?`}
        description="This permanently shuts down the GPU instance and releases it at the provider. The record stays in your history. This cannot be undone."
        confirmLabel="Terminate deployment"
        onConfirm={() => terminateTarget && handleAction(terminateTarget, 'terminate')}
        onCancel={() => setTerminateTarget(null)}
        danger
        busy={busyId === terminateTarget?.id}
      />
    </>
  )
}
