import { useState, useRef, useMemo, useEffect, MouseEvent, TouchEvent } from 'react'
import { Activity, TrendingUp, Zap, Cpu, CheckCircle2 } from 'lucide-react'

export type TimeRange = '6H' | '24H' | '7D' | '30D'
export type MetricType = 'throughput' | 'load' | 'spend'

interface TelemetryPoint {
  time: string
  timestamp: string
  throughput: number // k tok/s
  load: number // %
  spend: number // ₹/hr
  latency: string
  activeNodes: number
  status: 'Optimal' | 'High Traffic' | 'Nominal'
}

interface MetricConfig {
  key: MetricType
  label: string
  shortLabel: string
  unit: string
  icon: typeof Activity
  decimals: number
  formatter: (val: number) => string
}

const METRIC_CONFIGS: Record<MetricType, MetricConfig> = {
  throughput: {
    key: 'throughput',
    label: 'Throughput',
    shortLabel: 'Tok / s',
    unit: 'k tok/s',
    icon: TrendingUp,
    decimals: 1,
    formatter: (v) => `${v.toFixed(1)} k tok/s`,
  },
  load: {
    key: 'load',
    label: 'Compute Load',
    shortLabel: 'Load %',
    unit: '%',
    icon: Cpu,
    decimals: 1,
    formatter: (v) => `${v.toFixed(1)}%`,
  },
  spend: {
    key: 'spend',
    label: 'Hourly Burn',
    shortLabel: 'Burn ₹/h',
    unit: '₹/hr',
    icon: Zap,
    decimals: 0,
    formatter: (v) => `₹${Math.round(v)}/hr`,
  },
}

