import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Gauge,
  Gift,
  Globe,
  Info,
  KeyRound,
  Laptop,
  Layers,
  Loader2,
  Network,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Terminal,
  Thermometer,
  Timer,
  Trash2,
  TrendingUp,
  X,
  Youtube,
  Zap,
} from 'lucide-react'
import { fetchBackendSshKeys, type BackendSshKey } from '../../lib/sshKeyService'
import {
  fetchBackendNotebooks,
  createBackendNotebook,
  startBackendNotebook,
  stopBackendNotebook,
  deleteBackendNotebook,
  type BackendNotebook,
} from '../../lib/notebookService'

/* ───────────────────────────────────────────────────────────
   Extra customer-dashboard sections
   (reviews, notebooks/SSH, providers, rewards, usage detail)
   All data is demo data kept in this browser's localStorage.
   ─────────────────────────────────────────────────────────── */

type Flash = (msg: string) => void

export interface ExtraOrder {
  id: string
  modelOrGpu: string
  provider: string
  date: string
  duration: string
  cost: number
  status: 'Running' | 'Completed' | 'Cancelled' | 'Archived'
}

export interface ExtraDeployment {
  id: string
  name: string
  model: string
  gpu: string
  region: string
  status: 'Running' | 'Stopped' | 'Provisioning'
  hourlyRate?: number
}

const KEYS = {
  reviews: 'inferxe_demo_reviews_v1',
  notebookBot: 'inferxe_demo_notebook_bot_access_v1',
  notebookCells: 'inferxe_demo_notebook_cells_v1',
  referrals: 'inferxe_demo_referrals_v1',
  creatorRedeemed: 'inferxe_demo_creator_redeemed_v1',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* demo browser storage */
  }
}

