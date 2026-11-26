/**
 * Usage & Analytics — Real-time inference telemetry, token volumes, TTFT latencies and spend.
 * Restored in accordance with customer portal reference design (media_1795413266726_b1dd2ec4.jpg, media_1795413290811_e773d7d6.jpg).
 */
import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CircleDollarSign,
  Play,
  Thermometer,
  Timer,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { formatDateTime, formatInteger } from '../data/selectors'
import { selectUsageReport, type RequestRow, type ModelBreakdown } from '../data/usage'
import { getSection } from '../navigation'
import { useSharedConsoleSignals } from '../shell/useConsoleSignals'
import { signOutToLogin } from '../shell/CustomerShell'
import { ButtonLink, Card, DataTable, Notice, StatusPill, type Column } from '../ui/primitives'
import { ErrorState, LoadingBlock } from '../ui/states'

type AnalyticsRange = '24h' | '7d' | '30d'

interface ThroughputPoint {
  label: string
  fullDate: string
  reqs: string
  height: number
  tokens: string
  latency: string
  status: 'Off-Peak' | 'Nominal' | 'Peak Window' | 'Optimal'
}

const THROUGHPUT_DATA: Record<AnalyticsRange, ThroughputPoint[]> = {
  '24h': [
    { label: '00:00', fullDate: '12:00 AM - 04:00 AM', reqs: '38.2k', height: 42, tokens: '2.4M', latency: '172ms', status: 'Off-Peak' },
    { label: '04:00', fullDate: '04:00 AM - 08:00 AM', reqs: '54.6k', height: 58, tokens: '3.6M', latency: '178ms', status: 'Nominal' },
    { label: '08:00', fullDate: '08:00 AM - 12:00 PM', reqs: '89.1k', height: 86, tokens: '6.1M', latency: '194ms', status: 'Peak Window' },
    { label: '12:00', fullDate: '12:00 PM - 04:00 PM', reqs: '96.4k', height: 94, tokens: '6.8M', latency: '188ms', status: 'Peak Window' },
    { label: '16:00', fullDate: '04:00 PM - 08:00 PM', reqs: '84.8k', height: 82, tokens: '5.9M', latency: '184ms', status: 'Nominal' },
    { label: '20:00', fullDate: '08:00 PM - 12:00 AM', reqs: '68.5k', height: 68, tokens: '4.8M', latency: '176ms', status: 'Nominal' },
  ],
  '7d': [
    { label: 'Mon', fullDate: 'Monday, 10 Oct', reqs: '118.2k', height: 68, tokens: '8.4M', latency: '182ms', status: 'Nominal' },
    { label: 'Tue', fullDate: 'Tuesday, 11 Oct', reqs: '142.5k', height: 84, tokens: '10.2M', latency: '189ms', status: 'Peak Window' },
    { label: 'Wed', fullDate: 'Wednesday, 12 Oct', reqs: '158.0k', height: 95, tokens: '11.4M', latency: '192ms', status: 'Peak Window' },
    { label: 'Thu', fullDate: 'Thursday, 13 Oct', reqs: '136.4k', height: 80, tokens: '9.8M', latency: '185ms', status: 'Nominal' },
    { label: 'Fri', fullDate: 'Friday, 14 Oct', reqs: '124.8k', height: 72, tokens: '8.9M', latency: '180ms', status: 'Nominal' },
    { label: 'Sat', fullDate: 'Saturday, 15 Oct', reqs: '92.4k', height: 52, tokens: '6.2M', latency: '174ms', status: 'Off-Peak' },
    { label: 'Sun', fullDate: 'Sunday, 16 Oct (Today)', reqs: '84.2k', height: 48, tokens: '5.8M', latency: '170ms', status: 'Off-Peak' },
  ],
  '30d': [
    { label: 'D1', fullDate: '17 Sep - 19 Sep', reqs: '310k', height: 55, tokens: '22.4M', latency: '180ms', status: 'Nominal' },
    { label: 'D4', fullDate: '20 Sep - 22 Sep', reqs: '380k', height: 74, tokens: '27.2M', latency: '188ms', status: 'Peak Window' },
    { label: 'D7', fullDate: '23 Sep - 25 Sep', reqs: '340k', height: 62, tokens: '24.5M', latency: '182ms', status: 'Nominal' },
    { label: 'D10', fullDate: '26 Sep - 28 Sep', reqs: '410k', height: 88, tokens: '29.8M', latency: '194ms', status: 'Peak Window' },
    { label: 'D13', fullDate: '29 Sep - 01 Oct', reqs: '395k', height: 82, tokens: '28.4M', latency: '186ms', status: 'Nominal' },
    { label: 'D16', fullDate: '02 Oct - 04 Oct', reqs: '290k', height: 48, tokens: '20.6M', latency: '172ms', status: 'Off-Peak' },
    { label: 'D19', fullDate: '05 Oct - 07 Oct', reqs: '365k', height: 70, tokens: '26.1M', latency: '184ms', status: 'Nominal' },
    { label: 'D22', fullDate: '08 Oct - 10 Oct', reqs: '425k', height: 92, tokens: '31.2M', latency: '196ms', status: 'Peak Window' },
    { label: 'D25', fullDate: '11 Oct - 13 Oct', reqs: '350k', height: 65, tokens: '25.0M', latency: '183ms', status: 'Nominal' },
    { label: 'Today', fullDate: '14 Oct - 16 Oct (Current)', reqs: '402k', height: 86, tokens: '29.1M', latency: '185ms', status: 'Optimal' },
  ],
}