// Telemetry datasets
const TELEMETRY_DATA: Record<TimeRange, TelemetryPoint[]> = {
  '6H': [
    { time: '-6h', timestamp: '6 hours ago · 06:30', throughput: 198.2, load: 72.4, spend: 320, latency: '16.8 ms', activeNodes: 28, status: 'Nominal' },
    { time: '-5.5h', timestamp: '5.5 hours ago · 07:00', throughput: 212.5, load: 74.8, spend: 335, latency: '16.5 ms', activeNodes: 28, status: 'Nominal' },
    { time: '-5h', timestamp: '5 hours ago · 07:30', throughput: 204.8, load: 73.1, spend: 325, latency: '16.9 ms', activeNodes: 28, status: 'Nominal' },
    { time: '-4.5h', timestamp: '4.5 hours ago · 08:00', throughput: 236.4, load: 79.2, spend: 360, latency: '15.9 ms', activeNodes: 30, status: 'Optimal' },
    { time: '-4h', timestamp: '4 hours ago · 08:30', throughput: 228.1, load: 77.6, spend: 350, latency: '16.2 ms', activeNodes: 30, status: 'Nominal' },
    { time: '-3.5h', timestamp: '3.5 hours ago · 09:00', throughput: 258.0, load: 83.5, spend: 395, latency: '15.4 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '-3h', timestamp: '3 hours ago · 09:30', throughput: 247.6, load: 81.7, spend: 380, latency: '15.7 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '-2.5h', timestamp: '2.5 hours ago · 10:00', throughput: 278.4, load: 87.2, spend: 430, latency: '14.9 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '-2h', timestamp: '2 hours ago · 10:30', throughput: 269.0, load: 85.6, spend: 415, latency: '15.1 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '-1.5h', timestamp: '1.5 hours ago · 11:00', throughput: 295.3, load: 91.0, spend: 460, latency: '14.6 ms', activeNodes: 38, status: 'High Traffic' },
    { time: '-1h', timestamp: '1 hour ago · 11:30', throughput: 288.7, load: 89.8, spend: 450, latency: '14.8 ms', activeNodes: 38, status: 'High Traffic' },
    { time: '-30m', timestamp: '30 mins ago · 12:00', throughput: 304.2, load: 93.6, spend: 480, latency: '14.3 ms', activeNodes: 40, status: 'High Traffic' },
    { time: 'NOW', timestamp: 'Realtime Live · 12:30', throughput: 312.8, load: 95.2, spend: 495, latency: '14.1 ms', activeNodes: 40, status: 'Optimal' },
  ],
  '24H': [
    { time: '00:00', timestamp: 'Today 00:00 IST', throughput: 54.2, load: 32.1, spend: 120, latency: '22.4 ms', activeNodes: 12, status: 'Nominal' },
    { time: '01:30', timestamp: 'Today 01:30 IST', throughput: 62.8, load: 35.4, spend: 135, latency: '21.8 ms', activeNodes: 12, status: 'Nominal' },
    { time: '03:00', timestamp: 'Today 03:00 IST', throughput: 58.4, load: 33.8, spend: 130, latency: '22.0 ms', activeNodes: 12, status: 'Nominal' },
    { time: '04:30', timestamp: 'Today 04:30 IST', throughput: 86.1, load: 45.2, spend: 185, latency: '19.9 ms', activeNodes: 16, status: 'Nominal' },
    { time: '06:00', timestamp: 'Today 06:00 IST', throughput: 79.5, load: 42.6, spend: 175, latency: '20.3 ms', activeNodes: 16, status: 'Nominal' },
    { time: '07:30', timestamp: 'Today 07:30 IST', throughput: 112.4, load: 56.8, spend: 235, latency: '18.7 ms', activeNodes: 20, status: 'Optimal' },
    { time: '09:00', timestamp: 'Today 09:00 IST', throughput: 104.0, load: 53.4, spend: 220, latency: '19.1 ms', activeNodes: 20, status: 'Nominal' },
    { time: '10:30', timestamp: 'Today 10:30 IST', throughput: 146.8, load: 66.2, spend: 285, latency: '17.8 ms', activeNodes: 24, status: 'Optimal' },
    { time: '12:00', timestamp: 'Today 12:00 IST', throughput: 138.2, load: 63.5, spend: 270, latency: '18.1 ms', activeNodes: 24, status: 'Nominal' },
    { time: '13:30', timestamp: 'Today 13:30 IST', throughput: 182.5, load: 75.3, spend: 335, latency: '16.9 ms', activeNodes: 28, status: 'Optimal' },
    { time: '15:00', timestamp: 'Today 15:00 IST', throughput: 174.1, load: 72.8, spend: 320, latency: '17.2 ms', activeNodes: 28, status: 'Nominal' },
    { time: '16:30', timestamp: 'Today 16:30 IST', throughput: 225.0, load: 83.4, spend: 390, latency: '15.8 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '18:00', timestamp: 'Today 18:00 IST', throughput: 214.6, load: 80.9, spend: 375, latency: '16.1 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '19:30', timestamp: 'Today 19:30 IST', throughput: 268.4, load: 90.1, spend: 440, latency: '15.0 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '21:00', timestamp: 'Today 21:00 IST', throughput: 258.9, load: 87.5, spend: 425, latency: '15.3 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '22:30', timestamp: 'Today 22:30 IST', throughput: 294.0, load: 94.0, spend: 475, latency: '14.4 ms', activeNodes: 40, status: 'High Traffic' },
    { time: 'NOW', timestamp: 'Realtime Live · 23:59', throughput: 310.5, load: 96.2, spend: 495, latency: '14.0 ms', activeNodes: 40, status: 'Optimal' },
  ],
  '7D': [
    { time: 'Thu', timestamp: 'Thursday Oct 10', throughput: 142.0, load: 64.0, spend: 280, latency: '18.2 ms', activeNodes: 24, status: 'Nominal' },
    { time: 'Fri', timestamp: 'Friday Oct 11', throughput: 185.4, load: 76.2, spend: 340, latency: '16.8 ms', activeNodes: 28, status: 'Optimal' },
    { time: 'Sat', timestamp: 'Saturday Oct 12', throughput: 130.6, load: 58.1, spend: 250, latency: '18.9 ms', activeNodes: 20, status: 'Nominal' },
    { time: 'Sun', timestamp: 'Sunday Oct 13', throughput: 118.2, load: 54.0, spend: 230, latency: '19.5 ms', activeNodes: 20, status: 'Nominal' },
    { time: 'Mon', timestamp: 'Monday Oct 14', throughput: 215.8, load: 82.5, spend: 380, latency: '16.0 ms', activeNodes: 32, status: 'High Traffic' },
    { time: 'Tue', timestamp: 'Tuesday Oct 15', throughput: 260.4, load: 88.7, spend: 430, latency: '15.2 ms', activeNodes: 36, status: 'High Traffic' },
    { time: 'Wed', timestamp: 'Wednesday Oct 16', throughput: 285.0, load: 92.4, spend: 465, latency: '14.7 ms', activeNodes: 38, status: 'High Traffic' },
    { time: 'TODAY', timestamp: 'Today Live', throughput: 310.5, load: 96.2, spend: 495, latency: '14.0 ms', activeNodes: 40, status: 'Optimal' },
  ],
  '30D': [
    { time: 'Sep 16', timestamp: 'Sep 16, 2026', throughput: 65.0, load: 38.0, spend: 140, latency: '21.0 ms', activeNodes: 14, status: 'Nominal' },
    { time: 'Sep 20', timestamp: 'Sep 20, 2026', throughput: 88.5, load: 46.5, spend: 190, latency: '19.7 ms', activeNodes: 18, status: 'Nominal' },
    { time: 'Sep 24', timestamp: 'Sep 24, 2026', throughput: 115.0, load: 55.0, spend: 240, latency: '18.4 ms', activeNodes: 22, status: 'Optimal' },
    { time: 'Sep 28', timestamp: 'Sep 28, 2026', throughput: 142.0, load: 63.5, spend: 280, latency: '17.6 ms', activeNodes: 26, status: 'Nominal' },
    { time: 'Oct 02', timestamp: 'Oct 02, 2026', throughput: 178.4, load: 72.0, spend: 330, latency: '16.7 ms', activeNodes: 28, status: 'Optimal' },
    { time: 'Oct 06', timestamp: 'Oct 06, 2026', throughput: 210.0, load: 79.5, spend: 375, latency: '16.0 ms', activeNodes: 32, status: 'High Traffic' },
    { time: 'Oct 10', timestamp: 'Oct 10, 2026', throughput: 245.5, load: 86.0, spend: 415, latency: '15.3 ms', activeNodes: 36, status: 'High Traffic' },
    { time: 'Oct 14', timestamp: 'Oct 14, 2026', throughput: 280.2, load: 91.5, spend: 460, latency: '14.6 ms', activeNodes: 38, status: 'High Traffic' },
    { time: 'NOW', timestamp: 'Current Live', throughput: 310.5, load: 96.2, spend: 495, latency: '14.0 ms', activeNodes: 40, status: 'Optimal' },
  ],
}

