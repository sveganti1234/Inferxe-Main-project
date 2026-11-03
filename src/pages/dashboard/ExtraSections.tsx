import { useEffect, useMemo, useState } from 'react'
import {
  Bot, Copy, Gift, Globe, KeyRound, Network, Play, Share2, Star, Terminal, Thermometer, Timer, Youtube,
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

export function NotebooksSection({ deployments, flash }: { deployments: ExtraDeployment[]; flash: Flash }) {
  const running = deployments.filter((d) => d.status === 'Running')
  const [selId, setSelId] = useState(running[0]?.id ?? '')
  const sel = running.find((d) => d.id === selId) ?? running[0]
  const [botAccess, setBotAccess] = useState<boolean>(() => read(KEYS.notebookBot, false))
  const [cells, setCells] = useState<Cell[]>(() => read(KEYS.notebookCells, DEFAULT_CELLS))
  const [serverUp, setServerUp] = useState(false)

  useEffect(() => write(KEYS.notebookCells, cells), [cells])

  const token = useMemo(() => 'ixnb_' + (sel?.id ?? 'none').replace(/\W/g, '').slice(0, 10) + '7f3a9c', [sel?.id])
  const host = sel ? `${sel.id}.${sel.region.split(',')[0].toLowerCase().replace(/\s+/g, '')}.nodes.inferxe.com` : 'no-running-deployment'
  const jupyterUrl = `https://${host}/lab?token=${token}`
  const sshCmd = `ssh -i ~/.ssh/id_ed25519 -p 2222 ubuntu@${host}`

  const runCell = (id: number) =>
    setCells((cs) => cs.map((c) => (c.id === id ? { ...c, out: fakeRun(c.code, sel ? `NVIDIA ${sel.gpu}` : 'no GPU') } : c)))

  return (
    <>
      <div className="mw-toolbar">
        <div>
          <h2>Notebooks & SSH Access</h2>
          <p>Open JupyterLab or SSH into a running GPU. Optionally give the Inferxe bot access so it can recommend or notify you about GPUs and your wallet.</p>
        </div>
      </div>

      {running.length === 0 ? (
        <div className="mw-panel"><p className="mw-muted" style={{ padding: 16 }}>No running deployments. Start one from the GPU Marketplace to open a notebook.</p></div>
      ) : (
        <>
          <div className="mw-two-col">
            <div className="mw-panel">
              <div className="mw-panel-head"><h3>Connect</h3><span className="mw-muted">Secure Shell + JupyterLab</span></div>
              <div className="xs-stack">
                <label className="xs-label">GPU instance
                  <select className="xs-input" value={sel?.id} onChange={(e) => { setSelId(e.target.value); setServerUp(false) }}>
                    {running.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.gpu} · {d.region}</option>)}
                  </select>
                </label>

                <div className="xs-code"><Terminal size={14} /> <code>{sshCmd}</code>
                  <button className="mw-link-btn" onClick={() => copy(sshCmd, flash, 'SSH command copied.')}><Copy size={13} /></button>
                </div>
                <small className="mw-muted">Uses the keys from <b>SSH Keys</b>. Add your public key there first.</small>

                <div className="xs-code"><KeyRound size={14} /> <code>{serverUp ? jupyterUrl : 'JupyterLab server is stopped'}</code>
                  {serverUp && <button className="mw-link-btn" onClick={() => copy(jupyterUrl, flash, 'JupyterLab URL copied.')}><Copy size={13} /></button>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="mw-primary" onClick={() => { setServerUp((v) => !v); flash(serverUp ? 'JupyterLab stopped (demo).' : 'JupyterLab started (demo).') }}>
                    {serverUp ? 'Stop JupyterLab' : 'Launch JupyterLab'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head"><h3>Inferxe bot access</h3><Bot size={16} /></div>
              <div className="xs-stack">
                <p className="mw-muted">
                  When enabled, the Inferxe bot can read this notebook's metadata (GPU, memory use, runtime left) to recommend a better GPU or notify you
                  when a GPU or your wallet needs attention. It cannot run code or read your files.
                </p>
                <label className="mw-toggle-label">
                  <input
                    type="checkbox"
                    checked={botAccess}
                    onChange={(e) => { setBotAccess(e.target.checked); write(KEYS.notebookBot, e.target.checked); flash(e.target.checked ? 'Bot access enabled for notebooks.' : 'Bot access revoked.') }}
                  />
                  <span>Allow Inferxe bot to monitor my notebook</span>
                </label>
                <small className="mw-muted">Access for: <b>you</b> (full) · <b>Inferxe bot</b> ({botAccess ? 'read-only' : 'off'})</small>
              </div>
            </div>
          </div>

          <div className="mw-panel">
            <div className="mw-panel-head"><h3>Notebook · untitled.ipynb</h3><span className="mw-muted">Demo kernel · {sel?.gpu}</span></div>
            <div className="xs-stack">
              {cells.map((c) => (
                <div className="xs-cell" key={c.id}>
                  <div className="xs-cell__bar">
                    <span>In [{c.id}]</span>
                    <button className="mw-secondary" onClick={() => runCell(c.id)}><Play size={13} /> Run</button>
                  </div>
                  <textarea
                    className="xs-input xs-mono"
                    rows={Math.max(2, c.code.split('\n').length)}
                    value={c.code}
                    onChange={(e) => setCells((cs) => cs.map((x) => (x.id === c.id ? { ...x, code: e.target.value } : x)))}
                  />
                  {c.out && <pre className="xs-out">{c.out}</pre>}
                </div>
              ))}
              <div>
                <button className="mw-secondary" onClick={() => setCells((cs) => [...cs, { id: Math.max(0, ...cs.map((c) => c.id)) + 1, code: '', out: '' }])}>
                  + Add cell
                </button>
              </div>
            </div>
          </div>
        </>
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
