import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  ExternalLink,
  Gauge,
  Gift,
  Globe,
  KeyRound,
  Laptop,
  Layers,
  Network,
  Play,
  Plus,
  Power,
  RotateCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Thermometer,
  Timer,
  TrendingDown,
  TrendingUp,
  Youtube,
  Zap,
} from 'lucide-react'

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

  // Stage 2: Runtime Monitoring State
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('15:30:12 UTC')
  const [pulseCount, setPulseCount] = useState(0)
  const [auditDone, setAuditDone] = useState(false)

  useEffect(() => write(KEYS.notebookCells, cells), [cells])

  const token = useMemo(() => 'ixnb_' + (sel?.id ?? 'none').replace(/\W/g, '').slice(0, 10) + '7f3a9c', [sel?.id])
  const host = sel ? `${sel.id}.${sel.region.split(',')[0].toLowerCase().replace(/\s+/g, '')}.nodes.inferxe.com` : 'no-running-deployment'
  const jupyterUrl = `https://${host}/lab?token=${token}`
  const sshCmd = `ssh -i ~/.ssh/id_ed25519 -p 2222 ubuntu@${host}`

  // Hardware telemetry specs based on selected GPU
  const totalVramGb = useMemo(() => {
    if (!sel) return 24.0
    if (sel.gpu.includes('H100')) return 80.0
    if (sel.gpu.includes('L40S')) return 48.0
    if (sel.gpu.includes('A100')) return 80.0
    return 24.0
  }, [sel])

  const isInstanceRunning = sel?.status === 'Running'

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
      cs.map((c) => (c.id === id ? { ...c, out: fakeRun(c.code, sel ? `NVIDIA ${sel.gpu}` : 'no GPU') } : c))
    )
    setPulseCount((c) => c + 1)
    setTimeout(() => setPulseCount(0), 3000)
  }

  // Trigger contextual optimization audit
  const handleRunAudit = () => {
    setAuditDone(true)
    const notifItem = {
      title: `AI Assistant GPU Audit: NVIDIA ${sel?.gpu}`,
      detail: `Telemetry confirmed optimal headroom for FP16 inference. Consider spot pricing to save ~₹18/hr.`,
      type: 'AI Optimization',
    }
    if (addNotification) {
      addNotification(notifItem)
    }
    // Also dispatch to backend API if available
    try {
      fetch('/api/gpu/alerts/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: sel?.id || 'dep-1042',
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
      {running.length === 0 ? (
        <div className="mw-panel" style={{ padding: 24, textAlign: 'center' }}>
          <Laptop size={32} style={{ color: 'var(--brand-hi, #22c55e)', margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 8px' }}>No Active GPU Deployments</h3>
          <p className="mw-muted" style={{ maxWidth: 500, margin: '0 auto 16px', fontSize: '0.9rem' }}>
            To launch a JupyterLab environment or monitor GPU runtime telemetry, you need an active GPU instance.
          </p>
          <Link to="/dashboard/gpus" className="mw-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <Terminal size={14} /> Deploy a GPU in Marketplace
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
          {/* ═══════════════ SECTION 1: GPU INSTANCE CONNECTION (STAGE 1 PRESERVED) ═══════════════ */}
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
                background: sel ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: sel ? 'var(--brand-hi, #22c55e)' : '#ef4444',
                border: `1px solid ${sel ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
              }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: sel ? 'var(--brand-hi, #22c55e)' : '#ef4444',
                  boxShadow: sel ? '0 0 8px var(--brand-hi, #22c55e)' : 'none'
                }} />
                {sel ? 'SSH Ready · Online' : 'Offline'}
              </span>
            </div>

            <div className="xs-stack" style={{ gap: 16 }}>
              {/* Dropdown & Active Instance Details */}
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
                    className="mw-secondary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.78rem', flexShrink: 0 }}
                    onClick={() => copy(sshCmd, flash, 'SSH command copied to clipboard.')}
                  >
                    <Copy size={13} />
                    <span>Copy Command</span>
                  </button>
                </div>
              </div>

              {/* SSH Key Information */}
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
                    Uses credentials managed in your <strong style={{ color: 'var(--ink, #fff)' }}>SSH Keys</strong> vault (<code style={{ fontSize: '0.78rem' }}>~/.ssh/id_ed25519</code> default). Add your public key there first.
                  </span>
                </div>
                <Link to="/dashboard/ssh-keys" className="mw-link-btn" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  Manage SSH Keys →
                </Link>
              </div>
            </div>
          </div>

          {/* ═══════════════ SECTION 2: JUPYTERLAB ENVIRONMENT (STAGE 1 PRESERVED) ═══════════════ */}
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
                    Active instance: <strong style={{ color: 'var(--ink, #fff)' }}>{sel?.name}</strong> ({sel?.gpu}) · Interactive Python Kernel
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
                  background: serverUp ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                  color: serverUp ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3, #71717a)',
                  border: `1px solid ${serverUp ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`
                }}>
                  <span style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: serverUp ? 'var(--brand-hi, #22c55e)' : '#71717a',
                    boxShadow: serverUp ? '0 0 8px var(--brand-hi, #22c55e)' : 'none'
                  }} />
                  {serverUp ? 'Active' : 'Stopped'}
                </span>

                <button
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
                    <KeyRound size={15} style={{ color: serverUp ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3)', flexShrink: 0 }} />
                    <code style={{ fontSize: '0.84rem', color: serverUp ? 'var(--ink)' : 'var(--ink-3)', wordBreak: 'break-all' }}>
                      {serverUp ? jupyterUrl : 'Server is stopped. Click "Launch JupyterLab" above to boot kernel and generate session token.'}
                    </code>
                  </div>
                  {serverUp && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <button
                        className="mw-secondary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.78rem' }}
                        onClick={() => copy(jupyterUrl, flash, 'JupyterLab URL copied to clipboard.')}
                      >
                        <Copy size={13} />
                        <span>Copy URL</span>
                      </button>
                      <a
                        href={jupyterUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mw-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.78rem', textDecoration: 'none' }}
                      >
                        <ExternalLink size={13} />
                        <span>Open Web UI</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Code Cells */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                          className="mw-secondary"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: '0.75rem' }}
                          onClick={() => runCell(c.id)}
                          title="Run code cell (spikes telemetry monitor)"
                        >
                          <Play size={12} style={{ color: 'var(--brand-hi, #22c55e)' }} /> Run
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
              </div>

              {/* Add Cell Button & Guidance */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
                <button
                  className="mw-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: '0.82rem' }}
                  onClick={() => setCells((cs) => [...cs, { id: Math.max(0, ...cs.map((c) => c.id)) + 1, code: '', out: '' }])}
                >
                  <Plus size={14} /> Add Cell
                </button>
                <span className="mw-muted" style={{ fontSize: '0.78rem' }}>
                  Execution updates live telemetry and resource monitors in Section 3 below.
                </span>
              </div>
            </div>
          </div>

          {/* ═══════════════ SECTION 3: RUNTIME MONITORING (STAGE 2 NEW DEDICATED SECTION) ═══════════════ */}
          <div className="mw-panel" style={{ width: '100%' }}>
            {/* Panel Header */}
            <div className="mw-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Activity size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                <div>
                  <h3 style={{ margin: 0 }}>Runtime Monitoring</h3>
                  <span className="mw-muted" style={{ fontSize: '0.82rem' }}>
                    Resource utilization tracking & live hardware telemetry for <strong style={{ color: 'var(--ink)' }}>{sel?.name}</strong>
                  </span>
                </div>
              </div>

              {/* Refresh Controls & Live Status Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: isInstanceRunning ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  color: isInstanceRunning ? 'var(--brand-hi, #22c55e)' : '#ef4444',
                  border: `1px solid ${isInstanceRunning ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}>
                  <span style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: isInstanceRunning ? 'var(--brand-hi, #22c55e)' : '#ef4444',
                    boxShadow: isInstanceRunning ? '0 0 8px var(--brand-hi, #22c55e)' : 'none'
                  }} />
                  {isInstanceRunning ? 'Telemetry Streaming · 5s Polling' : 'Instance Stopped · Telemetry Idle'}
                </span>

                <button
                  type="button"
                  className="mw-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    fontSize: '0.76rem',
                    background: autoRefresh ? 'rgba(34, 197, 94, 0.08)' : 'transparent',
                    borderColor: autoRefresh ? 'rgba(34, 197, 94, 0.25)' : 'var(--line)',
                    color: autoRefresh ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3)'
                  }}
                  onClick={() => setAutoRefresh((v) => !v)}
                  title="Toggle 5-second automatic telemetry polling"
                >
                  <Clock size={12} />
                  <span>Auto-Refresh: {autoRefresh ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  className="mw-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', fontSize: '0.76rem' }}
                  onClick={handleManualRefresh}
                  title="Fetch immediate telemetry snapshot"
                >
                  <RotateCw size={12} style={{ transform: isRefreshing ? 'rotate(180deg)' : 'none', transition: 'transform 0.4s ease' }} />
                  <span>Refresh Metrics</span>
                </button>
              </div>
            </div>

            <div className="xs-stack" style={{ gap: 16 }}>
              {/* Telemetry Architecture & Hardware Probe Disclosure */}
              <div style={{
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.06))',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: '0.78rem',
                color: 'var(--ink-3)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Cpu size={14} style={{ color: isInstanceRunning ? 'var(--brand-hi, #22c55e)' : '#ef4444' }} />
                  <span>
                    Hardware Telemetry Probe: <strong style={{ color: isInstanceRunning ? 'var(--ink)' : '#ef4444' }}>
                      {isInstanceRunning ? 'Connected · NVIDIA Driver 550.54 · CUDA 12.4' : 'Offline (Instance Stopped)'}
                    </strong>
                  </span>
                </div>
                <div>
                  Last Polled: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{lastUpdated}</span>
                </div>
              </div>

              {/* ── 4 Top Metrics Cards ── */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: 14
              }}>
                {/* Metric A: GPU Utilization */}
                <div style={{
                  padding: '14px 16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      GPU Utilization
                    </span>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: isInstanceRunning ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      color: isInstanceRunning ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3)',
                      border: `1px solid ${isInstanceRunning ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255, 255, 255, 0.1)'}`
                    }}>
                      {isInstanceRunning ? (currentUtilization > 70 ? 'High Compute' : 'Optimal Load') : 'Unavailable'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isInstanceRunning ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {isInstanceRunning ? `${currentUtilization}%` : '—'}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>compute core load</span>
                  </div>

                  {/* Visual Progress Bar */}
                  <div style={{ width: '100%', height: 7, borderRadius: 999, background: 'rgba(255, 255, 255, 0.06)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${currentUtilization}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #10b981, #22c55e)',
                      transition: 'width 0.5s ease',
                      boxShadow: '0 0 10px rgba(34, 197, 94, 0.4)'
                    }} />
                  </div>

                  <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)', marginTop: 2 }}>
                    NVIDIA {sel?.gpu} · {sel?.name}
                  </span>
                </div>

                {/* Metric B: GPU Memory Usage */}
                <div style={{
                  padding: '14px 16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      GPU Memory Usage
                    </span>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: isInstanceRunning ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      color: isInstanceRunning ? '#06b6d4' : 'var(--ink-3)',
                      border: `1px solid ${isInstanceRunning ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.1)'}`
                    }}>
                      {isInstanceRunning ? `${vramUtilizationPct}% Used` : 'Unavailable'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isInstanceRunning ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {isInstanceRunning ? `${currentUsedVram} GB` : '—'}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>/ {totalVramGb} GB total</span>
                  </div>

                  {/* Segmented Progress Bar */}
                  <div style={{ width: '100%', height: 7, borderRadius: 999, background: 'rgba(255, 255, 255, 0.06)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${vramUtilizationPct}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #06b6d4, #10b981)',
                      transition: 'width 0.5s ease',
                      boxShadow: '0 0 10px rgba(6, 182, 212, 0.4)'
                    }} />
                  </div>

                  <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)', marginTop: 2 }}>
                    {isInstanceRunning ? `${currentFreeVram} GB available headroom` : 'VRAM offline'}
                  </span>
                </div>

                {/* Metric C: Runtime Information */}
                <div style={{
                  padding: '14px 16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Runtime & Status
                    </span>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: serverUp ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                      color: serverUp ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3)'
                    }}>
                      JupyterLab: {serverUp ? 'Active' : 'Stopped'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                      14h 28m
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>current uptime</span>
                  </div>

                  <div style={{ fontSize: '0.76rem', color: 'var(--ink-2)', display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    <div>Instance Status: <strong style={{ color: isInstanceRunning ? 'var(--brand-hi, #22c55e)' : '#ef4444' }}>{sel?.status}</strong></div>
                    <div>Datacenter: <span style={{ color: 'var(--ink)' }}>{sel?.region}</span></div>
                  </div>
                </div>

                {/* Metric D: Thermal & Power Efficiency */}
                <div style={{
                  padding: '14px 16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Thermal & Power
                    </span>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: 'rgba(34, 197, 94, 0.12)',
                      color: 'var(--brand-hi, #22c55e)'
                    }}>
                      Optimal Window
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isInstanceRunning ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {isInstanceRunning ? `${currentTemp}°C` : '—'}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>/ Max 85°C</span>
                  </div>

                  <div style={{ fontSize: '0.76rem', color: 'var(--ink-2)', display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                    <div>Power Draw: <strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{isInstanceRunning ? `${currentPower}W` : '0W'}</strong> / 250W TDP</div>
                    <div>Bus Interface: <span style={{ color: 'var(--ink-3)' }}>PCIe Gen4 x16 · 31.5 GB/s</span></div>
                  </div>
                </div>
              </div>

              {/* ── Visual Charts: GPU Compute & Memory Allocation History ── */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: 16,
                marginTop: 6
              }}>
                {/* Chart 1: GPU Utilization History */}
                <div style={{
                  padding: '14px 16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Activity size={15} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                      <strong style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>GPU Compute Utilization (%)</strong>
                    </div>
                    <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--brand-hi, #22c55e)' }}>
                      Current: {currentUtilization}%
                    </span>
                  </div>

                  <div style={{ width: '100%', overflowX: 'auto' }}>
                    <svg
                      viewBox={`0 0 ${chartW} ${chartH}`}
                      style={{ width: '100%', height: 140, display: 'block' }}
                    >
                      <defs>
                        <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Grid Lines & Labels */}
                      {[100, 75, 50, 25, 0].map((val) => {
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

                      {/* Area Fill & Line */}
                      {isInstanceRunning && (
                        <>
                          <path d={utilAreaD} fill="url(#utilGrad)" />
                          <path d={utilPathD} fill="none" stroke="var(--brand-hi, #22c55e)" strokeWidth="2.2" strokeLinecap="round" />
                          {utilPoints.map((p, idx) => (
                            <circle
                              key={idx}
                              cx={p.x}
                              cy={p.y}
                              r={idx === utilPoints.length - 1 ? 4 : 2.5}
                              fill={idx === utilPoints.length - 1 ? '#22c55e' : 'var(--bg, #0a0a0a)'}
                              stroke="var(--brand-hi, #22c55e)"
                              strokeWidth={idx === utilPoints.length - 1 ? 2.5 : 1.5}
                            />
                          ))}
                        </>
                      )}

                      {/* X Axis Time Labels */}
                      {historyData.map((d, idx) => {
                        if (idx % 2 !== 0 && idx !== historyData.length - 1) return null
                        const x = padL + (idx / (historyData.length - 1)) * usableW
                        return (
                          <text
                            key={idx}
                            x={x}
                            y={chartH - 6}
                            fill="var(--ink-4, #71717a)"
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                    <span>Target Compute Window: 30% – 75%</span>
                    <span>Historical Time Interval: 15 mins</span>
                  </div>
                </div>

                {/* Chart 2: GPU Memory Allocation History */}
                <div style={{
                  padding: '14px 16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Layers size={15} style={{ color: '#06b6d4' }} />
                      <strong style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>GPU Memory Allocation (GB)</strong>
                    </div>
                    <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: '#06b6d4' }}>
                      Used: {currentUsedVram} GB / {totalVramGb} GB
                    </span>
                  </div>

                  <div style={{ width: '100%', overflowX: 'auto' }}>
                    <svg
                      viewBox={`0 0 ${chartW} ${chartH}`}
                      style={{ width: '100%', height: 140, display: 'block' }}
                    >
                      <defs>
                        <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Memory Grid Lines & Labels */}
                      {[totalVramGb, totalVramGb * 0.75, totalVramGb * 0.5, totalVramGb * 0.25, 0].map((val, idx) => {
                        const y = padT + (1 - val / totalVramGb) * usableH
                        return (
                          <g key={idx}>
                            <line
                              x1={padL}
                              y1={y}
                              x2={padL + usableW}
                              y2={y}
                              stroke="rgba(255, 255, 255, 0.06)"
                              strokeDasharray={val === totalVramGb * 0.75 ? '3 3' : 'none'}
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

                      {/* Memory Threshold Warning Line at 85% */}
                      <line
                        x1={padL}
                        y1={padT + (1 - 0.85) * usableH}
                        x2={padL + usableW}
                        y2={padT + (1 - 0.85) * usableH}
                        stroke="rgba(239, 68, 68, 0.3)"
                        strokeDasharray="2 2"
                      />

                      {/* Area Fill & Line */}
                      {isInstanceRunning && (
                        <>
                          <path d={memAreaD} fill="url(#memGrad)" />
                          <path d={memPathD} fill="none" stroke="#06b6d4" strokeWidth="2.2" strokeLinecap="round" />
                          {memPoints.map((p, idx) => (
                            <circle
                              key={idx}
                              cx={p.x}
                              cy={p.y}
                              r={idx === memPoints.length - 1 ? 4 : 2.5}
                              fill={idx === memPoints.length - 1 ? '#06b6d4' : 'var(--bg, #0a0a0a)'}
                              stroke="#06b6d4"
                              strokeWidth={idx === memPoints.length - 1 ? 2.5 : 1.5}
                            />
                          ))}
                        </>
                      )}

                      {/* X Axis Time Labels */}
                      {historyData.map((d, idx) => {
                        if (idx % 2 !== 0 && idx !== historyData.length - 1) return null
                        const x = padL + (idx / (historyData.length - 1)) * usableW
                        return (
                          <text
                            key={idx}
                            x={x}
                            y={chartH - 6}
                            fill="var(--ink-4, #71717a)"
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                    <span>VRAM Warning Threshold: 85% ({Number((totalVramGb * 0.85).toFixed(1))} GB)</span>
                    <span>Free Headroom: {currentFreeVram} GB</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════ SECTION 4: INFERXE AI ASSISTANT ACCESS & INTELLIGENCE (STAGE 2 ENHANCED) ═══════════════ */}
          <div className="mw-panel" style={{ width: '100%' }}>
            <div className="mw-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bot size={18} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                <div>
                  <h3 style={{ margin: 0 }}>Inferxe AI Assistant Access & Intelligence</h3>
                  <span className="mw-muted" style={{ fontSize: '0.82rem' }}>Autonomous resource analysis, intelligent recommendations & proactive cost alerting</span>
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
                background: botAccess ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                color: botAccess ? 'var(--brand-hi, #22c55e)' : 'var(--ink-3, #71717a)',
                border: `1px solid ${botAccess ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`
              }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: botAccess ? 'var(--brand-hi, #22c55e)' : '#71717a',
                  boxShadow: botAccess ? '0 0 8px var(--brand-hi, #22c55e)' : 'none'
                }} />
                {botAccess ? 'Telemetry Connected · Recommendations Active' : 'Access Revoked · Analysis Paused'}
              </span>
            </div>

            <div className="xs-stack" style={{ gap: 18 }}>
              <p className="mw-muted" style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
                When enabled, the Inferxe AI Assistant analyzes real-time compute telemetry, memory consumption patterns, and pricing data to identify bottlenecks, rightsizing opportunities, and cost savings.
              </p>

              {/* Enable / Disable Checkbox Toggle & Permission Status */}
              <div style={{
                padding: '14px 18px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap'
              }}>
                <label className="mw-toggle-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={botAccess}
                    onChange={(e) => {
                      setBotAccess(e.target.checked)
                      write(KEYS.notebookBot, e.target.checked)
                      flash(e.target.checked ? 'AI Assistant access enabled for Developer Workspace.' : 'AI Assistant access revoked.')
                    }}
                    style={{ width: 17, height: 17, accentColor: 'var(--brand-hi, #22c55e)', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--ink, #fff)' }}>
                      Allow Inferxe AI Assistant to inspect workspace telemetry & health metrics
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-3, #71717a)' }}>
                      Grants read-only access to GPU compute telemetry. Strictly isolated from source code, credentials, and dataset files.
                    </div>
                  </div>
                </label>

                <div style={{ fontSize: '0.8rem', color: 'var(--ink-2, #a1a1aa)', whiteSpace: 'nowrap' }}>
                  Permission Status: <strong style={{ color: botAccess ? 'var(--brand-hi, #22c55e)' : '#ef4444' }}>
                    {botAccess ? 'Read-Only Telemetry' : 'Disabled'}
                  </strong>
                </div>
              </div>

              {/* Conditional AI Intelligence Panel based on botAccess */}
              {!botAccess ? (
                /* Permission Disabled Warning Notice */
                <div style={{
                  padding: '16px 18px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px dashed var(--line-2, rgba(255, 255, 255, 0.12))',
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14
                }}>
                  <AlertTriangle size={24} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--ink)' }}>
                      AI Recommendations Paused: Assistant Telemetry Permission Revoked
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-3)', marginTop: 2 }}>
                      The Inferxe AI Assistant does not collect or process telemetry while permissions are disabled. Enable the checkbox above to generate personalized hardware recommendations and workload analysis.
                    </div>
                  </div>
                </div>
              ) : (
                /* Permission Active: Full AI Intelligence Suite */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Part A: Autonomous Resource Analysis */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Sparkles size={15} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                      <strong style={{ fontSize: '0.86rem', color: 'var(--ink)' }}>Autonomous Resource Analysis</strong>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 12
                    }}>
                      <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border, rgba(255, 255, 255, 0.06))', borderRadius: 8 }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>Workload Profile</span>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--brand-hi, #22c55e)', marginTop: 4 }}>
                          Interactive FP16 Inference
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>Balanced batch token serving</span>
                      </div>

                      <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border, rgba(255, 255, 255, 0.06))', borderRadius: 8 }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>Compute Utilization</span>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
                          Average 48% (Optimal Load)
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>Consistent within safe thermal envelope</span>
                      </div>

                      <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border, rgba(255, 255, 255, 0.06))', borderRadius: 8 }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>Memory Headroom</span>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#06b6d4', marginTop: 4 }}>
                          {currentFreeVram} GB Free Headroom
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>Zero VRAM swapping or page thrash</span>
                      </div>

                      <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border, rgba(255, 255, 255, 0.06))', borderRadius: 8 }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>Bottleneck Check</span>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--brand-hi, #22c55e)', marginTop: 4 }}>
                          Zero Bottlenecks Detected
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>PCIe bus and thermals normal (41°C)</span>
                      </div>
                    </div>
                  </div>

                  {/* Part B: Intelligent GPU Recommendations */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Gauge size={15} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                      <strong style={{ fontSize: '0.86rem', color: 'var(--ink)' }}>Intelligent GPU Recommendations</strong>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Rec 1: Workload Suitability */}
                      <div style={{
                        padding: '12px 16px',
                        background: 'rgba(34, 197, 94, 0.03)',
                        border: '1px solid rgba(34, 197, 94, 0.16)',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12
                      }}>
                        <CheckCircle2 size={18} style={{ color: 'var(--brand-hi, #22c55e)', marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <strong style={{ fontSize: '0.86rem', color: 'var(--ink)' }}>Current {sel?.gpu} is well-suited for your active model</strong>
                            <span style={{ fontSize: '0.72rem', background: 'rgba(34, 197, 94, 0.15)', color: 'var(--brand-hi, #22c55e)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                              Optimal Match
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                            Your active workload ({sel?.model || 'Qwen2.5 7B'}) runs within 35% VRAM ({currentUsedVram} GB). P95 latency and token throughput are well within target SLAs.
                          </p>
                        </div>
                      </div>

                      {/* Rec 2: Rightsizing / Cost Optimization */}
                      <div style={{
                        padding: '12px 16px',
                        background: 'rgba(6, 182, 212, 0.03)',
                        border: '1px solid rgba(6, 182, 212, 0.18)',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12
                      }}>
                        <TrendingDown size={18} style={{ color: '#06b6d4', marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <strong style={{ fontSize: '0.86rem', color: 'var(--ink)' }}>Cost Optimization: Consider Spot Pricing during idle intervals</strong>
                            <span style={{ fontSize: '0.72rem', background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                              Save ~₹18/hr (-30%)
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                            Average compute load drops during notebook text editing. Switching to an on-demand L4 Spot tier (₹42/hr vs ₹60/hr standard) reduces hourly burn without sacrificing VRAM or throughput.
                          </p>
                        </div>
                      </div>

                      {/* Rec 3: High-Memory Scaling Guidance */}
                      <div style={{
                        padding: '12px 16px',
                        background: 'rgba(245, 158, 11, 0.03)',
                        border: '1px solid rgba(245, 158, 11, 0.18)',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12
                      }}>
                        <TrendingUp size={18} style={{ color: '#f59e0b', marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <strong style={{ fontSize: '0.86rem', color: 'var(--ink)' }}>Scaling Roadmap: Upgrade to L40S or H100 if expanding context</strong>
                            <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                              Scale-Up Path
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                            If expanding context length beyond 32k tokens or upgrading to 14B-32B weights, upgrade to NVIDIA L40S (48GB, ₹100/hr) or NVIDIA H100 (80GB, ₹270/hr) to avoid out-of-memory bottlenecks.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Part C: Comparative Hardware Tiers */}
                  <div style={{
                    padding: '14px',
                    background: 'rgba(255, 255, 255, 0.015)',
                    border: '1px solid var(--border, rgba(255, 255, 255, 0.06))',
                    borderRadius: 8
                  }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--ink-3)', display: 'block', marginBottom: 10 }}>
                      Hardware Tier Price & Memory Comparison
                    </span>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 10
                    }}>
                      {[
                        { tier: 'Current Tier', gpu: `NVIDIA ${sel?.gpu}`, vram: `${totalVramGb} GB VRAM`, price: '₹60/hr', badge: 'Active Match', highlight: true },
                        { tier: 'Spot Instance', gpu: `NVIDIA ${sel?.gpu} Spot`, vram: `${totalVramGb} GB VRAM`, price: '₹42/hr', badge: 'Save 30%', highlight: false },
                        { tier: 'High Memory', gpu: 'NVIDIA L40S', vram: '48 GB VRAM', price: '₹100/hr', badge: '2x Capacity', highlight: false },
                        { tier: 'Frontier Compute', gpu: 'NVIDIA H100', vram: '80 GB VRAM', price: '₹270/hr', badge: 'Max Throughput', highlight: false },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '10px 12px',
                            background: item.highlight ? 'rgba(34, 197, 94, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${item.highlight ? 'rgba(34, 197, 94, 0.3)' : 'var(--border, rgba(255, 255, 255, 0.06))'}`,
                            borderRadius: 6,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>{item.tier}</span>
                            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: item.highlight ? 'var(--brand-hi, #22c55e)' : 'var(--ink-2)' }}>
                              {item.badge}
                            </span>
                          </div>
                          <strong style={{ fontSize: '0.82rem', color: 'var(--ink)' }}>{item.gpu}</strong>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--ink-2)', marginTop: 2 }}>
                            <span>{item.vram}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: item.highlight ? 'var(--brand-hi, #22c55e)' : 'var(--ink)' }}>{item.price}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Part D: Contextual Alert Feed & Audit Trigger */}
                  <div style={{
                    padding: '12px 14px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Zap size={16} style={{ color: 'var(--brand-hi, #22c55e)' }} />
                      <div style={{ fontSize: '0.8rem', color: 'var(--ink-2)' }}>
                        Telemetry Status: <strong style={{ color: 'var(--ink)' }}>All systems nominal · Zero memory or compute bottleneck alerts</strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="mw-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '6px 14px' }}
                      onClick={handleRunAudit}
                    >
                      <Sparkles size={13} />
                      <span>{auditDone ? 'Re-run Optimization Audit' : 'Run Optimization Audit'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Metadata Access vs Restricted Boundaries (Stage 1 Preserved) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 14,
                marginTop: 2
              }}>
                <div style={{
                  padding: '12px 14px',
                  background: 'rgba(34, 197, 94, 0.03)',
                  border: '1px solid rgba(34, 197, 94, 0.15)',
                  borderRadius: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--brand-hi, #22c55e)', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>
                    <CheckCircle2 size={15} /> Accessible Metadata & Telemetry
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--ink-2, #a1a1aa)', lineHeight: 1.6 }}>
                    <li>GPU device model, VRAM allocation, and operating temperature</li>
                    <li>Active instance ID, datacenter region, and uptime counter</li>
                    <li>Prepaid compute consumption rate and wallet balance alerts</li>
                  </ul>
                </div>

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