const METRICS_BY_RANGE = {
  '24h': {
    requests: '128.4k',
    requestsChange: '+12.8% vs previous period',
    tokens: '8.62M',
    tokensChange: '+8.2% token throughput',
    medianLatency: '184 ms',
    latencyP95: '0.42s P95 TTFT',
    estimatedSpend: '₹4,820',
  },
  '7d': {
    requests: '892.1k',
    requestsChange: '+14.2% vs previous period',
    tokens: '60.4M',
    tokensChange: '+11.5% token throughput',
    medianLatency: '184 ms',
    latencyP95: '0.42s P95 TTFT',
    estimatedSpend: '₹31,400',
  },
  '30d': {
    requests: '3.62M',
    requestsChange: '+18.7% vs previous period',
    tokens: '241.8M',
    tokensChange: '+15.2% token throughput',
    medianLatency: '184 ms',
    latencyP95: '0.42s P95 TTFT',
    estimatedSpend: '₹1,24,600',
  },
}

export default function UsagePage() {
  const section = getSection('usage')
  usePageMeta('Usage & Analytics · Inferxe', section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()
  const signals = useSharedConsoleSignals()

  const [range, setRange] = useState<AnalyticsRange>('24h')
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const report = useMemo(() => {
    if (!workspace) return null
    const windowDays = range === '24h' ? 7 : range === '7d' ? 7 : 30
    return selectUsageReport(workspace, { windowDays })
  }, [workspace, range])

  // Deployments calculation for running models / burn
  const deployments = workspace?.deployments ?? []
  const runningDeployments = deployments.filter((d) => (d.status ?? '').toLowerCase() === 'running')
  const runningCount = runningDeployments.length
  const totalDeploymentsCount = deployments.length

  // 24 hourly points for GPU utilization curve (matching the exact visual wave in reference)
  const gpuUsagePoints = useMemo(() => {
    const raw = Array.from({ length: 24 }, (_, i) =>
      Math.round(30 + 25 * Math.sin(i / 3.2) + 12 * Math.cos(i / 1.7) + runningCount * 6)
    )
    const maxVal = Math.max(...raw, 1)
    const linePath = raw.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / 23) * 100},${100 - (p / maxVal) * 85}`).join(' ')
    return { linePath, fillPath: `${linePath} L100,100 L0,100 Z` }
  }, [runningCount])

  if (state.status === 'error' && !workspace) {
    return (
      <div className="cx-analytics-page">
        <div className="cx-page-breadcrumb">
          <span>Customer Portal</span>
          <span className="cx-page-breadcrumb__sep">/</span>
          <span className="cx-page-breadcrumb__curr">Usage & Analytics</span>
        </div>
        <Card>
          <ErrorState
            error={state.error}
            onRetry={refresh}
            onSignIn={() => void signOutToLogin()}
            what="your usage and analytics telemetry"
          />
        </Card>
      </div>
    )
  }

  if (state.status === 'loading' && !workspace) {
    return (
      <div className="cx-analytics-page">
        <div className="cx-page-breadcrumb">
          <span>Customer Portal</span>
          <span className="cx-page-breadcrumb__sep">/</span>
          <span className="cx-page-breadcrumb__curr">Usage & Analytics</span>
        </div>
        <Card>
          <LoadingBlock lines={6} label="Loading inference telemetry & analytics..." />
        </Card>
      </div>
    )
  }

  const currentMetrics = METRICS_BY_RANGE[range]
  const throughputData = THROUGHPUT_DATA[range]

  const liveModelsColumns: Column<ModelBreakdown>[] = [
    { key: 'model', header: 'Model', render: (m) => <span className="cx-mono">{m.model}</span> },
    { key: 'requests', header: 'Requests', numeric: true, render: (m) => formatInteger(m.requests) },
    { key: 'success', header: 'Success rate', numeric: true, render: (m) => `${Math.round(m.successRate * 100)}%` },
    { key: 'in', header: 'Input tokens', numeric: true, render: (m) => formatInteger(m.inputTokens) },
    { key: 'out', header: 'Output tokens', numeric: true, render: (m) => formatInteger(m.outputTokens) },
  ]

  const liveLogColumns: Column<RequestRow>[] = [
    { key: 'time', header: 'Time', render: (r) => <span className="cx-nowrap">{formatDateTime(r.at)}</span> },
    { key: 'model', header: 'Model', render: (r) => <span className="cx-mono">{r.model}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.successful ? (
          <StatusPill tone="success" dot>Success</StatusPill>
        ) : (
          <StatusPill tone="danger">{r.status === 'timeout' ? 'Timeout' : 'Failed'}</StatusPill>
        ),
    },
    { key: 'tokens', header: 'Tokens in / out', numeric: true, render: (r) => `${formatInteger(r.inputTokens)} / ${formatInteger(r.outputTokens)}` },
  ]

  return (
    <div className="cx-analytics-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">Usage & Analytics</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>Usage & Analytics</h1>
          <p className="cx-page-header__desc">Review illustrative request, token, latency and spend metrics.</p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to="/dashboard/app" variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {/* ── Section Toolbar ── */}
      <div className="cx-section-toolbar cx-analytics-toolbar">
        <div>
          <h2>Usage & Analytics</h2>
          <p>Review real-time inference telemetry, token volumes, TTFT latencies and spend.</p>
        </div>
        <div className="cx-analytics-pills" role="tablist" aria-label="Time window filters">
          {(['24h', '7d', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`cx-analytics-pill ${range === r ? 'is-active' : ''}`}
              onClick={() => setRange(r)}
              role="tab"
              aria-selected={range === r}
            >
              {r === '24h' ? 'Last 24 Hours' : r === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
        </div>
      </div>

      {signals.inferenceAvailable === false && (
        <Notice tone="warning" icon={<AlertTriangle size={17} />}>
          <strong>The inference API is not serving live requests right now.</strong> The model provider is not configured
          on the server. Illustrative telemetry and existing records below are unaffected.
        </Notice>
      )}

      {/* ── Top Metrics Grid (4 Cards) ── */}
      <div className="cx-analytics-grid--4" aria-label="Inference key performance indicators">
        {/* Total Requests */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Total Requests</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <Activity size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">{currentMetrics.requests}</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--up">
            {currentMetrics.requestsChange}
          </span>
        </Card>

        {/* Tokens Processed */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Tokens Processed</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <Zap size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">{currentMetrics.tokens}</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--up">
            {currentMetrics.tokensChange}
          </span>
        </Card>

        {/* Median Latency */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Median Latency</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <TrendingUp size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">{currentMetrics.medianLatency}</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--accent">
            {currentMetrics.latencyP95}
          </span>
        </Card>

        {/* Estimated Spend */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Estimated Spend</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <CircleDollarSign size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">{currentMetrics.estimatedSpend}</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--muted">
            Inference runtime budget
          </span>
        </Card>
      </div>

      {/* ── Middle Row: Throughput Profile & Workload Breakdown ── */}
      <div className="cx-analytics-two-col">
        {/* Request Throughput Profile */}
        <Card className="cx-analytics-panel">
          <div className="cx-analytics-panel__head">
            <h3>Request Throughput Profile</h3>
            <span className="cx-analytics-panel__badge">{range.toUpperCase()} window</span>
          </div>
          <div className="cx-analytics-bars" onMouseLeave={() => setHoveredIdx(null)}>
            {throughputData.map((pt, i) => {
              const isHovered = hoveredIdx === i
              return (
                <div
                  key={pt.label}
                  className={`cx-analytics-bar-col ${isHovered ? 'is-active' : ''}`}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseOver={() => setHoveredIdx(i)}
                  onFocus={() => setHoveredIdx(i)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${pt.fullDate}: ${pt.reqs} requests`}
                >
                  {isHovered && (
                    <div className="cx-analytics-bar-tooltip">
                      <div className="cx-analytics-bar-tooltip__date">{pt.fullDate}</div>
                      <div className="cx-analytics-bar-tooltip__reqs">
                        {pt.reqs}
                        <span>requests</span>
                      </div>
                      <div className="cx-analytics-bar-tooltip__meta">
                        <span
                          className={`cx-analytics-bar-tooltip__badge ${
                            pt.status === 'Off-Peak'
                              ? 'cx-analytics-bar-tooltip__badge--discount'
                              : pt.status === 'Peak Window'
                              ? 'cx-analytics-bar-tooltip__badge--peak'
                              : 'cx-analytics-bar-tooltip__badge--optimal'
                          }`}
                        >
                          {pt.status}
                        </span>
                        <span className="cx-analytics-bar-tooltip__latency">{pt.latency}</span>
                      </div>
                    </div>
                  )}
                  <div className="cx-analytics-bar" style={{ height: `${pt.height}%` }}>
                    <div className="cx-analytics-bar-cap" />
                  </div>
                  <span className="cx-analytics-bar-label">{pt.label}</span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Workload Breakdown */}
        <Card className="cx-analytics-panel">
          <div className="cx-analytics-panel__head">
            <h3>Workload Breakdown</h3>
            <span className="cx-analytics-panel__badge">System allocation</span>
          </div>
          {[
            ['Prompt Input Tokens', 68],
            ['Generated Output Tokens', 44],
            ['GPU Runtime Utilization', 78],
            ['Successful Requests (200 OK)', 99],
          ].map(([label, value]) => (
            <div className="cx-analytics-progress-row" key={String(label)}>
              <div className="cx-analytics-progress-row__top">
                <span>{label}</span>
                <strong>{value}%</strong>
              </div>
              <div className="cx-analytics-progress">
                <span className="cx-analytics-progress__bar" style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* ── Second Stat Row (3 Cards) ── */}
      <div className="cx-analytics-grid--3" aria-label="Compute & deployment runtime stats">
        {/* Running models */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Running models</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <Play size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">{runningCount}</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--muted">
            {totalDeploymentsCount} total deployments
          </span>
        </Card>

        {/* Wallet time left */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Wallet time left</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <Timer size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">62h 30m</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--muted">
            ₹10,000 at ₹160/hr burn
          </span>
        </Card>

        {/* Free trial left */}
        <Card className="cx-analytics-metric">
          <div className="cx-analytics-metric__top">
            <span className="cx-analytics-metric__label">Free trial left</span>
            <span className="cx-analytics-icon-box" aria-hidden="true">
              <Timer size={18} />
            </span>
          </div>
          <strong className="cx-analytics-metric__val">Not started</strong>
          <span className="cx-analytics-metric__sub cx-analytics-metric__sub--muted">
            1-hour sandbox
          </span>
        </Card>
      </div>

      {/* ── Bottom Row: Models Temp & GPU Utilization Curve ── */}
      <div className="cx-analytics-two-col">
        {/* Existing models & GPU temperature */}
        <Card className="cx-analytics-panel">
          <div className="cx-analytics-panel__head">
            <h3>Existing models & GPU temperature</h3>
            <Thermometer size={16} color="var(--cx-muted, #7e9a8b)" />
          </div>
          <div className="cx-analytics-temp-row">
            <div className="cx-analytics-temp-row__top">
              <span>Qwen2.5-7B-Instruct · L4</span>
              <span className="cx-analytics-temp-row__val cx-analytics-temp-row__val--amber">61°C</span>
            </div>
            <div className="cx-analytics-progress">
              <span className="cx-analytics-progress__bar" style={{ width: '61%' }} />
            </div>
          </div>
          <div className="cx-analytics-temp-row">
            <div className="cx-analytics-temp-row__top">
              <span>Llama-3.1-8B-Instruct · L40S</span>
              <span className="cx-analytics-temp-row__val cx-analytics-temp-row__val--green">53°C</span>
            </div>
            <div className="cx-analytics-progress">
              <span className="cx-analytics-progress__bar" style={{ width: '53%' }} />
            </div>
          </div>
        </Card>

        {/* GPU usage - last 24h */}
        <Card className="cx-analytics-panel">
          <div className="cx-analytics-panel__head">
            <h3>GPU usage - last 24h</h3>
            <span className="cx-analytics-panel__badge">% utilization</span>
          </div>
          <svg className="cx-analytics-graph" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="GPU utilization over the last 24 hours">
            <path d={gpuUsagePoints.fillPath} className="cx-analytics-graph__fill" />
            <path d={gpuUsagePoints.linePath} className="cx-analytics-graph__line" />
          </svg>
          <div className="cx-analytics-graph__axis">
            <span>24h ago</span>
            <span>12h</span>
            <span>now</span>
          </div>
        </Card>
      </div>

      {/* ── Live Recorded Requests & Models (When present in workspace) ── */}
      {report && report.allTimeRequests > 0 && (
        <>
          <div className="cx-section">
            <Card flush>
              <div className="cx-card__pad">
                <h3>Live inference requests by model</h3>
                <p className="cx-muted">Recorded API volume, tokens, and success rates.</p>
              </div>
              <DataTable
                caption="Usage by model"
                stackOnMobile
                columns={liveModelsColumns}
                rows={report.models}
                rowKey={(m) => m.model}
                empty={null}
              />
            </Card>
          </div>
          <div className="cx-section">
            <Card flush>
              <div className="cx-card__pad">
                <h3>Live inference request log</h3>
                <p className="cx-muted">Recent requests executed through your API keys.</p>
              </div>
              <DataTable
                caption="Inference request log"
                stackOnMobile
                columns={liveLogColumns}
                rows={report.log.slice(0, 10)}
                rowKey={(r) => r.id}
                empty={null}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