function inr(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function copy(text: string, flash: Flash, msg: string) {
  navigator.clipboard?.writeText(text)
  flash(msg)
}

/* ═══════════════ 1. REVIEWS & NOTES (after a purchase) ═══════════════ */

type Review = { rating: number; note: string; date: string }

export function ReviewsSection({ orders, flash }: { orders: ExtraOrder[]; flash: Flash }) {
  const [reviews, setReviews] = useState<Record<string, Review>>(() => read(KEYS.reviews, {}))
  const [drafts, setDrafts] = useState<Record<string, { rating: number; note: string }>>({})

  const reviewable = orders.filter((o) => o.status === 'Completed' || o.status === 'Archived')
  const pending = reviewable.filter((o) => !reviews[o.id])
  const done = reviewable.filter((o) => reviews[o.id])

  const draftOf = (id: string) => drafts[id] ?? { rating: 0, note: '' }
  const setDraft = (id: string, patch: Partial<{ rating: number; note: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftOf(id), ...patch } }))

  const submit = (o: ExtraOrder) => {
    const d = draftOf(o.id)
    if (d.rating < 1) {
      flash('Pick a star rating first.')
      return
    }
    const next = { ...reviews, [o.id]: { rating: d.rating, note: d.note.trim(), date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } }
    setReviews(next)
    write(KEYS.reviews, next)
    flash(`Thanks! Review saved for ${o.id}.`)
  }

  const Stars = ({ value, onPick }: { value: number; onPick?: (n: number) => void }) => (
    <div className="xs-stars" role={onPick ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onPick}
          className={n <= value ? 'is-on' : ''}
          onClick={() => onPick?.(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          <Star size={20} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )

  return (
    <>
      <div className="mw-toolbar">
        <div>
          <h2>Reviews & Notes</h2>
          <p>After a purchase completes, rate the GPU / provider and keep a private note for next time.</p>
        </div>
      </div>

      <div className="mw-panel">
        <div className="mw-panel-head">
          <h3>Waiting for your review ({pending.length})</h3>
          <span className="mw-muted">Completed orders</span>
        </div>
        {pending.length === 0 && <p className="mw-muted" style={{ padding: 16 }}>You're all caught up — no orders waiting for a review.</p>}
        <div className="xs-stack">
          {pending.map((o) => {
            const d = draftOf(o.id)
            return (
              <div className="xs-card" key={o.id}>
                <div className="xs-card__head">
                  <div>
                    <strong>{o.modelOrGpu}</strong>
                    <small>{o.id} · {o.provider} · {o.date} · {o.duration} · {inr(o.cost)}</small>
                  </div>
                  <Stars value={d.rating} onPick={(n) => setDraft(o.id, { rating: n })} />
                </div>
                <textarea
                  className="xs-input"
                  rows={2}
                  placeholder="Add a note — performance, latency, support, would you re-use this GPU?"
                  value={d.note}
                  onChange={(e) => setDraft(o.id, { note: e.target.value })}
                />
                <div>
                  <button className="mw-primary" onClick={() => submit(o)}>Submit review</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mw-panel">
        <div className="mw-panel-head">
          <h3>Your reviews ({done.length})</h3>
        </div>
        {done.length === 0 && <p className="mw-muted" style={{ padding: 16 }}>No reviews yet.</p>}
        <div className="xs-stack">
          {done.map((o) => (
            <div className="xs-card" key={o.id}>
              <div className="xs-card__head">
                <div>
                  <strong>{o.modelOrGpu}</strong>
                  <small>{o.id} · reviewed {reviews[o.id].date}</small>
                </div>
                <Stars value={reviews[o.id].rating} />
              </div>
              {reviews[o.id].note && <p className="xs-note">“{reviews[o.id].note}”</p>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/* ═══════════════ 2. NOTEBOOKS (JupyterLab) & SSH ACCESS ═══════════════ */

type Cell = { id: number; code: string; out: string }

const DEFAULT_CELLS: Cell[] = [
  { id: 1, code: 'import torch\nprint(torch.cuda.get_device_name(0))', out: '' },
  { id: 2, code: 'from openai import OpenAI\nclient = OpenAI(base_url="https://api.inferxe.com/v1", api_key="inf_demo_...")', out: '' },
]

function fakeRun(code: string, gpu: string): string {
  if (/get_device_name/.test(code)) return gpu
  if (/is_available/.test(code)) return 'True'
  if (/nvidia-smi/.test(code)) return `| NVIDIA-SMI 550.54 | ${gpu} | 41C | 312MiB / 49152MiB |`
  if (/OpenAI\(/.test(code)) return 'client ready → https://api.inferxe.com/v1'
  if (/print\(/.test(code)) {
    const m = code.match(/print\((['"])(.*?)\1\)/)
    if (m) return m[2]
  }
  return '(executed in demo kernel — no output)'
}


function getSuggestedKeyPath(keyType?: string): string {
  if (!keyType) return '~/.ssh/id_ed25519'
  const t = keyType.toLowerCase()
  if (t.includes('rsa')) return '~/.ssh/id_rsa'
  if (t.includes('ecdsa')) return '~/.ssh/id_ecdsa'
  return '~/.ssh/id_ed25519'
}

export function NotebooksSection({
  deployments,
  flash,
  addNotification,
}: {
  deployments: ExtraDeployment[]
  flash: Flash
  addNotification?: (notif: { title: string; detail: string; type?: string }) => void
}) {
  const running = deployments.filter((d) => d.status === 'Running')
  const [selId, setSelId] = useState(running[0]?.id ?? '')
  const sel = running.find((d) => d.id === selId) ?? running[0]
  const [botAccess, setBotAccess] = useState<boolean>(() => read(KEYS.notebookBot, false))
  const [cells, setCells] = useState<Cell[]>(() => read(KEYS.notebookCells, DEFAULT_CELLS))
  const [serverUp, setServerUp] = useState(false)

  // Stage 2: Runtime Monitoring State (Teammate telemetry)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('15:30:12 UTC')
  const [pulseCount, setPulseCount] = useState(0)
  const [auditDone, setAuditDone] = useState(false)

  // Backend SSH Keys integration (Stage 2B)
  const [sshKeys, setSshKeys] = useState<BackendSshKey[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [keysError, setKeysError] = useState<string | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState<string>('')
  const [customKeyPath, setCustomKeyPath] = useState<string>('')

  // Backend Notebooks integration (Stage 2B)
  const [notebooks, setNotebooks] = useState<BackendNotebook[]>([])
  const [nbLoading, setNbLoading] = useState(true)
  const [nbError, setNbError] = useState<string | null>(null)
  const [selectedNbId, setSelectedNbId] = useState<string>('')

  // Creation modal & lifecycle states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newNbName, setNewNbName] = useState('')
  const [newNbProfile, setNewNbProfile] = useState('NVIDIA L4')
  const [newNbSshKeyId, setNewNbSshKeyId] = useState('')
  const [creatingNb, setCreatingNb] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [oneTimeTokenNotice, setOneTimeTokenNotice] = useState<{ name: string; token: string } | null>(null)

  // 1. Load SSH Keys from backend
  const loadSshKeys = async () => {
    setKeysLoading(true)
    setKeysError(null)
    const res = await fetchBackendSshKeys()
    if (res.ok && res.keys) {
      setSshKeys(res.keys)
      setSelectedKeyId((prev) => {
        if (prev && res.keys!.some((k) => k.id === prev)) return prev
        return res.keys![0]?.id ?? ''
      })
    } else if (res.error) {
      setKeysError(res.error)
    }
    setKeysLoading(false)
  }

  // 2. Load Notebook Sessions from backend
  const loadNotebooks = async () => {
    setNbLoading(true)
    setNbError(null)
    const res = await fetchBackendNotebooks()
    if (res.ok && res.notebooks) {
      setNotebooks(res.notebooks)
      setSelectedNbId((prev) => {
        if (prev && res.notebooks!.some((n) => n.id === prev)) return prev
        return res.notebooks![0]?.id ?? ''
      })
    } else if (res.error) {
      setNbError(res.error)
    }
    setNbLoading(false)
  }

  useEffect(() => {
    void loadSshKeys()
    void loadNotebooks()
  }, [])

  useEffect(() => write(KEYS.notebookCells, cells), [cells])

  const selectedNotebook = useMemo(
    () => notebooks.find((n) => n.id === selectedNbId) ?? notebooks[0],
    [notebooks, selectedNbId]
  )

  // If selected notebook has a bound SSH key and user hasn't manually picked one, sync it
  useEffect(() => {
    if (selectedNotebook?.selected_ssh_key_id && !selectedKeyId) {
      setSelectedKeyId(selectedNotebook.selected_ssh_key_id)
    }
  }, [selectedNotebook, selectedKeyId])

  const selectedKey = useMemo(
    () => sshKeys.find((k) => k.id === selectedKeyId) ?? sshKeys[0],
    [sshKeys, selectedKeyId]
  )

  const suggestedKeyPath = useMemo(
    () => getSuggestedKeyPath(selectedKey?.key_type),
    [selectedKey?.key_type]
  )

  const effectiveKeyPath = customKeyPath.trim() || suggestedKeyPath

  // Host derivation: prioritize real backend notebook instance
  const host = selectedNotebook
    ? `${selectedNotebook.id.replace(/-/g, '').slice(0, 8)}.simulated.nodes.inferxe.com`
    : (sel ? `${sel.id}.${sel.region.split(',')[0].toLowerCase().replace(/\s+/g, '')}.nodes.inferxe.com` : 'no-active-instance')

  const isServerRunning = selectedNotebook ? selectedNotebook.status === 'running' : serverUp
  const jupyterUrl = `https://${host}/lab`
  const sshCmd = `ssh -i ${effectiveKeyPath} -p 2222 ubuntu@${host}`

  // Lifecycle handlers
  const handleCreateNotebook = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingNb(true)
    const res = await createBackendNotebook({
      name: newNbName.trim() || 'Untitled Notebook',
      gpu_profile: newNbProfile,
      selected_ssh_key_id: newNbSshKeyId || null,
    })
    setCreatingNb(false)
    if (res.ok && res.notebook) {
      setNotebooks((prev) => [res.notebook!, ...prev])
      setSelectedNbId(res.notebook.id)
      setShowCreateModal(false)
      setNewNbName('')
      if (res.notebook.access_token) {
        setOneTimeTokenNotice({
          name: res.notebook.name,
          token: res.notebook.access_token,
        })
      }
      flash(`Notebook "${res.notebook.name}" provisioned successfully!`)
    } else {
      flash(res.error || 'Failed to create notebook.')
    }
  }

  const handleStartNotebook = async (id: string) => {
    setActionLoadingId(id)
    const res = await startBackendNotebook(id)
    setActionLoadingId(null)
    if (res.ok && res.notebook) {
      setNotebooks((prev) => prev.map((n) => (n.id === id ? res.notebook! : n)))
      setServerUp(true)
      flash(`Notebook "${res.notebook.name}" started successfully.`)
    } else {
      flash(res.error || 'Failed to start notebook.')
    }
  }

  const handleStopNotebook = async (id: string) => {
    setActionLoadingId(id)
    const res = await stopBackendNotebook(id)
    setActionLoadingId(null)
    if (res.ok && res.notebook) {
      setNotebooks((prev) => prev.map((n) => (n.id === id ? res.notebook! : n)))
      setServerUp(false)
      flash(`Notebook "${res.notebook.name}" stopped.`)
    } else {
      flash(res.error || 'Failed to stop notebook.')
    }
  }

  const handleTerminateNotebook = async (id: string) => {
    if (!window.confirm('Are you sure you want to terminate this notebook instance? This action cannot be undone.')) {
      return
    }
    setActionLoadingId(id)
    const res = await deleteBackendNotebook(id)
    setActionLoadingId(null)
    if (res.ok && res.notebook) {
      setNotebooks((prev) => prev.filter((n) => n.id !== id))
      if (selectedNbId === id) {
        setSelectedNbId('')
      }
      flash(`Notebook "${res.notebook.name}" terminated.`)
    } else {
      flash(res.error || 'Failed to terminate notebook.')
    }
  }

  // Hardware telemetry specs based on selected GPU or notebook profile
  const totalVramGb = useMemo(() => {
    const prof = selectedNotebook?.gpu_profile ?? sel?.gpu ?? ''
    if (prof.includes('H100')) return 80.0
    if (prof.includes('L40S')) return 48.0
    if (prof.includes('A100')) return 80.0
    return 24.0
  }, [selectedNotebook, sel])

  const isInstanceRunning = selectedNotebook ? selectedNotebook.status === 'running' : (sel?.status === 'Running')

  // Dynamic telemetry calculations with realistic kernel baseline & execution pulse
  const currentUtilization = useMemo(() => {
    if (!isInstanceRunning) return 0
    if (pulseCount > 0) return 74
    return 48
  }, [isInstanceRunning, pulseCount])

  const currentUsedVram = useMemo(() => {
    if (!isInstanceRunning) return 0.0
    if (pulseCount > 0) return Math.min(totalVramGb, Number((totalVramGb * 0.44).toFixed(1)))
    return Number((totalVramGb * 0.35).toFixed(1))
  }, [isInstanceRunning, pulseCount, totalVramGb])

  const currentFreeVram = useMemo(() => {
    return Number(Math.max(0, totalVramGb - currentUsedVram).toFixed(1))
  }, [totalVramGb, currentUsedVram])

  const vramUtilizationPct = useMemo(() => {
    if (!isInstanceRunning || totalVramGb <= 0) return 0
    return Number(((currentUsedVram / totalVramGb) * 100).toFixed(1))
  }, [currentUsedVram, totalVramGb, isInstanceRunning])

  const currentTemp = useMemo(() => {
    if (!isInstanceRunning) return 0
    return pulseCount > 0 ? 47 : 41
  }, [isInstanceRunning, pulseCount])

  const currentPower = useMemo(() => {
    if (!isInstanceRunning) return 0
    const maxP = totalVramGb >= 80 ? 700 : 250
    return pulseCount > 0 ? Math.round(maxP * 0.58) : Math.round(maxP * 0.29)
  }, [isInstanceRunning, pulseCount, totalVramGb])

  // 12-point time series data points for visualization
  const historyData = useMemo(() => {
    const points = [
      { t: '-15m', util: 32, mem: Number((totalVramGb * 0.32).toFixed(1)) },
      { t: '-13m', util: 38, mem: Number((totalVramGb * 0.33).toFixed(1)) },
      { t: '-11m', util: 45, mem: Number((totalVramGb * 0.34).toFixed(1)) },
      { t: '-9m',  util: 52, mem: Number((totalVramGb * 0.36).toFixed(1)) },
      { t: '-8m',  util: 49, mem: Number((totalVramGb * 0.35).toFixed(1)) },
      { t: '-6m',  util: 41, mem: Number((totalVramGb * 0.34).toFixed(1)) },
      { t: '-5m',  util: 55, mem: Number((totalVramGb * 0.36).toFixed(1)) },
      { t: '-4m',  util: 62, mem: Number((totalVramGb * 0.37).toFixed(1)) },
      { t: '-3m',  util: 58, mem: Number((totalVramGb * 0.36).toFixed(1)) },
      { t: '-2m',  util: 44, mem: Number((totalVramGb * 0.35).toFixed(1)) },
      { t: '-1m',  util: 46, mem: Number((totalVramGb * 0.35).toFixed(1)) },
      { t: 'Now',   util: currentUtilization, mem: currentUsedVram },
    ]
    return points
  }, [totalVramGb, currentUtilization, currentUsedVram])

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefresh || !isInstanceRunning) return
    const interval = setInterval(() => {
      const now = new Date()
      setLastUpdated(now.toTimeString().split(' ')[0] + ' UTC')
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, isInstanceRunning])

  // Manual refresh trigger
  const handleManualRefresh = () => {
    setIsRefreshing(true)
    const now = new Date()
    setLastUpdated(now.toTimeString().split(' ')[0] + ' UTC')
    flash('GPU runtime metrics refreshed from kernel probe.')
    setTimeout(() => setIsRefreshing(false), 500)
  }

  // Cell run handler with execution telemetry pulse
  const runCell = (id: number) => {
    setCells((cs) =>
      cs.map((c) => (c.id === id ? { ...c, out: fakeRun(c.code, selectedNotebook?.gpu_profile ?? (sel ? `NVIDIA ${sel.gpu}` : 'no GPU')) } : c))
    )
    setPulseCount((c) => c + 1)
    setTimeout(() => setPulseCount(0), 3000)
  }

  // Trigger contextual optimization audit
  const handleRunAudit = () => {
    setAuditDone(true)
    const notifItem = {
      title: `AI Assistant GPU Audit: ${selectedNotebook?.gpu_profile ?? (sel ? `NVIDIA ${sel.gpu}` : 'GPU Instance')}`,
      detail: `Telemetry confirmed optimal headroom for FP16 inference. Consider spot pricing to save ~₹18/hr.`,
      type: 'AI Optimization',
    }
    if (addNotification) {
      addNotification(notifItem)
    }
    try {
      fetch('/api/gpu/alerts/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: selectedNotebook?.id || sel?.id || 'dep-1042',
          alert_type: 'resource_audit',
          title: notifItem.title,
          message: notifItem.detail,
        }),
      }).catch(() => {})
    } catch {}
    flash('AI Assistant Audit Complete: Telemetry analyzed and alert dispatched.')
  }

  // SVG Chart Dimensions & Path Generator
  const chartW = 460
  const chartH = 120
  const padL = 35
  const padR = 15
  const padT = 15
  const padB = 25
  const usableW = chartW - padL - padR
  const usableH = chartH - padT - padB

  // Build SVG path for utilization % (0 to 100)
  const utilPoints = historyData.map((d, i) => {
    const x = padL + (i / (historyData.length - 1)) * usableW
    const y = padT + (1 - d.util / 100) * usableH
    return { x, y, ...d }
  })
  const utilPathD = utilPoints.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '')
  const utilAreaD = `${utilPathD} L ${utilPoints[utilPoints.length - 1].x} ${padT + usableH} L ${utilPoints[0].x} ${padT + usableH} Z`

  // Build SVG path for memory GB (0 to totalVramGb)
  const memPoints = historyData.map((d, i) => {
    const x = padL + (i / (historyData.length - 1)) * usableW
    const y = padT + (1 - d.mem / totalVramGb) * usableH
    return { x, y, ...d }
  })
  const memPathD = memPoints.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '')
  const memAreaD = `${memPathD} L ${memPoints[memPoints.length - 1].x} ${padT + usableH} L ${memPoints[0].x} ${padT + usableH} Z`

  return (
    <>
      <div className="mw-toolbar">
        <div>
          <h2>Notebooks & SSH Access</h2>
          <p>Provision managed JupyterLab sessions, connect via authenticated SSH, or test code in the interactive playground.</p>
        </div>
      </div>

      {/* One-Time Access Token Banner */}
      {oneTimeTokenNotice && (
        <div style={{ padding: '12px 14px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <Check size={16} /> Notebook "{oneTimeTokenNotice.name}" Created
              </strong>
              <p style={{ margin: '6px 0 8px 0', fontSize: '0.78rem', color: 'var(--ink-2)' }}>
                One-time JupyterLab access token. Store this token securely now — it is cryptographically hashed with SHA-256 and cannot be retrieved again:
              </p>
              <div className="xs-code" style={{ maxWidth: '100%', marginBottom: 4 }}>
                <code>{oneTimeTokenNotice.token}</code>
                <button
                  type="button"
                  className="mw-link-btn"
                  title="Copy token"
                  onClick={() => copy(oneTimeTokenNotice.token, flash, 'Jupyter access token copied!')}
                >
                  <Copy size={13} />
                </button>
              </div>
              <small className="mw-muted" style={{ fontSize: '0.71rem', display: 'block' }}>
                For security, this raw token is kept only in volatile memory during this notification and is never saved to localStorage.
              </small>
            </div>
            <button
              type="button"
              className="mw-link-btn"
              onClick={() => setOneTimeTokenNotice(null)}
              aria-label="Dismiss notice"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ SECTION 1: MANAGED NOTEBOOK SESSIONS (STAGE 2B) ═══════════════ */}
      <div className="mw-panel" style={{ marginBottom: 16 }}>
        <div className="mw-panel-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Laptop size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
            <div>
              <h3 style={{ margin: 0 }}>Notebook Sessions</h3>
              <span className="mw-muted" style={{ fontSize: '0.8rem' }}>
                {notebooks.length} {notebooks.length === 1 ? 'session' : 'sessions'} registered
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="mw-secondary"
              style={{ padding: '4px 10px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={() => void loadNotebooks()}
              title="Refresh sessions from backend"
            >
              <RefreshCw size={13} className={nbLoading ? 'spin' : ''} /> Refresh
            </button>
            <button
              type="button"
              className="mw-primary"
              style={{ padding: '4px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={14} /> New Notebook
            </button>
          </div>
        </div>

        {nbLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px', color: 'var(--ink-3)', fontSize: '0.84rem' }}>
            <Loader2 size={16} className="spin" />
            <span>Loading notebook sessions from backend...</span>
          </div>
        )}

        {!nbLoading && nbError && (
          <div style={{ margin: '14px', padding: '12px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 8, color: '#f87171', fontSize: '0.82rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={15} /> {nbError}
              </span>
              <button
                type="button"
                className="mw-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => void loadNotebooks()}
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        )}

        {!nbLoading && !nbError && notebooks.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: 'var(--ink-3)' }}>
              No notebook instances found for your account. Provision a notebook session to connect via SSH and JupyterLab.
            </p>
            <button
              type="button"
              className="mw-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '6px 14px' }}
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={14} /> Create Notebook Session
            </button>
          </div>
        )}

        {!nbLoading && !nbError && notebooks.length > 0 && (
          <div className="xs-stack" style={{ padding: '14px' }}>
            <label className="xs-label">
              Active Notebook Session
              <select
                className="xs-input"
                value={selectedNotebook?.id ?? ''}
                onChange={(e) => setSelectedNbId(e.target.value)}
              >
                {notebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name} · {nb.gpu_profile} · [{nb.status.toUpperCase()}]
                  </option>
                ))}
              </select>
            </label>

            {selectedNotebook && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background:
                        selectedNotebook.status === 'running'
                          ? '#10b981'
                          : selectedNotebook.status === 'stopped'
                          ? '#f59e0b'
                          : '#6b7280',
                    }}
                  />
                  <strong>{selectedNotebook.name}</strong>
                  <span className="mw-muted">({selectedNotebook.gpu_profile})</span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--line-2)',
                    }}
                  >
                    {selectedNotebook.status}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {(selectedNotebook.status === 'stopped' || selectedNotebook.status === 'failed' || selectedNotebook.status === 'provisioning') && (
                    <button
                      type="button"
                      className="mw-secondary"
                      disabled={actionLoadingId === selectedNotebook.id}
                      style={{ padding: '4px 10px', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => handleStartNotebook(selectedNotebook.id)}
                    >
                      <Play size={12} /> {actionLoadingId === selectedNotebook.id ? 'Starting...' : 'Start'}
                    </button>
                  )}

                  {(selectedNotebook.status === 'running' || selectedNotebook.status === 'provisioning') && (
                    <button
                      type="button"
                      className="mw-secondary"
                      disabled={actionLoadingId === selectedNotebook.id}
                      style={{ padding: '4px 10px', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => handleStopNotebook(selectedNotebook.id)}
                    >
                      <Square size={12} /> {actionLoadingId === selectedNotebook.id ? 'Stopping...' : 'Stop'}
                    </button>
                  )}

                  <button
                    type="button"
                    className="mw-link-btn"
                    disabled={actionLoadingId === selectedNotebook.id}
                    style={{ color: '#ef4444', padding: '4px 8px', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => handleTerminateNotebook(selectedNotebook.id)}
                    title="Terminate notebook instance"
                  >
                    <Trash2 size={13} /> Terminate
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
        {/* ═══════════════ SECTION 2: GPU INSTANCE & SSH CONNECTION ═══════════════ */}
        <div className="mw-panel" style={{ width: '100%' }}>
          <div className="mw-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Terminal size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
              <div>
                <h3 style={{ margin: 0 }}>GPU Instance Connection</h3>
                <span className="mw-muted" style={{ fontSize: '0.82rem' }}>Direct SSH endpoint & host configuration</span>
              </div>
            </div>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: '0.75rem',
              fontWeight: 600,
              background: (sel || selectedNotebook) ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              color: (sel || selectedNotebook) ? 'var(--brand-hi, #22c55e)' : '#ef4444',
              border: `1px solid ${(sel || selectedNotebook) ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                backgroundColor: (sel || selectedNotebook) ? 'var(--brand-hi, #22c55e)' : '#ef4444',
                boxShadow: (sel || selectedNotebook) ? '0 0 8px var(--brand-hi, #22c55e)' : 'none'
              }} />
              {(sel || selectedNotebook) ? 'SSH Ready · Online' : 'Offline'}
            </span>
          </div>

          <div className="xs-stack" style={{ gap: 16 }}>
            {/* Simulation Notice Banner */}
            <div style={{ fontSize: '0.75rem', color: '#60a5fa', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 6, padding: '7px 10px' }}>
              <Info size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: -2 }} />
              <strong>Simulated Runtime:</strong> {selectedNotebook?.simulation_notice || 'Simulated runtime environment: no physical GPU or Jupyter container is running.'}
            </div>

            {/* Dropdown & Active Instance Details */}
            {running.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 16,
                alignItems: 'start'
              }}>
                <div>
                  <label className="xs-label" style={{ display: 'block', marginBottom: 6 }}>
                    Select GPU Instance
                  </label>
                  <select
                    className="xs-input"
                    value={sel?.id}
                    onChange={(e) => {
                      setSelId(e.target.value)
                      setServerUp(false)
                    }}
                    style={{ width: '100%' }}
                  >
                    {running.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.gpu} · {d.region}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3, #71717a)' }}>Instance Name</span>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--ink, #fff)' }}>{sel?.name}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3, #71717a)' }}>GPU Model</span>
                    <span style={{
                      fontSize: '0.76rem',
                      fontFamily: 'var(--font-mono)',
                      background: 'rgba(34, 197, 94, 0.1)',
                      color: 'var(--brand-hi, #22c55e)',
                      padding: '2px 8px',
                      borderRadius: 4
                    }}>
                      NVIDIA {sel?.gpu}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3, #71717a)' }}>Datacenter Region</span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--ink-2, #d4d4d8)' }}>{sel?.region}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3, #71717a)' }}>Connection Status</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--brand-hi, #22c55e)' }}>Port 2222 · SSH Listening</span>
                  </div>
                </div>
              </div>
            )}

            {/* SSH Keys State Handling (From Stash) */}
            {keysLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg-3)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--ink-3)' }}>
                <Loader2 size={15} className="spin" />
                <span>Loading registered SSH keys...</span>
              </div>
            )}

            {!keysLoading && keysError && (
              <div style={{ padding: '10px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 8, fontSize: '0.82rem', color: '#f87171' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={15} />
                    {keysError}
                  </span>
                  <button
                    type="button"
                    className="mw-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => void loadSshKeys()}
                  >
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              </div>
            )}

            {!keysLoading && !keysError && sshKeys.length === 0 && (
              <div style={{ padding: '12px 14px', background: 'var(--bg-3)', border: '1px dashed var(--line-2)', borderRadius: 8 }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: 'var(--ink-2)' }}>
                  No registered SSH public keys found in your account. You must register an SSH public key to securely access your GPU instance.
                </p>
                <Link
                  to="/dashboard/ssh-keys"
                  className="mw-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '6px 12px', textDecoration: 'none' }}
                >
                  <KeyRound size={13} /> Go to SSH Keys Management
                </Link>
              </div>
            )}

            {!keysLoading && !keysError && sshKeys.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                <label className="xs-label">
                  Registered SSH Public Key
                  <select
                    className="xs-input"
                    value={selectedKey?.id ?? ''}
                    onChange={(e) => setSelectedKeyId(e.target.value)}
                  >
                    {sshKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} ({k.key_type}) · {k.fingerprint.slice(0, 20)}...
                      </option>
                    ))}
                  </select>
                </label>

                <label className="xs-label">
                  Local private key file path (optional)
                  <input
                    type="text"
                    className="xs-input xs-mono"
                    placeholder={`Suggested: ${suggestedKeyPath}`}
                    value={customKeyPath}
                    onChange={(e) => setCustomKeyPath(e.target.value)}
                    autoComplete="off"
                    spellCheck="false"
                  />
                </label>
              </div>
            )}

            {/* SSH Connection Command */}
            <div>
              <label className="xs-label" style={{ display: 'block', marginBottom: 6 }}>
                SSH Connection Command
              </label>
              <div className="xs-code" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', flex: 1 }}>
                  <Terminal size={15} style={{ color: 'var(--brand-hi, #22c55e)', flexShrink: 0 }} />
                  <code style={{ fontSize: '0.84rem', wordBreak: 'break-all' }}>{sshCmd}</code>
                </div>
                <button
                  type="button"
                  className="mw-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.78rem', flexShrink: 0 }}
                  onClick={() => copy(sshCmd, flash, 'SSH command copied to clipboard.')}
                >
                  <Copy size={13} />
                  <span>Copy Command</span>
                </button>
              </div>
            </div>

            {/* Ingress Gateway Notice & Link */}
            <div style={{
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={16} style={{ color: 'var(--brand-hi, #22c55e)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--ink-2, #a1a1aa)' }}>
                  {sshKeys.length > 0 && selectedKey ? (
                    <>Paired with <strong style={{ color: 'var(--ink, #fff)' }}>{selectedKey.name}</strong> (<span className="xs-mono">{selectedKey.fingerprint.slice(0, 24)}...</span>). Port 2222 simulated ingress.</>
                  ) : (
                    <>Uses credentials managed in your <strong style={{ color: 'var(--ink, #fff)' }}>SSH Keys</strong> vault. Add your public key there first.</>
                  )}
                </span>
              </div>
              <Link to="/dashboard/ssh-keys" className="mw-link-btn" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                Manage SSH Keys →
              </Link>
            </div>
          </div>
        </div>

        {/* ═══════════════ SECTION 3: JUPYTERLAB ENVIRONMENT ═══════════════ */}
        <div className="mw-panel" style={{ width: '100%' }}>
          <div className="mw-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Laptop size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0 }}>JupyterLab Environment</h3>
                  <span style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--ink-2, #d4d4d8)'
                  }}>
                    untitled.ipynb
                  </span>
                </div>
                <span className="mw-muted" style={{ fontSize: '0.82rem' }}>
                  Active session: <strong style={{ color: 'var(--ink, #fff)' }}>{selectedNotebook?.name ?? (sel?.name ?? 'Interactive Instance')}</strong> ({selectedNotebook?.gpu_profile ?? (sel?.gpu ?? 'L4')}) · Interactive Python Kernel
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 600,
                background: isServerRunning ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                color: isServerRunning ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3, #71717a)',
                border: `1px solid ${isServerRunning ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`
              }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: isServerRunning ? 'var(--brand-hi, #22c55e)' : '#71717a',
                  boxShadow: isServerRunning ? '0 0 8px var(--brand-hi, #22c55e)' : 'none'
                }} />
                {isServerRunning ? 'Active' : 'Stopped'}
              </span>

              {selectedNotebook ? (
                selectedNotebook.status === 'running' ? (
                  <button
                    type="button"
                    className="mw-secondary"
                    disabled={actionLoadingId === selectedNotebook.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 14px' }}
                    onClick={() => handleStopNotebook(selectedNotebook.id)}
                  >
                    <Power size={14} />
                    <span>{actionLoadingId === selectedNotebook.id ? 'Stopping...' : 'Stop JupyterLab'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mw-primary"
                    disabled={actionLoadingId === selectedNotebook.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 14px' }}
                    onClick={() => handleStartNotebook(selectedNotebook.id)}
                  >
                    <Power size={14} />
                    <span>{actionLoadingId === selectedNotebook.id ? 'Starting...' : 'Launch JupyterLab'}</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className={serverUp ? 'mw-secondary' : 'mw-primary'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 14px' }}
                  onClick={() => {
                    setServerUp((v) => !v)
                    flash(serverUp ? 'JupyterLab stopped (demo).' : 'JupyterLab server started successfully.')
                  }}
                >
                  <Power size={14} />
                  <span>{serverUp ? 'Stop JupyterLab' : 'Launch JupyterLab'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="xs-stack" style={{ gap: 16 }}>
            {/* Server URL with Copy Button */}
            <div>
              <label className="xs-label" style={{ display: 'block', marginBottom: 6 }}>
                JupyterLab Server URL
              </label>
              <div className="xs-code" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', flex: 1 }}>
                  <KeyRound size={15} style={{ color: isServerRunning ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3)', flexShrink: 0 }} />
                  <code style={{ fontSize: '0.84rem', color: isServerRunning ? 'var(--ink)' : 'var(--ink-3)', wordBreak: 'break-all' }}>
                    {isServerRunning ? `${jupyterUrl} (Simulated Ingress)` : 'Server is stopped. Click "Launch JupyterLab" above to boot kernel and generate session token.'}
                  </code>
                </div>
                {isServerRunning && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="mw-secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.78rem' }}
                      onClick={() => copy(jupyterUrl, flash, 'JupyterLab URL copied to clipboard.')}
                    >
                      <Copy size={13} />
                      <span>Copy URL</span>
                    </button>
                  </div>
                )}
              </div>
              <small className="mw-muted" style={{ fontSize: '0.71rem', display: 'block', marginTop: 4 }}>
                Note: In Stage 2B simulation, no container process is bound to host ports. Token is cryptographically hashed with SHA-256 on the backend.
              </small>
            </div>
          </div>
        </div>

        {/* ═══════════════ SECTION 4: RUNTIME MONITORING (TEAMMATE WORK PRESERVED) ═══════════════ */}
        <div className="mw-panel" style={{ width: '100%' }}>
          <div className="mw-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Activity size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
              <div>
                <h3 style={{ margin: 0 }}>Runtime Monitoring</h3>
                <span className="mw-muted" style={{ fontSize: '0.82rem' }}>
                  Resource utilization tracking & live hardware telemetry for <strong style={{ color: 'var(--ink)' }}>{selectedNotebook?.name ?? (sel?.name ?? 'Active GPU')}</strong>
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: '0.72rem',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                color: 'var(--ink-2, #a1a1aa)'
              }}>
                <Clock size={12} /> Last probe: {lastUpdated}
              </span>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--ink-2, #a1a1aa)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  style={{ accentColor: 'var(--brand-hi, #22c55e)' }}
                />
                Auto-poll (5s)
              </label>

              <button
                type="button"
                className="mw-secondary"
                disabled={isRefreshing}
                onClick={handleManualRefresh}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.78rem' }}
              >
                <RotateCw size={13} className={isRefreshing ? 'spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="xs-stack" style={{ gap: 20 }}>
            {/* Telemetry Metric Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 14
            }}>
              {/* Utilization Card */}
              <div style={{
                padding: '14px 16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-3, #71717a)', fontWeight: 600 }}>GPU UTILIZATION</span>
                  <Cpu size={15} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--ink, #fff)' }}>
                    {currentUtilization}%
                  </span>
                  {pulseCount > 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--brand-hi, #22c55e)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <TrendingUp size={11} /> +26% kernel pulse
                    </span>
                  )}
                </div>
                <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.06)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${currentUtilization}%`,
                    height: '100%',
                    background: currentUtilization > 85 ? '#ef4444' : 'var(--brand-hi, #22c55e)',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
              </div>

              {/* Memory Allocation Card */}
              <div style={{
                padding: '14px 16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-3, #71717a)', fontWeight: 600 }}>VRAM ALLOCATION</span>
                  <Layers size={15} style={{ color: '#38bdf8' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--ink, #fff)' }}>
                    {currentUsedVram}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--ink-3, #71717a)', fontFamily: 'var(--font-mono)' }}>
                    / {totalVramGb} GB ({vramUtilizationPct}%)
                  </span>
                </div>
                <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.06)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${vramUtilizationPct}%`,
                    height: '100%',
                    background: '#38bdf8',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-3, #71717a)' }}>
                  {currentFreeVram} GB headroom remaining
                </span>
              </div>

              {/* Temperature Card */}
              <div style={{
                padding: '14px 16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-3, #71717a)', fontWeight: 600 }}>TEMPERATURE</span>
                  <Thermometer size={15} style={{ color: currentTemp > 75 ? '#ef4444' : '#f59e0b' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{
                    fontSize: '1.6rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    color: currentTemp > 75 ? '#ef4444' : 'var(--ink, #fff)'
                  }}>
                    {currentTemp}°C
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#10b981' }}>Nominal Thermal Range</span>
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-3, #71717a)' }}>
                  Throttle threshold: 84°C
                </span>
              </div>

              {/* Power Draw Card */}
              <div style={{
                padding: '14px 16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-3, #71717a)', fontWeight: 600 }}>POWER CONSUMPTION</span>
                  <Zap size={15} style={{ color: '#eab308' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--ink, #fff)' }}>
                    {currentPower}W
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-3, #71717a)' }}>
                    / {totalVramGb >= 80 ? '700W' : '250W'} TDP
                  </span>
                </div>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-3, #71717a)' }}>
                  Sovereign Tier-IV PUE verified
                </span>
              </div>
            </div>

            {/* Time-Series Charts Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 16
            }}>
              {/* Utilization Chart */}
              <div style={{
                padding: '16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Gauge size={14} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                    <strong style={{ fontSize: '0.82rem' }}>Compute Utilization History (15m)</strong>
                  </div>
                  <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--brand-hi, #22c55e)' }}>
                    Current: {currentUtilization}%
                  </span>
                </div>
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                    {[0, 25, 50, 75, 100].map((val) => {
                      const y = padT + (1 - val / 100) * usableH
                      return (
                        <g key={val}>
                          <line
                            x1={padL}
                            y1={y}
                            x2={padL + usableW}
                            y2={y}
                            stroke="rgba(255, 255, 255, 0.06)"
                            strokeDasharray={val === 50 ? '3 3' : 'none'}
                          />
                          <text
                            x={padL - 6}
                            y={y + 3}
                            fill="var(--ink-4, #52525b)"
                            fontSize="9"
                            textAnchor="end"
                            fontFamily="var(--font-mono)"
                          >
                            {val}%
                          </text>
                        </g>
                      )
                    })}
                    <defs>
                      <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path d={utilAreaD} fill="url(#utilGrad)" />
                    <path d={utilPathD} fill="none" stroke="#22c55e" strokeWidth="2" />
                    {utilPoints.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={idx === utilPoints.length - 1 ? 4 : 2}
                        fill={idx === utilPoints.length - 1 ? '#22c55e' : 'rgba(34, 197, 94, 0.6)'}
                      />
                    ))}
                    {historyData.map((d, i) => {
                      if (i % 3 !== 0 && i !== historyData.length - 1) return null
                      const x = padL + (i / (historyData.length - 1)) * usableW
                      return (
                        <text
                          key={i}
                          x={x}
                          y={chartH - 6}
                          fill="var(--ink-4, #52525b)"
                          fontSize="9"
                          textAnchor="middle"
                          fontFamily="var(--font-mono)"
                        >
                          {d.t}
                        </text>
                      )
                    })}
                  </svg>
                </div>
              </div>

              {/* Memory Chart */}
              <div style={{
                padding: '16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Layers size={14} style={{ color: '#38bdf8' }} />
                    <strong style={{ fontSize: '0.82rem' }}>VRAM Allocation History (15m)</strong>
                  </div>
                  <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>
                    Allocated: {currentUsedVram} GB
                  </span>
                </div>
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                    {[0, totalVramGb / 2, totalVramGb].map((val) => {
                      const y = padT + (1 - val / totalVramGb) * usableH
                      return (
                        <g key={val}>
                          <line
                            x1={padL}
                            y1={y}
                            x2={padL + usableW}
                            y2={y}
                            stroke="rgba(255, 255, 255, 0.06)"
                          />
                          <text
                            x={padL - 6}
                            y={y + 3}
                            fill="var(--ink-4, #52525b)"
                            fontSize="9"
                            textAnchor="end"
                            fontFamily="var(--font-mono)"
                          >
                            {Math.round(val)}G
                          </text>
                        </g>
                      )
                    })}
                    <defs>
                      <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path d={memAreaD} fill="url(#memGrad)" />
                    <path d={memPathD} fill="none" stroke="#38bdf8" strokeWidth="2" />
                    {memPoints.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={idx === memPoints.length - 1 ? 4 : 2}
                        fill={idx === memPoints.length - 1 ? '#38bdf8' : 'rgba(56, 189, 248, 0.6)'}
                      />
                    ))}
                    {historyData.map((d, i) => {
                      if (i % 3 !== 0 && i !== historyData.length - 1) return null
                      const x = padL + (i / (historyData.length - 1)) * usableW
                      return (
                        <text
                          key={i}
                          x={x}
                          y={chartH - 6}
                          fill="var(--ink-4, #52525b)"
                          fontSize="9"
                          textAnchor="middle"
                          fontFamily="var(--font-mono)"
                        >
                          {d.t}
                        </text>
                      )
                    })}
                  </svg>
                </div>
              </div>
            </div>

            {/* AI Assistant Contextual Optimization Audit Trigger */}
            <div style={{
              padding: '12px 16px',
              background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.08), rgba(56, 189, 248, 0.05))',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Sparkles size={18} style={{ color: 'var(--brand-hi, #22c55e)', flexShrink: 0 }} />
                <div>
                  <strong style={{ fontSize: '0.84rem', color: 'var(--ink, #fff)' }}>
                    Inferxe AI Copilot: Resource Headroom Detected
                  </strong>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ink-2, #a1a1aa)' }}>
                    Current batch latency is within 14ms margins. Run a contextual telemetry audit to check spot vs on-demand arbitrage.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="mw-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '6px 14px' }}
                onClick={handleRunAudit}
                disabled={auditDone}
              >
                {auditDone ? (
                  <>
                    <CheckCircle2 size={13} />
                    <span>Audit Logged</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    <span>Run Optimization Audit</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ═══════════════ SECTION 5: INFERXE BOT ACCESS & PRIVACY BOUNDARIES ═══════════════ */}
        <div className="mw-panel" style={{ width: '100%' }}>
          <div className="mw-panel-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
              <div>
                <h3 style={{ margin: 0 }}>Inferxe Bot Access & Monitoring Permissions</h3>
                <span className="mw-muted" style={{ fontSize: '0.82rem' }}>Configure automated optimization agents</span>
              </div>
            </div>
          </div>
          <div className="xs-stack" style={{ gap: 14 }}>
            <p className="mw-muted" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.5 }}>
              When enabled, the autonomous Inferxe monitor inspects hardware telemetry (GPU load, memory pressure, runtime quota) to recommend rightsizing or notify you when a session needs attention.
            </p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
              borderRadius: 8
            }}>
              <label className="mw-toggle-label" style={{ margin: 0, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={botAccess}
                  onChange={(e) => {
                    setBotAccess(e.target.checked)
                    write(KEYS.notebookBot, e.target.checked)
                    flash(e.target.checked ? 'Inferxe Bot monitoring enabled.' : 'Inferxe Bot monitoring revoked.')
                  }}
                  style={{ accentColor: 'var(--brand-hi, #22c55e)' }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 500 }}>
                  Allow Inferxe bot to poll telemetry metadata
                </span>
              </label>
              <span style={{
                fontSize: '0.74rem',
                padding: '2px 8px',
                borderRadius: 4,
                background: botAccess ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                color: botAccess ? 'var(--brand-hi, #22c55e)' : 'var(--ink-4, #71717a)',
                border: `1px solid ${botAccess ? 'rgba(34, 197, 94, 0.25)' : 'var(--line, rgba(255, 255, 255, 0.08))'}`
              }}>
                {botAccess ? 'Agent Active · Read-Only' : 'Agent Access Disabled'}
              </span>
            </div>

            {/* Restricted Privacy Boundaries Notice Card (Preserved Teammate Work) */}
            <div style={{
              padding: '12px 14px',
              background: 'rgba(239, 68, 68, 0.03)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              borderRadius: 8
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f87171', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
                <ShieldCheck size={15} /> Restricted Privacy Boundaries
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--ink-2, #a1a1aa)', lineHeight: 1.6 }}>
                <li>Cannot inspect notebook code cells, outputs, or markdown text</li>
                <li>Zero access to disk storage, SSH keys, or environment secrets</li>
                <li>Cannot execute commands, install packages, or modify state</li>
              </ul>
            </div>
          </div>
        </div>

        {/* ═══════════════ SECTION 6: INTERACTIVE NOTEBOOK PLAYGROUND ═══════════════ */}
        <div className="mw-panel" style={{ width: '100%' }}>
          <div className="mw-panel-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Laptop size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
              <div>
                <h3 style={{ margin: 0 }}>Interactive Playground · untitled.ipynb</h3>
                <span className="mw-muted" style={{ fontSize: '0.82rem' }}>
                  Simulated kernel · {selectedNotebook?.gpu_profile ?? (sel ? `NVIDIA ${sel.gpu}` : 'L4')}
                </span>
              </div>
            </div>
          </div>
          <div className="xs-stack" style={{ gap: 14 }}>
            <div style={{ fontSize: '0.73rem', color: 'var(--ink-4)', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px' }}>
              Note: This interactive playground executes in a simulated client-side kernel for verifying code syntax and endpoints. Live execution requires an attached container session.
            </div>
            {cells.map((c) => (
              <div className="xs-cell" key={c.id}>
                <div className="xs-cell__bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--brand-hi, #22c55e)' }}>
                      In [{c.id}]
                    </span>
                    <span className="mw-muted" style={{ fontSize: '0.72rem' }}>Python 3 (ipykernel)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="mw-secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: '0.75rem' }}
                      onClick={() => runCell(c.id)}
                      title="Run code cell (spikes telemetry monitor)"
                    >
                      <Play size={12} style={{ color: 'var(--brand-hi, #22c55e)' }} /> Run (Simulated)
                    </button>
                  </div>
                </div>
                <textarea
                  className="xs-input xs-mono"
                  rows={Math.max(2, c.code.split('\n').length)}
                  value={c.code}
                  onChange={(e) => setCells((cs) => cs.map((x) => (x.id === c.id ? { ...x, code: e.target.value } : x)))}
                  placeholder="# Enter Python code..."
                />
                {c.out && (
                  <pre className="xs-out">
                    {c.out}
                  </pre>
                )}
              </div>
            ))}
            <div>
              <button
                type="button"
                className="mw-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: '0.82rem' }}
                onClick={() => setCells((cs) => [...cs, { id: Math.max(0, ...cs.map((c) => c.id)) + 1, code: '', out: '' }])}
              >
                <Plus size={14} /> Add Cell
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════ CREATE NOTEBOOK MODAL ═══════════════ */}
      {showCreateModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="mw-modal-head">
              <h3>Create Notebook Session</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateNotebook}>
              <div className="mw-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label className="xs-label">
                  Session Name
                  <input
                    type="text"
                    required
                    className="xs-input"
                    placeholder="e.g. qwen-finetune-sandbox"
                    value={newNbName}
                    onChange={(e) => setNewNbName(e.target.value)}
                  />
                </label>
                <label className="xs-label">
                  GPU Profile / Tier
                  <select
                    className="xs-input"
                    value={newNbProfile}
                    onChange={(e) => setNewNbProfile(e.target.value)}
                  >
                    <option value="NVIDIA L4">NVIDIA L4 (24 GB VRAM · Sovereign Tier-IV)</option>
                    <option value="NVIDIA L40S">NVIDIA L40S (48 GB VRAM · Training & High-Throughput)</option>
                    <option value="NVIDIA A100">NVIDIA A100 (80 GB VRAM · Enterprise Compute)</option>
                    <option value="NVIDIA H100">NVIDIA H100 (80 GB SXM5 · Frontier LLM)</option>
                    <option value="CPU Standard">CPU Standard (8 vCPU · 32 GB RAM · Dev Sandbox)</option>
                  </select>
                </label>
                <label className="xs-label">
                  Bind Registered SSH Public Key (optional)
                  <select
                    className="xs-input"
                    value={newNbSshKeyId}
                    onChange={(e) => setNewNbSshKeyId(e.target.value)}
                  >
                    <option value="">(None — connect via simulated gateway)</option>
                    {sshKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} ({k.key_type}) · {k.fingerprint.slice(0, 18)}...
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ fontSize: '0.73rem', color: 'var(--ink-4)', background: 'var(--bg-3)', padding: '8px 10px', borderRadius: 6 }}>
                  Session access tokens are cryptographically hashed upon creation and never stored in plaintext.
                </div>
              </div>
              <div className="mw-modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button type="button" className="mw-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="mw-primary" disabled={creatingNb}>
                  {creatingNb ? 'Provisioning...' : 'Provision Notebook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}


/* ═══════════════ 3. ONE API · MANY PROVIDERS ═══════════════ */

const PROVIDER_MARKET = [
  { name: 'E2E Networks', city: 'Noida', gpus: ['L4', 'L40S', 'A100', 'H100'], l4: 58, l40s: 98, h100: 270, latency: 38 },
  { name: 'Yotta', city: 'Mumbai', gpus: ['L40S', 'H100', 'H200'], l4: 62, l40s: 100, h100: 275, latency: 22 },
  { name: 'Cyfuture', city: 'Delhi', gpus: ['L4', 'A100'], l4: 55, l40s: 104, h100: 290, latency: 41 },
  { name: 'Tata Communications', city: 'Pune', gpus: ['A100', 'H100'], l4: 66, l40s: 110, h100: 282, latency: 30 },
  { name: 'Sify', city: 'Chennai', gpus: ['L4', 'L40S'], l4: 60, l40s: 99, h100: 295, latency: 35 },
  { name: 'NxtGen', city: 'Hyderabad', gpus: ['L40S', 'H100'], l4: 64, l40s: 96, h100: 268, latency: 28 },
]

export function ProvidersSection({ flash }: { flash: Flash }) {
  const [gpu, setGpu] = useState<'l4' | 'l40s' | 'h100'>('l40s')
  const ranked = useMemo(() => [...PROVIDER_MARKET].filter((p) => p.gpus.includes(gpu === 'l4' ? 'L4' : gpu === 'l40s' ? 'L40S' : 'H100')).sort((a, b) => a[gpu] - b[gpu]), [gpu])
  const best = ranked[0]
  const snippet = `curl https://api.inferxe.com/v1/chat/completions \\
  -H "Authorization: Bearer $INFERXE_API_KEY" \\
  -d '{"model":"llama-3.1-8b","gpu":"${gpu.toUpperCase()}","routing":"cheapest"}'`

  return (
    <>
      <div className="mw-toolbar">
        <div>
          <h2>One API · Many Providers</h2>
          <p>A single marketplace across Indian GPU providers. One API key — Inferxe routes to the best provider for cost and latency.</p>
        </div>
      </div>

      <div className="mw-stat-grid">
        <div className="mw-metric"><div className="mw-metric-top"><span>Providers connected</span><span className="mw-icon-box"><Network /></span></div><strong>{PROVIDER_MARKET.length}</strong><small>Sample network</small></div>
        <div className="mw-metric"><div className="mw-metric-top"><span>Cheapest {gpu.toUpperCase()}</span><span className="mw-icon-box"><Globe /></span></div><strong>{best ? inr(best[gpu]) + '/hr' : '—'}</strong><small>{best?.name} · {best?.city}</small></div>
        <div className="mw-metric"><div className="mw-metric-top"><span>Lowest latency</span><span className="mw-icon-box"><Timer /></span></div><strong>{Math.min(...PROVIDER_MARKET.map((p) => p.latency))} ms</strong><small>Mumbai region</small></div>
      </div>

      <div className="mw-panel">
        <div className="mw-panel-head">
          <h3>Compare providers</h3>
          <div className="row" style={{ gap: 6 }}>
            {(['l4', 'l40s', 'h100'] as const).map((g) => (
              <button key={g} className={`mw-filter-pill ${gpu === g ? 'is-active' : ''}`} onClick={() => setGpu(g)}>{g.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div className="mw-table-wrap">
          <table className="mw-table">
            <thead><tr><th>Provider</th><th>Region</th><th>GPUs</th><th>{gpu.toUpperCase()} ₹/hr</th><th>Latency</th></tr></thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr key={p.name}>
                  <td><strong>{p.name}</strong>{i === 0 && <small style={{ color: 'var(--brand-hi)' }}> best price</small>}</td>
                  <td>{p.city}, IN</td>
                  <td>{p.gpus.join(' · ')}</td>
                  <td>{inr(p[gpu])}</td>
                  <td>{p.latency} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mw-panel">
        <div className="mw-panel-head"><h3>Same request, any provider</h3></div>
        <div className="xs-stack">
          <pre className="xs-out">{snippet}</pre>
          <div><button className="mw-secondary" onClick={() => copy(snippet, flash, 'Request copied.')}><Copy size={13} /> Copy request</button></div>
        </div>
      </div>
    </>
  )
}

/* ═══════════════ 4. REWARDS · REFERRALS · CREATOR TRIAL ═══════════════ */

const CREATOR_CODES: Record<string, string> = { YOUTUBE1HR: 'YouTube creator', CREATOR1HR: 'Creator partner', REACH1HR: 'Promotion partner' }

export function RewardsSection({
  userName,
  flash,
  onGrantTrial,
}: {
  userName: string
  flash: Flash
  onGrantTrial: () => void
}) {
  const refCode = useMemo(() => 'REF-' + userName.replace(/[^a-z]/gi, '').slice(0, 5).toUpperCase().padEnd(5, 'X') + '15', [userName])
  const refLink = `${window.location.origin}/signup?ref=${refCode}`
  const [invited, setInvited] = useState<number>(() => read(KEYS.referrals, 0))
  const [creator, setCreator] = useState('')
  const [redeemed, setRedeemed] = useState<string | null>(() => read<string | null>(KEYS.creatorRedeemed, null))

  const redeem = () => {
    const code = creator.trim().toUpperCase()
    if (redeemed) return flash('A creator code was already redeemed on this account.')
    if (!CREATOR_CODES[code]) return flash('Invalid creator code. Try YOUTUBE1HR.')
    setRedeemed(code)
    write(KEYS.creatorRedeemed, code)
    onGrantTrial()
    flash(`${CREATOR_CODES[code]} code accepted — 1-hour trial started!`)
  }

  const simulateInvite = () => {
    const n = invited + 1
    setInvited(n)
    write(KEYS.referrals, n)
    flash('Demo friend joined with your link. Discount credit added.')
  }

  const earned = Math.min(invited * 5, 30)

  return (
    <>
      <div className="mw-toolbar">
        <div>
          <h2>Rewards & Discounts</h2>
          <p>Refer friends, earn checkout discounts, and redeem creator codes for a 1-hour trial.</p>
        </div>
      </div>

      <div className="mw-stat-grid">
        <div className="mw-metric"><div className="mw-metric-top"><span>Friends joined</span><span className="mw-icon-box"><Share2 /></span></div><strong>{invited}</strong><small>Demo counter</small></div>
        <div className="mw-metric"><div className="mw-metric-top"><span>Referral discount earned</span><span className="mw-icon-box"><Gift /></span></div><strong>{earned}%</strong><small>5% per friend, max 30%</small></div>
      </div>

      <div className="mw-two-col">
        <div className="mw-panel">
          <div className="mw-panel-head"><h3>Your referral</h3></div>
          <div className="xs-stack">
            <div className="xs-code"><code>{refLink}</code><button className="mw-link-btn" onClick={() => copy(refLink, flash, 'Referral link copied.')}><Copy size={13} /></button></div>
            <p className="mw-muted">Friends get <b>FRIEND15</b> (15% off) at checkout. You earn 5% for every friend that joins.</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="mw-secondary" onClick={() => copy(refCode, flash, 'Referral code copied.')}>Copy code {refCode}</button>
              <button className="mw-secondary" onClick={simulateInvite}>Simulate friend joining</button>
            </div>
          </div>
        </div>

        <div className="mw-panel">
          <div className="mw-panel-head"><h3>Creator & YouTuber trial</h3><Youtube size={16} /></div>
          <div className="xs-stack">
            <p className="mw-muted">Content creators can promote Inferxe with a 1-hour free trial. Enter a creator code to start it.</p>
            <input className="xs-input" placeholder="e.g. YOUTUBE1HR" value={creator} onChange={(e) => setCreator(e.target.value)} />
            <div><button className="mw-primary" onClick={redeem} disabled={!!redeemed}>{redeemed ? `Redeemed: ${redeemed}` : 'Redeem code'}</button></div>
          </div>
        </div>
      </div>

      <div className="mw-panel">
        <div className="mw-panel-head"><h3>Available coupon codes</h3><span className="mw-muted">Apply at Checkout</span></div>
        <div className="mw-table-wrap">
          <table className="mw-table">
            <thead><tr><th>Code</th><th>Benefit</th><th>Type</th></tr></thead>
            <tbody>
              <tr><td><strong>INFERXE10</strong></td><td>10% off</td><td>Standard</td></tr>
              <tr><td><strong>LAUNCH50</strong></td><td>₹500 off</td><td>Launch</td></tr>
              <tr><td><strong>FRIEND15</strong></td><td>15% off</td><td>Referral (friend of a user)</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ═══════════════ 5. USAGE DETAIL (models, temps, graph, time left) ═══════════════ */

function fmtMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}

export function UsageDetail({
  deployments,
  walletBalance,
  trialTimeLeft,
}: {
  deployments: ExtraDeployment[]
  walletBalance: number
  trialTimeLeft: number | null
}) {
  const running = deployments.filter((d) => d.status === 'Running')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [])

  // Deterministic-ish wobble so temperatures look live without randomness drifting
  const tempOf = (id: string) => {
    const base = 52 + (id.charCodeAt(id.length - 1) % 14)
    return Math.round(base + Math.sin(tick / 2 + id.length) * 4)
  }

  const burn = running.reduce((sum, d) => sum + (d.hourlyRate ?? 0), 0)
  const walletHours = burn > 0 ? walletBalance / burn : null

  // 24 hourly points for the usage graph (sum of running deployments, deterministic)
  const points = Array.from({ length: 24 }, (_, i) =>
    Math.round(30 + 25 * Math.sin(i / 3.2) + 12 * Math.cos(i / 1.7) + running.length * 6),
  )
  const max = Math.max(...points, 1)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / 23) * 100},${100 - (p / max) * 90}`).join(' ')

  return (
    <>
      <div className="mw-stat-grid">
        <div className="mw-metric">
          <div className="mw-metric-top"><span>Running models</span><span className="mw-icon-box"><Play /></span></div>
          <strong>{running.length}</strong><small>{deployments.length} total deployments</small>
        </div>
        <div className="mw-metric">
          <div className="mw-metric-top"><span>Wallet time left</span><span className="mw-icon-box"><Timer /></span></div>
          <strong>{walletHours === null ? '—' : fmtMs(walletHours * 3600000)}</strong><small>{inr(walletBalance)} at {inr(burn)}/hr burn</small>
        </div>
        <div className="mw-metric">
          <div className="mw-metric-top"><span>Free trial left</span><span className="mw-icon-box"><Timer /></span></div>
          <strong>{trialTimeLeft === null ? 'Not started' : trialTimeLeft > 0 ? fmtMs(trialTimeLeft) : 'Expired'}</strong><small>1-hour sandbox</small>
        </div>
      </div>

      <div className="mw-two-col">
        <div className="mw-panel">
          <div className="mw-panel-head"><h3>Existing models & GPU temperature</h3><Thermometer size={16} /></div>
          {running.length === 0 && <p className="mw-muted" style={{ padding: 16 }}>No running models.</p>}
          <div className="xs-stack">
            {running.map((d) => {
              const t = tempOf(d.id)
              return (
                <div className="mw-progress-row" key={d.id}>
                  <div><span>{d.model} · {d.gpu}</span><strong style={{ color: t > 70 ? 'var(--amber)' : 'var(--brand-hi)' }}>{t}°C</strong></div>
                  <div className="mw-progress"><span style={{ width: `${Math.min(100, t)}%` }} /></div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mw-panel">
          <div className="mw-panel-head"><h3>GPU usage · last 24h</h3><span className="mw-muted">% utilization</span></div>
          <svg className="xs-graph" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="GPU usage over 24 hours">
            <path d={`${path} L100,100 L0,100 Z`} className="xs-graph__fill" />
            <path d={path} className="xs-graph__line" />
          </svg>
          <div className="xs-graph__axis"><span>24h ago</span><span>12h</span><span>now</span></div>
        </div>
      </div>
    </>
  )
}