/**
 * Generate Catmull-Rom cubic Bezier spline for smooth natural wave curve
 */
function generateSmoothCurve(points: { x: number; y: number }[], baselineY = 118): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: '', areaPath: '' }
  if (points.length === 1) {
    const p = points[0]
    return {
      linePath: `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
      areaPath: `M ${p.x.toFixed(1)} ${baselineY} L ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${p.x.toFixed(1)} ${baselineY} Z`,
    }
  }

  let linePath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = i < points.length - 2 ? points[i + 2] : p2

    // Cubic tension
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    linePath += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  const firstX = points[0].x.toFixed(1)
  const lastX = points[points.length - 1].x.toFixed(1)
  const areaPath = `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`

  return { linePath, areaPath }
}

export function InteractiveTelemetryGraph() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24H')
  const [activeMetric, setActiveMetric] = useState<MetricType>('throughput')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isHovering, setIsHovering] = useState<boolean>(false)
  const [liveJitter, setLiveJitter] = useState<number>(0)

  const containerRef = useRef<HTMLDivElement>(null)

  // Realtime micro-pulse effect on the apex point
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveJitter((Math.random() - 0.5) * 2.2)
    }, 2800)
    return () => clearInterval(interval)
  }, [])

  const rawData = TELEMETRY_DATA[timeRange]
  const metricCfg = METRIC_CONFIGS[activeMetric]

  // Coordinate projections for compact 900x120 viewBox
  const { points, avgVal, peakVal } = useMemo(() => {
    const values = rawData.map((d, idx) => {
      let val = d[activeMetric]
      if (idx === rawData.length - 1 && timeRange === '24H' && activeMetric === 'throughput') {
        val = Math.max(10, val + liveJitter)
      }
      return val
    })

    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    const padding = (rawMax - rawMin) * 0.12 || 10
    const min = Math.max(0, rawMin - padding)
    const max = rawMax + padding

    const total = values.reduce((acc, v) => acc + v, 0)
    const avg = total / values.length

    // Compact SVG coordinates: X: 14 to 886, Y: 14 to 98 (Height: 120, baseline: 118)
    const SVG_WIDTH = 900
    const Y_TOP = 14
    const Y_BOTTOM = 98

    const n = rawData.length
    const computedPoints = rawData.map((d, i) => {
      const x = 14 + (i / (n - 1)) * (SVG_WIDTH - 28)
      const ratio = (values[i] - min) / (max - min || 1)
      const y = Y_BOTTOM - ratio * (Y_BOTTOM - Y_TOP)
      return { x, y, data: d, value: values[i] }
    })

    return {
      points: computedPoints,
      avgVal: avg,
      peakVal: rawMax,
    }
  }, [rawData, activeMetric, liveJitter, timeRange])

  const { linePath, areaPath } = useMemo(() => {
    return generateSmoothCurve(points.map((p) => ({ x: p.x, y: p.y })), 118)
  }, [points])

  // Mouse / Touch interaction handlers
  const handlePointer = (clientX: number) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0) return

    const relX = clientX - rect.left
    const svgX = Math.max(0, Math.min(900, (relX / rect.width) * 900))

    // Find nearest point
    let closestIdx = 0
    let minDiff = Infinity
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(points[i].x - svgX)
      if (diff < minDiff) {
        minDiff = diff
        closestIdx = i
      }
    }

    setHoverIndex(closestIdx)
    setIsHovering(true)
  }

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    handlePointer(e.clientX)
  }

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches && e.touches.length > 0) {
      handlePointer(e.touches[0].clientX)
    }
  }

  const handlePointerLeave = () => {
    setIsHovering(false)
    setHoverIndex(null)
  }

  // Active point: fallback to the last point when not hovering
  const activePtIndex = hoverIndex !== null ? hoverIndex : points.length - 1
  const activePoint = points[activePtIndex]

  // Tooltip positioning
  const tooltipXPercent = (activePoint.x / 900) * 100
  const isRightHalf = activePoint.x > 450

  return (
    <div className="dash-panel-card dash-panel-card--telemetry glass glass--lift" style={{ position: 'relative' }}>
      {/* Decorative Aurora Halo safely clipped to card rounded corners */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 'inherit' }}>
        <div className="dash-aurora-halo" style={{ top: -60, right: 30 }} />
      </div>

      {/* ── 1. Unified Streamlined Header Bar ────────────────── */}
      <div className="dash-telemetry-header-bar" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="dash-panel-title" style={{ fontSize: '0.82rem' }}>
            Usage · Last {timeRange} <span className="engrave" style={{ marginLeft: 6, opacity: 0.8, fontSize: '0.62rem' }}>Sovereign Telemetry</span>
          </span>
          <div className="dash-live-badge tag--clay" style={{ fontSize: '0.66rem', padding: '2px 7px' }} title="Real-time GPU cluster telemetry streaming">
            <Activity size={11} strokeWidth={2.5} className="spin-or-pulse" />
            <span>Live Sync</span>
          </div>
        </div>

        {/* Action Controls: Metrics + Time Horizon in one row */}
        <div className="dash-telemetry-controls">
          {/* Metric Selector Tabs */}
          <div className="dash-telemetry-tabs">
            {(['throughput', 'load', 'spend'] as MetricType[]).map((m) => {
              const cfg = METRIC_CONFIGS[m]
              const Icon = cfg.icon
              const isActive = activeMetric === m
              return (
                <button
                  key={m}
                  type="button"
                  className={`dash-telemetry-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveMetric(m)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Icon size={11} strokeWidth={2} />
                  <span>{cfg.label}</span>
                </button>
              )
            })}
          </div>

          {/* Time range switchers */}
          <div className="dash-telemetry-tabs">
            {(['6H', '24H', '7D', '30D'] as TimeRange[]).map((range) => (
              <button
                key={range}
                type="button"
                className={`dash-telemetry-tab ${timeRange === range ? 'is-active' : ''}`}
                onClick={() => {
                  setTimeRange(range)
                  setHoverIndex(null)
                }}
                title={`Switch telemetry window to ${range}`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 2. Compact Inline Stats & SLA Bar ───────────────── */}
      <div className="dash-telemetry-stats-bar" style={{ position: 'relative', zIndex: 2 }}>
        <div className="dash-telemetry-stats-group">
          <div className="dash-telemetry-stat-item">
            <span className="dash-telemetry-stat-label">
              {isHovering ? `Selected (${activePoint.data.time})` : 'Current'}
            </span>
            <span className="dash-telemetry-stat-val dash-telemetry-stat-val--highlight">
              {metricCfg.formatter(activePoint.value)}
            </span>
          </div>

          <div className="dash-telemetry-stat-item">
            <span className="dash-telemetry-stat-label">Peak</span>
            <span className="dash-telemetry-stat-val">
              {metricCfg.formatter(peakVal)}
            </span>
          </div>

          <div className="dash-telemetry-stat-item">
            <span className="dash-telemetry-stat-label">Avg</span>
            <span className="dash-telemetry-stat-val">
              {metricCfg.formatter(avgVal)}
            </span>
          </div>

          <div className="dash-telemetry-stat-item">
            <span className="dash-telemetry-stat-label">P95</span>
            <span className="dash-telemetry-stat-val" style={{ color: 'var(--ink-2)' }}>
              {activePoint.data.latency}
            </span>
          </div>

          <div className="dash-telemetry-stat-item">
            <span className="dash-telemetry-stat-label">Nodes</span>
            <span className="dash-telemetry-stat-val" style={{ color: 'var(--ink-2)' }}>
              {activePoint.data.activeNodes} GPUs
            </span>
          </div>
        </div>

        {/* Far right SLA indicator */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: '0.68rem',
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink-3)',
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#76b900' }} />
          <span>Cluster SLA: <strong style={{ color: 'var(--ink)' }}>99.98%</strong></span>
        </div>
      </div>

      {/* ── 3. Compact SVG Graph Canvas (Height: 125px) ───────── */}
      <div
        ref={containerRef}
        className="dash-graph-container"
        style={{ position: 'relative', zIndex: 2, cursor: 'crosshair', userSelect: 'none', height: 125 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handlePointerLeave}
        onTouchMove={handleTouchMove}
        onTouchEnd={handlePointerLeave}
      >
        <svg
          viewBox="0 0 900 120"
          className="dash-graph-svg"
          preserveAspectRatio="none"
          style={{ width: '100%', height: '125px', display: 'block' }}
        >
          <defs>
            {/* Neon green gradient fill under the curve */}
            <linearGradient id="marketplace-usage-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#76b900" stopOpacity="0.32" />
              <stop offset="45%" stopColor="#76b900" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#76b900" stopOpacity="0.00" />
            </linearGradient>

            {/* Glow filter for the stroke line */}
            <filter id="line-glow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#76b900" floodOpacity="0.75" />
            </filter>
          </defs>

          {/* Grid lines with opacity and scale markers */}
          <line x1="0" y1="32" x2="900" y2="32" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" strokeDasharray="2 3" />
          <line x1="0" y1="64" x2="900" y2="64" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" strokeDasharray="2 3" />
          <line x1="0" y1="96" x2="900" y2="96" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" strokeDasharray="2 3" />

          {/* Shaded Area under Curve */}
          <path
            d={areaPath}
            fill="url(#marketplace-usage-grad)"
            style={{ transition: 'd 0.35s ease-out' }}
          />

          {/* Ascending Wave Curve Stroke */}
          <path
            d={linePath}
            fill="none"
            stroke="#a3e635"
            strokeWidth="2.2"
            strokeLinecap="round"
            filter="url(#line-glow)"
            style={{ transition: 'd 0.35s ease-out' }}
          />

          {/* Vertical Crosshair Guide on Hover */}
          {isHovering && (
            <line
              x1={activePoint.x}
              y1="6"
              x2={activePoint.x}
              y2="114"
              stroke="#a3e635"
              strokeWidth="1.2"
              strokeDasharray="3 3"
              opacity="0.85"
            />
          )}

          {/* Interactive Data Point Dots */}
          {points.map((pt, i) => {
            const isHovered = isHovering && hoverIndex === i
            return (
              <g key={i}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 4.5 : 2}
                  fill={isHovered ? '#ffffff' : '#a3e635'}
                  stroke="#76b900"
                  strokeWidth={isHovered ? 1.8 : 0.8}
                  opacity={isHovered ? 1 : 0.6}
                  style={{ transition: 'r 0.15s ease, opacity 0.15s ease' }}
                />
              </g>
            )
          })}

          {/* Live beacon pulsing concentric circles at the latest point */}
          {points.length > 0 && (
            <g>
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="3"
                fill="#a3e635"
              />
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="7"
                fill="none"
                stroke="#76b900"
                opacity="0.6"
              >
                <animate attributeName="r" values="3;9;3" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0;0.8" dur="2.2s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* Active target marker highlight when hovering */}
          {isHovering && (
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="7"
              fill="none"
              stroke="#a3e635"
              strokeWidth="1.8"
              opacity="0.9"
            />
          )}
        </svg>

        {/* ── Floating Tooltip Overlay ──────────────────────── */}
        {isHovering && (
          <div
            className="dash-graph-tooltip"
            style={{
              left: `${tooltipXPercent}%`,
              top: '6px',
              transform: isRightHalf ? 'translate(calc(-100% - 14px), 0)' : 'translate(14px, 0)',
            }}
          >
            <div className="dash-graph-tooltip__time">
              <span style={{ whiteSpace: 'nowrap' }}>{activePoint.data.timestamp}</span>
              <span
                style={{
                  fontSize: '0.62rem',
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'rgba(118, 185, 0, 0.18)',
                  color: 'var(--brand-hi)',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {activePoint.data.status}
              </span>
            </div>

            <div className="dash-graph-tooltip__val">
              {metricCfg.formatter(activePoint.value)}
            </div>

            <div className="dash-graph-tooltip__grid">
              <span className="dash-graph-tooltip__meta-label">Compute Load:</span>
              <span className="dash-graph-tooltip__meta-val">{activePoint.data.load.toFixed(1)}%</span>

              <span className="dash-graph-tooltip__meta-label">Throughput:</span>
              <span className="dash-graph-tooltip__meta-val">{activePoint.data.throughput.toFixed(1)} k tok/s</span>

              <span className="dash-graph-tooltip__meta-label">Burn Rate:</span>
              <span className="dash-graph-tooltip__meta-val">₹{activePoint.data.spend}/hr</span>

              <span className="dash-graph-tooltip__meta-label">P95 Latency:</span>
              <span className="dash-graph-tooltip__meta-val">{activePoint.data.latency}</span>

              <span className="dash-graph-tooltip__meta-label">Active Pods:</span>
              <span className="dash-graph-tooltip__meta-val">{activePoint.data.activeNodes} GPUs</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 4. Compact Timeline Axis Labels ──────────────────── */}
      <div className="dash-axis-timeline" style={{ padding: '3px 4px 0', fontSize: '0.64rem' }}>
        {points
          .filter((_, idx, arr) => {
            if (arr.length <= 8) return true
            const step = Math.floor(arr.length / 6)
            return idx === 0 || idx === arr.length - 1 || idx % step === 0
          })
          .map((pt, idx) => (
            <span
              key={idx}
              style={{
                cursor: 'pointer',
                fontWeight: pt.data.time === 'NOW' || pt.data.time === 'TODAY' ? 700 : 500,
                color: pt.data.time === 'NOW' || pt.data.time === 'TODAY' ? 'var(--brand-hi)' : undefined,
              }}
              onClick={() => {
                const foundIndex = points.findIndex((p) => p.data.time === pt.data.time)
                if (foundIndex !== -1) {
                  setHoverIndex(foundIndex)
                  setIsHovering(true)
                }
              }}
            >
              {pt.data.time}
            </span>
          ))}
      </div>
    </div>
  )
}
