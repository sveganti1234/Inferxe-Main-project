import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
} from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Database,
  Flame,
  Layers,
  TrendingUp,
  Zap,
} from 'lucide-react'
import {
  clampTooltipHorizontal,
  downsampleLTTB,
  findNearestIndexByX,
} from '../../lib/chartUtils'

export type TimeRange = '6H' | '24H' | '7D' | '30D'
export type MetricType =
  | 'utilization'
  | 'vram'
  | 'temperature'
  | 'power'
  | 'throughput'
  | 'load'
  | 'spend'

export type TelemetryDataSource = 'live' | 'demo'

export type TelemetryPointStatus =
  | 'Optimal'
  | 'High Traffic'
  | 'Nominal'
  | 'Thermal Warning'
  | 'Degraded'

export interface TelemetryPoint {
  time: string
  timestamp: string
  /** GPU compute utilization (%) */
  utilization: number
  /** GPU VRAM utilization (%) */
  vram: number
  /** Optional absolute VRAM used (GB) */
  vramUsedGb?: number
  /** Optional total VRAM capacity (GB) */
  vramTotalGb?: number
  /** Average GPU core temperature (°C) */
  temperature: number
  /** Average GPU power draw (W) */
  power: number
  /** Optional inference throughput (k tok/s) */
  throughput?: number
  /** Optional legacy compute load (%) */
  load?: number
  /** Optional hourly spend (₹/hr) */
  spend?: number
  /** Optional P95 latency string */
  latency?: string
  /** Optional active GPU count */
  activeNodes?: number
  status: TelemetryPointStatus
}

export interface InteractiveTelemetryGraphProps {
  /**
   * Externally supplied telemetry points.
   * Pass either a TimeRange-keyed record or a flat array for the active time window.
   * When omitted (`undefined`), the component renders illustrative DEMO DATA clearly badged.
   * When explicitly `null` or empty (`[]`), renders an empty/unavailable state instead of demo data.
   */
  data?: Partial<Record<TimeRange, TelemetryPoint[]>> | TelemetryPoint[] | null
  /** Explicit data source classification. Defaults to 'demo' when `data` is undefined, else 'live'. */
  dataSource?: TelemetryDataSource
  /** Optional controlled time range */
  timeRange?: TimeRange
  /** Callback when the user switches the time range */
  onTimeRangeChange?: (range: TimeRange) => void
  /** Initial active metric tab */
  defaultMetric?: MetricType
  /** Metrics shown in the selector bar (defaults to GPU hardware metrics) */
  availableMetrics?: MetricType[]
  /** Maximum rendered points after LTTB downsampling (default 96) */
  maxPoints?: number
  /** Loading state when fetching external telemetry */
  loading?: boolean
  /** Unavailable/error state when backend telemetry cannot be reached */
  unavailable?: boolean
  /** Custom message displayed when `unavailable` is true */
  unavailableMessage?: string
  /** Custom message displayed when live data is empty */
  emptyMessage?: string
  /** Optional header title */
  title?: string
  /** Optional header subtitle */
  subtitle?: string
  /** Optional SLA string (e.g. '99.98%'); omitted in live mode unless supplied */
  slaLabel?: string | null
}

interface MetricConfig {
  key: MetricType
  label: string
  shortLabel: string
  unit: string
  icon: typeof Activity
  decimals: number
  formatter: (val: number) => string
  getValue: (pt: TelemetryPoint) => number
}

const DEFAULT_METRICS: MetricType[] = ['utilization', 'vram', 'temperature', 'power']
const DEFAULT_MAX_RENDERED_POINTS = 96
const MAX_DOT_MARKERS = 36
const SVG_HEIGHT = 125
const DEFAULT_SVG_WIDTH = 900
const TOOLTIP_WIDTH_PX = 216

const SR_ONLY_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const METRIC_CONFIGS: Record<MetricType, MetricConfig> = {
  utilization: {
    key: 'utilization',
    label: 'GPU Utilization',
    shortLabel: 'GPU %',
    unit: '%',
    icon: Cpu,
    decimals: 1,
    formatter: (v) => `${v.toFixed(1)}%`,
    getValue: (pt) => pt.utilization,
  },
  vram: {
    key: 'vram',
    label: 'VRAM Usage',
    shortLabel: 'VRAM %',
    unit: '%',
    icon: Layers,
    decimals: 1,
    formatter: (v) => `${v.toFixed(1)}%`,
    getValue: (pt) => pt.vram,
  },
  temperature: {
    key: 'temperature',
    label: 'Temperature',
    shortLabel: 'Temp °C',
    unit: '°C',
    icon: Flame,
    decimals: 0,
    formatter: (v) => `${Math.round(v)}°C`,
    getValue: (pt) => pt.temperature,
  },
  power: {
    key: 'power',
    label: 'Power Draw',
    shortLabel: 'Power W',
    unit: 'W',
    icon: Zap,
    decimals: 0,
    formatter: (v) => `${Math.round(v)} W`,
    getValue: (pt) => pt.power,
  },
  throughput: {
    key: 'throughput',
    label: 'Throughput',
    shortLabel: 'Tok / s',
    unit: 'k tok/s',
    icon: TrendingUp,
    decimals: 1,
    formatter: (v) => `${v.toFixed(1)} k tok/s`,
    getValue: (pt) => pt.throughput ?? 0,
  },
  load: {
    key: 'load',
    label: 'Compute Load',
    shortLabel: 'Load %',
    unit: '%',
    icon: Activity,
    decimals: 1,
    formatter: (v) => `${v.toFixed(1)}%`,
    getValue: (pt) => pt.load ?? pt.utilization,
  },
  spend: {
    key: 'spend',
    label: 'Hourly Burn',
    shortLabel: 'Burn ₹/h',
    unit: '₹/hr',
    icon: Zap,
    decimals: 0,
    formatter: (v) => `₹${Math.round(v)}/hr`,
    getValue: (pt) => pt.spend ?? 0,
  },
}

// Illustrative DEMO DATA telemetry datasets (clearly badged in UI; zero simulated jitter)
const DEMO_TELEMETRY_DATA: Record<TimeRange, TelemetryPoint[]> = {
  '6H': [
    { time: '-6h', timestamp: 'Sample · 6h ago', utilization: 68.4, vram: 71.2, vramUsedGb: 2278, vramTotalGb: 3200, temperature: 56, power: 345, throughput: 198.2, load: 68.4, spend: 320, latency: '16.8 ms', activeNodes: 28, status: 'Nominal' },
    { time: '-5.5h', timestamp: 'Sample · 5.5h ago', utilization: 71.8, vram: 73.0, vramUsedGb: 2336, vramTotalGb: 3200, temperature: 57, power: 358, throughput: 212.5, load: 71.8, spend: 335, latency: '16.5 ms', activeNodes: 28, status: 'Nominal' },
    { time: '-5h', timestamp: 'Sample · 5h ago', utilization: 70.1, vram: 72.4, vramUsedGb: 2317, vramTotalGb: 3200, temperature: 57, power: 350, throughput: 204.8, load: 70.1, spend: 325, latency: '16.9 ms', activeNodes: 28, status: 'Nominal' },
    { time: '-4.5h', timestamp: 'Sample · 4.5h ago', utilization: 76.2, vram: 76.8, vramUsedGb: 2458, vramTotalGb: 3200, temperature: 59, power: 376, throughput: 236.4, load: 76.2, spend: 360, latency: '15.9 ms', activeNodes: 30, status: 'Optimal' },
    { time: '-4h', timestamp: 'Sample · 4h ago', utilization: 74.6, vram: 75.5, vramUsedGb: 2416, vramTotalGb: 3200, temperature: 58, power: 368, throughput: 228.1, load: 74.6, spend: 350, latency: '16.2 ms', activeNodes: 30, status: 'Nominal' },
    { time: '-3.5h', timestamp: 'Sample · 3.5h ago', utilization: 81.5, vram: 80.1, vramUsedGb: 2563, vramTotalGb: 3200, temperature: 62, power: 405, throughput: 258.0, load: 81.5, spend: 395, latency: '15.4 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '-3h', timestamp: 'Sample · 3h ago', utilization: 79.7, vram: 79.0, vramUsedGb: 2528, vramTotalGb: 3200, temperature: 61, power: 394, throughput: 247.6, load: 79.7, spend: 380, latency: '15.7 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '-2.5h', timestamp: 'Sample · 2.5h ago', utilization: 85.2, vram: 83.4, vramUsedGb: 2669, vramTotalGb: 3200, temperature: 64, power: 428, throughput: 278.4, load: 85.2, spend: 430, latency: '14.9 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '-2h', timestamp: 'Sample · 2h ago', utilization: 83.6, vram: 82.2, vramUsedGb: 2630, vramTotalGb: 3200, temperature: 63, power: 418, throughput: 269.0, load: 83.6, spend: 415, latency: '15.1 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '-1.5h', timestamp: 'Sample · 1.5h ago', utilization: 88.4, vram: 85.9, vramUsedGb: 2749, vramTotalGb: 3200, temperature: 66, power: 446, throughput: 295.3, load: 88.4, spend: 460, latency: '14.6 ms', activeNodes: 38, status: 'High Traffic' },
    { time: '-1h', timestamp: 'Sample · 1h ago', utilization: 87.0, vram: 85.0, vramUsedGb: 2720, vramTotalGb: 3200, temperature: 65, power: 440, throughput: 288.7, load: 87.0, spend: 450, latency: '14.8 ms', activeNodes: 38, status: 'High Traffic' },
    { time: '-30m', timestamp: 'Sample · 30m ago', utilization: 90.6, vram: 87.5, vramUsedGb: 2800, vramTotalGb: 3200, temperature: 68, power: 462, throughput: 304.2, load: 90.6, spend: 480, latency: '14.3 ms', activeNodes: 40, status: 'High Traffic' },
    { time: 'Latest', timestamp: 'Sample · Latest Window', utilization: 91.8, vram: 88.4, vramUsedGb: 2829, vramTotalGb: 3200, temperature: 69, power: 470, throughput: 312.8, load: 91.8, spend: 495, latency: '14.1 ms', activeNodes: 40, status: 'Optimal' },
  ],
  '24H': [
    { time: '00:00', timestamp: 'Sample · 00:00 IST', utilization: 32.1, vram: 44.0, vramUsedGb: 1408, vramTotalGb: 3200, temperature: 45, power: 210, throughput: 54.2, load: 32.1, spend: 120, latency: '22.4 ms', activeNodes: 12, status: 'Nominal' },
    { time: '01:30', timestamp: 'Sample · 01:30 IST', utilization: 35.4, vram: 46.5, vramUsedGb: 1488, vramTotalGb: 3200, temperature: 46, power: 222, throughput: 62.8, load: 35.4, spend: 135, latency: '21.8 ms', activeNodes: 12, status: 'Nominal' },
    { time: '03:00', timestamp: 'Sample · 03:00 IST', utilization: 33.8, vram: 45.2, vramUsedGb: 1446, vramTotalGb: 3200, temperature: 46, power: 218, throughput: 58.4, load: 33.8, spend: 130, latency: '22.0 ms', activeNodes: 12, status: 'Nominal' },
    { time: '04:30', timestamp: 'Sample · 04:30 IST', utilization: 45.2, vram: 53.0, vramUsedGb: 1696, vramTotalGb: 3200, temperature: 49, power: 258, throughput: 86.1, load: 45.2, spend: 185, latency: '19.9 ms', activeNodes: 16, status: 'Nominal' },
    { time: '06:00', timestamp: 'Sample · 06:00 IST', utilization: 42.6, vram: 51.4, vramUsedGb: 1645, vramTotalGb: 3200, temperature: 48, power: 248, throughput: 79.5, load: 42.6, spend: 175, latency: '20.3 ms', activeNodes: 16, status: 'Nominal' },
    { time: '07:30', timestamp: 'Sample · 07:30 IST', utilization: 56.8, vram: 61.5, vramUsedGb: 1968, vramTotalGb: 3200, temperature: 53, power: 298, throughput: 112.4, load: 56.8, spend: 235, latency: '18.7 ms', activeNodes: 20, status: 'Optimal' },
    { time: '09:00', timestamp: 'Sample · 09:00 IST', utilization: 53.4, vram: 59.2, vramUsedGb: 1894, vramTotalGb: 3200, temperature: 52, power: 286, throughput: 104.0, load: 53.4, spend: 220, latency: '19.1 ms', activeNodes: 20, status: 'Nominal' },
    { time: '10:30', timestamp: 'Sample · 10:30 IST', utilization: 66.2, vram: 68.4, vramUsedGb: 2189, vramTotalGb: 3200, temperature: 56, power: 334, throughput: 146.8, load: 66.2, spend: 285, latency: '17.8 ms', activeNodes: 24, status: 'Optimal' },
    { time: '12:00', timestamp: 'Sample · 12:00 IST', utilization: 63.5, vram: 66.8, vramUsedGb: 2138, vramTotalGb: 3200, temperature: 55, power: 322, throughput: 138.2, load: 63.5, spend: 270, latency: '18.1 ms', activeNodes: 24, status: 'Nominal' },
    { time: '13:30', timestamp: 'Sample · 13:30 IST', utilization: 75.3, vram: 75.6, vramUsedGb: 2419, vramTotalGb: 3200, temperature: 59, power: 372, throughput: 182.5, load: 75.3, spend: 335, latency: '16.9 ms', activeNodes: 28, status: 'Optimal' },
    { time: '15:00', timestamp: 'Sample · 15:00 IST', utilization: 72.8, vram: 74.0, vramUsedGb: 2368, vramTotalGb: 3200, temperature: 58, power: 362, throughput: 174.1, load: 72.8, spend: 320, latency: '17.2 ms', activeNodes: 28, status: 'Nominal' },
    { time: '16:30', timestamp: 'Sample · 16:30 IST', utilization: 83.4, vram: 81.8, vramUsedGb: 2618, vramTotalGb: 3200, temperature: 63, power: 416, throughput: 225.0, load: 83.4, spend: 390, latency: '15.8 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '18:00', timestamp: 'Sample · 18:00 IST', utilization: 80.9, vram: 79.6, vramUsedGb: 2547, vramTotalGb: 3200, temperature: 62, power: 402, throughput: 214.6, load: 80.9, spend: 375, latency: '16.1 ms', activeNodes: 32, status: 'High Traffic' },
    { time: '19:30', timestamp: 'Sample · 19:30 IST', utilization: 89.1, vram: 85.4, vramUsedGb: 2733, vramTotalGb: 3200, temperature: 67, power: 448, throughput: 268.4, load: 89.1, spend: 440, latency: '15.0 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '21:00', timestamp: 'Sample · 21:00 IST', utilization: 86.5, vram: 83.9, vramUsedGb: 2685, vramTotalGb: 3200, temperature: 65, power: 434, throughput: 258.9, load: 86.5, spend: 425, latency: '15.3 ms', activeNodes: 36, status: 'High Traffic' },
    { time: '22:30', timestamp: 'Sample · 22:30 IST', utilization: 92.0, vram: 87.8, vramUsedGb: 2810, vramTotalGb: 3200, temperature: 70, power: 468, throughput: 294.0, load: 92.0, spend: 475, latency: '14.4 ms', activeNodes: 40, status: 'High Traffic' },
    { time: 'Latest', timestamp: 'Sample · 23:59 IST', utilization: 93.4, vram: 89.0, vramUsedGb: 2848, vramTotalGb: 3200, temperature: 71, power: 478, throughput: 310.5, load: 93.4, spend: 495, latency: '14.0 ms', activeNodes: 40, status: 'Optimal' },
  ],
  '7D': [
    { time: 'Day 1', timestamp: 'Sample · Day 1', utilization: 64.0, vram: 67.2, vramUsedGb: 2150, vramTotalGb: 3200, temperature: 55, power: 325, throughput: 142.0, load: 64.0, spend: 280, latency: '18.2 ms', activeNodes: 24, status: 'Nominal' },
    { time: 'Day 2', timestamp: 'Sample · Day 2', utilization: 76.2, vram: 76.0, vramUsedGb: 2432, vramTotalGb: 3200, temperature: 60, power: 380, throughput: 185.4, load: 76.2, spend: 340, latency: '16.8 ms', activeNodes: 28, status: 'Optimal' },
    { time: 'Day 3', timestamp: 'Sample · Day 3', utilization: 58.1, vram: 62.5, vramUsedGb: 2000, vramTotalGb: 3200, temperature: 53, power: 302, throughput: 130.6, load: 58.1, spend: 250, latency: '18.9 ms', activeNodes: 20, status: 'Nominal' },
    { time: 'Day 4', timestamp: 'Sample · Day 4', utilization: 54.0, vram: 59.8, vramUsedGb: 1914, vramTotalGb: 3200, temperature: 51, power: 285, throughput: 118.2, load: 54.0, spend: 230, latency: '19.5 ms', activeNodes: 20, status: 'Nominal' },
    { time: 'Day 5', timestamp: 'Sample · Day 5', utilization: 82.5, vram: 81.2, vramUsedGb: 2598, vramTotalGb: 3200, temperature: 63, power: 412, throughput: 215.8, load: 82.5, spend: 380, latency: '16.0 ms', activeNodes: 32, status: 'High Traffic' },
    { time: 'Day 6', timestamp: 'Sample · Day 6', utilization: 88.7, vram: 85.4, vramUsedGb: 2733, vramTotalGb: 3200, temperature: 66, power: 444, throughput: 260.4, load: 88.7, spend: 430, latency: '15.2 ms', activeNodes: 36, status: 'High Traffic' },
    { time: 'Day 7', timestamp: 'Sample · Day 7', utilization: 91.4, vram: 87.6, vramUsedGb: 2803, vramTotalGb: 3200, temperature: 68, power: 462, throughput: 285.0, load: 91.4, spend: 465, latency: '14.7 ms', activeNodes: 38, status: 'High Traffic' },
    { time: 'Latest', timestamp: 'Sample · Latest Day', utilization: 93.4, vram: 89.0, vramUsedGb: 2848, vramTotalGb: 3200, temperature: 70, power: 474, throughput: 310.5, load: 93.4, spend: 495, latency: '14.0 ms', activeNodes: 40, status: 'Optimal' },
  ],
  '30D': [
    { time: 'D-30', timestamp: 'Sample · 30d ago', utilization: 38.0, vram: 48.0, vramUsedGb: 1536, vramTotalGb: 3200, temperature: 47, power: 230, throughput: 65.0, load: 38.0, spend: 140, latency: '21.0 ms', activeNodes: 14, status: 'Nominal' },
    { time: 'D-26', timestamp: 'Sample · 26d ago', utilization: 46.5, vram: 54.2, vramUsedGb: 1734, vramTotalGb: 3200, temperature: 50, power: 262, throughput: 88.5, load: 46.5, spend: 190, latency: '19.7 ms', activeNodes: 18, status: 'Nominal' },
    { time: 'D-22', timestamp: 'Sample · 22d ago', utilization: 55.0, vram: 60.8, vramUsedGb: 1946, vramTotalGb: 3200, temperature: 53, power: 294, throughput: 115.0, load: 55.0, spend: 240, latency: '18.4 ms', activeNodes: 22, status: 'Optimal' },
    { time: 'D-18', timestamp: 'Sample · 18d ago', utilization: 63.5, vram: 67.0, vramUsedGb: 2144, vramTotalGb: 3200, temperature: 56, power: 326, throughput: 142.0, load: 63.5, spend: 280, latency: '17.6 ms', activeNodes: 26, status: 'Nominal' },
    { time: 'D-14', timestamp: 'Sample · 14d ago', utilization: 72.0, vram: 73.5, vramUsedGb: 2352, vramTotalGb: 3200, temperature: 59, power: 364, throughput: 178.4, load: 72.0, spend: 330, latency: '16.7 ms', activeNodes: 28, status: 'Optimal' },
    { time: 'D-10', timestamp: 'Sample · 10d ago', utilization: 79.5, vram: 79.0, vramUsedGb: 2528, vramTotalGb: 3200, temperature: 62, power: 398, throughput: 210.0, load: 79.5, spend: 375, latency: '16.0 ms', activeNodes: 32, status: 'High Traffic' },
    { time: 'D-6', timestamp: 'Sample · 6d ago', utilization: 86.0, vram: 84.0, vramUsedGb: 2688, vramTotalGb: 3200, temperature: 65, power: 432, throughput: 245.5, load: 86.0, spend: 415, latency: '15.3 ms', activeNodes: 36, status: 'High Traffic' },
    { time: 'D-2', timestamp: 'Sample · 2d ago', utilization: 90.5, vram: 87.2, vramUsedGb: 2790, vramTotalGb: 3200, temperature: 68, power: 458, throughput: 280.2, load: 90.5, spend: 460, latency: '14.6 ms', activeNodes: 38, status: 'High Traffic' },
    { time: 'Latest', timestamp: 'Sample · Latest Window', utilization: 93.4, vram: 89.0, vramUsedGb: 2848, vramTotalGb: 3200, temperature: 70, power: 474, throughput: 310.5, load: 93.4, spend: 495, latency: '14.0 ms', activeNodes: 40, status: 'Optimal' },
  ],
}

/**
 * Generate Catmull-Rom cubic Bezier spline for smooth natural wave curve
 */
function generateSmoothCurve(
  points: { x: number; y: number }[],
  baselineY = SVG_HEIGHT - 4,
): { linePath: string; areaPath: string } {
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

function InteractiveTelemetryGraphInner({
  data,
  dataSource,
  timeRange: controlledRange,
  onTimeRangeChange,
  defaultMetric,
  availableMetrics = DEFAULT_METRICS,
  maxPoints = DEFAULT_MAX_RENDERED_POINTS,
  loading = false,
  unavailable = false,
  unavailableMessage = 'Live GPU hardware telemetry is currently unavailable from the backend.',
  emptyMessage = 'No telemetry samples recorded for the selected time window.',
  title,
  subtitle = 'GPU Telemetry',
  slaLabel,
}: InteractiveTelemetryGraphProps = {}) {
  const rawId = useId()
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const gradientId = `telemetry-grad-${safeId}`
  const glowFilterId = `telemetry-glow-${safeId}`

  const metricsList = availableMetrics.length > 0 ? availableMetrics : DEFAULT_METRICS
  const initialMetric =
    defaultMetric && metricsList.includes(defaultMetric) ? defaultMetric : metricsList[0]

  const [internalTimeRange, setInternalTimeRange] = useState<TimeRange>('24H')
  const [activeMetric, setActiveMetric] = useState<MetricType>(initialMetric)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isInspecting, setIsInspecting] = useState<boolean>(false)
  const [containerWidth, setContainerWidth] = useState<number>(DEFAULT_SVG_WIDTH)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return false
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const pendingClientXRef = useRef<number | null>(null)

  const timeRange = controlledRange ?? internalTimeRange

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setPrefersReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Measure actual container pixel width so SVG viewBox matches 1:1 with zero aspect-ratio distortion
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateWidth = () => {
      const measured = Math.round(el.getBoundingClientRect().width)
      if (measured >= 240) {
        setContainerWidth((prev) => (prev === measured ? prev : measured))
      }
    }

    updateWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateWidth())
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [loading, unavailable])

  // Cancel any pending animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  const handleRangeSelect = useCallback(
    (next: TimeRange) => {
      if (controlledRange === undefined) {
        setInternalTimeRange(next)
      }
      onTimeRangeChange?.(next)
      hoverIndexRef.current = null
      setHoverIndex(null)
      setIsInspecting(false)
    },
    [controlledRange, onTimeRangeChange],
  )

  const isUsingDemoFallback = data === undefined
  const effectiveSource: TelemetryDataSource =
    dataSource ?? (isUsingDemoFallback ? 'demo' : 'live')
  const isDemo = effectiveSource === 'demo'

  const rawData: TelemetryPoint[] = useMemo(() => {
    if (isUsingDemoFallback) {
      return DEMO_TELEMETRY_DATA[timeRange]
    }
    if (data === null) {
      return []
    }
    if (Array.isArray(data)) {
      return data
    }
    return data[timeRange] ?? []
  }, [data, isUsingDemoFallback, timeRange])

  const effectiveMetric = metricsList.includes(activeMetric) ? activeMetric : metricsList[0]
  const metricCfg = METRIC_CONFIGS[effectiveMetric]

  // Compute true summary statistics across the FULL raw dataset (before LTTB downsampling)
  const { rawMin, rawMax, avgVal } = useMemo(() => {
    if (rawData.length === 0) {
      return { rawMin: 0, rawMax: 0, avgVal: 0 }
    }
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (let i = 0; i < rawData.length; i++) {
      const v = metricCfg.getValue(rawData[i])
      if (v < min) min = v
      if (v > max) max = v
      sum += v
    }
    return {
      rawMin: min,
      rawMax: max,
      avgVal: sum / rawData.length,
    }
  }, [rawData, metricCfg])

  // LTTB downsampling keeps rendering smooth for 500–10,000+ points while preserving first, last, peaks & valleys
  const renderedData: TelemetryPoint[] = useMemo(() => {
    const safeMax = Math.max(8, Math.floor(maxPoints))
    if (rawData.length <= safeMax) return rawData
    return downsampleLTTB(rawData, safeMax, (pt) => metricCfg.getValue(pt))
  }, [rawData, maxPoints, metricCfg])

  const wasDownsampled = rawData.length > renderedData.length
  const svgWidth = containerWidth

  // Coordinate projections matching measured container width (zero circle/stroke distortion)
  const { points, pointXs } = useMemo(() => {
    if (renderedData.length === 0) {
      return { points: [], pointXs: [] as number[] }
    }

    const padding = (rawMax - rawMin) * 0.12 || 10
    const min = Math.max(0, rawMin - padding)
    const max = rawMax + padding
    const span = max - min || 1

    const X_PAD = 14
    const Y_TOP = 14
    const Y_BOTTOM = SVG_HEIGHT - 22

    const n = renderedData.length
    const xs: number[] = new Array<number>(n)
    const computedPoints = renderedData.map((d, i) => {
      const x = n === 1 ? svgWidth / 2 : X_PAD + (i / (n - 1)) * Math.max(1, svgWidth - X_PAD * 2)
      const val = metricCfg.getValue(d)
      const ratio = (val - min) / span
      const y = Y_BOTTOM - ratio * (Y_BOTTOM - Y_TOP)
      xs[i] = x
      return { x, y, data: d, value: val }
    })

    return { points: computedPoints, pointXs: xs }
  }, [renderedData, rawMin, rawMax, svgWidth, metricCfg])

  const { linePath, areaPath } = useMemo(() => {
    return generateSmoothCurve(
      points.map((p) => ({ x: p.x, y: p.y })),
      SVG_HEIGHT - 4,
    )
  }, [points])

  // rAF-throttled pointer scrubbing with O(log n) binary search and no-op guard on unchanged index
  const processPointerFrame = useCallback(() => {
    rafIdRef.current = null
    const clientX = pendingClientXRef.current
    const el = containerRef.current
    if (clientX === null || !el || pointXs.length === 0) return

    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return

    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const scaledX = (relX / rect.width) * svgWidth
    const closestIdx = findNearestIndexByX(pointXs, scaledX)

    if (closestIdx >= 0 && closestIdx !== hoverIndexRef.current) {
      hoverIndexRef.current = closestIdx
      setHoverIndex(closestIdx)
    }
    setIsInspecting((prev) => (prev ? prev : true))
  }, [pointXs, svgWidth])

  const schedulePointerUpdate = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX
      if (rafIdRef.current === null) {
        if (typeof requestAnimationFrame === 'function') {
          rafIdRef.current = requestAnimationFrame(processPointerFrame)
        } else {
          processPointerFrame()
        }
      }
    },
    [processPointerFrame],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      schedulePointerUpdate(e.clientX)
    },
    [schedulePointerUpdate],
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (e.touches && e.touches.length > 0) {
        schedulePointerUpdate(e.touches[0].clientX)
      }
    },
    [schedulePointerUpdate],
  )

  const handlePointerLeave = useCallback(() => {
    if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    pendingClientXRef.current = null
    if (hoverIndexRef.current !== null) {
      hoverIndexRef.current = null
      setHoverIndex(null)
    }
    setIsInspecting(false)
  }, [])

  // Keyboard scrubbing: ArrowLeft, ArrowRight, Home, End, Escape
  const handleChartKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (points.length === 0) return
      const current =
        hoverIndexRef.current !== null && hoverIndexRef.current < points.length
          ? hoverIndexRef.current
          : points.length - 1

      let nextIdx: number | null = null
      if (e.key === 'ArrowLeft') {
        nextIdx = Math.max(0, current - 1)
      } else if (e.key === 'ArrowRight') {
        nextIdx = Math.min(points.length - 1, current + 1)
      } else if (e.key === 'Home') {
        nextIdx = 0
      } else if (e.key === 'End') {
        nextIdx = points.length - 1
      } else if (e.key === 'Escape') {
        e.preventDefault()
        hoverIndexRef.current = null
        setHoverIndex(null)
        setIsInspecting(false)
        return
      }

      if (nextIdx !== null) {
        e.preventDefault()
        if (nextIdx !== hoverIndexRef.current) {
          hoverIndexRef.current = nextIdx
          setHoverIndex(nextIdx)
        }
        setIsInspecting(true)
      }
    },
    [points.length],
  )

  const handleChartFocus = useCallback(() => {
    if (points.length === 0) return
    if (hoverIndexRef.current === null) {
      const lastIdx = points.length - 1
      hoverIndexRef.current = lastIdx
      setHoverIndex(lastIdx)
    }
    setIsInspecting(true)
  }, [points.length])

  const handleChartBlur = useCallback(() => {
    setIsInspecting(false)
  }, [])

  const activePtIndex =
    points.length === 0
      ? -1
      : hoverIndex !== null && hoverIndex < points.length
        ? hoverIndex
        : points.length - 1
  const activePoint = activePtIndex >= 0 ? points[activePtIndex] : null

  const tooltipPos = useMemo(() => {
    if (!activePoint) return null
    return clampTooltipHorizontal({
      anchorX: activePoint.x,
      containerWidth: svgWidth,
      tooltipWidth: TOOLTIP_WIDTH_PX,
      offset: 14,
      edgePadding: 8,
    })
  }, [activePoint, svgWidth])

  const displaySla = slaLabel !== undefined ? slaLabel : isDemo ? '99.98% (Sample)' : null
  const showAllDots = points.length <= MAX_DOT_MARKERS

  const accessibleSummary = activePoint
    ? `${title || `Telemetry over ${timeRange}`} — ${metricCfg.label}: latest ${metricCfg.formatter(activePoint.value)}, peak ${metricCfg.formatter(rawMax)}, average ${metricCfg.formatter(avgVal)}. ${isDemo ? 'Demo data.' : 'Live telemetry.'} Use Left and Right arrow keys, Home, or End to inspect data points.`
    : `${title || `Telemetry over ${timeRange}`} — ${metricCfg.label}. No telemetry points available.`

  const srReadout = activePoint
    ? `${activePoint.data.timestamp}: ${metricCfg.label} ${metricCfg.formatter(activePoint.value)}, GPU Utilization ${activePoint.data.utilization.toFixed(1)}%, VRAM ${activePoint.data.vram.toFixed(1)}%, Temperature ${Math.round(activePoint.data.temperature)}°C, Power ${Math.round(activePoint.data.power)} W, Status ${activePoint.data.status}.`
    : ''

  const axisPoints = useMemo(() => {
    return points
      .map((pt, index) => ({ pt, index }))
      .filter(({ index }, _, arr) => {
        if (arr.length <= 8) return true
        const step = Math.max(1, Math.floor(arr.length / 6))
        return index === 0 || index === arr.length - 1 || index % step === 0
      })
  }, [points])

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
            {title || `Telemetry · Last ${timeRange}`}{' '}
            <span className="engrave" style={{ marginLeft: 6, opacity: 0.8, fontSize: '0.62rem' }}>
              {subtitle}
            </span>
          </span>

          {isDemo ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 999,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.64rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'rgba(245, 158, 11, 0.16)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.38)',
              }}
              title="Displaying illustrative sample telemetry (not connected to live hardware probes)"
            >
              <Database size={10} />
              <span>DEMO DATA</span>
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 999,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.64rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'rgba(16, 185, 129, 0.16)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.38)',
              }}
              title="Connected to backend GPU telemetry data"
            >
              <Activity size={10} strokeWidth={2.5} />
              <span>LIVE TELEMETRY</span>
            </span>
          )}
        </div>

        {/* Action Controls: Metrics + Time Horizon */}
        <div className="dash-telemetry-controls">
          <div className="dash-telemetry-tabs" role="tablist" aria-label="Telemetry metric selector">
            {metricsList.map((m) => {
              const cfg = METRIC_CONFIGS[m]
              const Icon = cfg.icon
              const isActive = effectiveMetric === m
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`dash-telemetry-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveMetric(m)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <Icon size={11} strokeWidth={2} aria-hidden="true" />
                  <span>{cfg.label}</span>
                </button>
              )
            })}
          </div>

          <div className="dash-telemetry-tabs" role="group" aria-label="Telemetry time range selector">
            {(['6H', '24H', '7D', '30D'] as TimeRange[]).map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={timeRange === range}
                className={`dash-telemetry-tab ${timeRange === range ? 'is-active' : ''}`}
                onClick={() => handleRangeSelect(range)}
                title={`Switch telemetry window to ${range}`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Fixed-Height Loading Skeleton (Zero Layout Shift) ─── */}
      {loading ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading GPU telemetry metrics"
          style={{ position: 'relative', zIndex: 2 }}
        >
          {/* Stats Bar Skeleton */}
          <div
            className="dash-telemetry-stats-bar"
            style={{ minHeight: 36, alignItems: 'center' }}
          >
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {[76, 62, 62, 54, 62].map((w, idx) => (
                <div
                  key={idx}
                  style={{
                    width: w,
                    height: 18,
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.06)',
                  }}
                />
              ))}
            </div>
            <div
              style={{
                width: 110,
                height: 14,
                borderRadius: 6,
                background: 'rgba(255, 255, 255, 0.05)',
              }}
            />
          </div>

          {/* Canvas Skeleton matching exact 125px height */}
          <div
            style={{
              height: SVG_HEIGHT,
              borderRadius: 8,
              background:
                'linear-gradient(180deg, rgba(80, 227, 150, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              fontSize: '0.78rem',
            }}
          >
            Loading GPU telemetry metrics...
          </div>

          {/* Axis Skeleton matching timeline height */}
          <div
            className="dash-axis-timeline"
            style={{ padding: '6px 4px 0', minHeight: 18 }}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: 32,
                  height: 10,
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.05)',
                }}
              />
            ))}
          </div>
        </div>
      ) : unavailable ? (
        <div
          role="alert"
          style={{
            position: 'relative',
            zIndex: 2,
            margin: '12px 0 4px',
            minHeight: SVG_HEIGHT + 36,
            padding: '24px 18px',
            borderRadius: 10,
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: 'rgba(239, 68, 68, 0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: 'var(--ink-2)',
            fontSize: '0.82rem',
          }}
        >
          <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} aria-hidden="true" />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Telemetry Unavailable</div>
            <div style={{ marginTop: 2, color: 'var(--ink-3)' }}>{unavailableMessage}</div>
          </div>
        </div>
      ) : !activePoint ? (
        <div
          role="status"
          style={{
            position: 'relative',
            zIndex: 2,
            margin: '12px 0 4px',
            minHeight: SVG_HEIGHT + 36,
            padding: '32px 18px',
            borderRadius: 10,
            border: '1px dashed var(--line-2, rgba(255,255,255,0.12))',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: '0.82rem',
          }}
        >
          <Activity size={20} style={{ opacity: 0.5, margin: '0 auto 8px' }} aria-hidden="true" />
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No Telemetry Data</div>
          <div style={{ marginTop: 4 }}>{emptyMessage}</div>
        </div>
      ) : (
        <>
          {/* Screen-reader-only live announcement of selected data point */}
          <div aria-live="polite" aria-atomic="true" style={SR_ONLY_STYLE}>
            {srReadout}
          </div>

          {/* ── 2. Compact Inline Stats & SLA Bar ───────────────── */}
          <div className="dash-telemetry-stats-bar" style={{ position: 'relative', zIndex: 2 }}>
            <div className="dash-telemetry-stats-group">
              <div className="dash-telemetry-stat-item">
                <span className="dash-telemetry-stat-label">
                  {isInspecting ? `Selected (${activePoint.data.time})` : 'Latest'}
                </span>
                <span className="dash-telemetry-stat-val dash-telemetry-stat-val--highlight">
                  {metricCfg.formatter(activePoint.value)}
                </span>
              </div>

              <div className="dash-telemetry-stat-item">
                <span className="dash-telemetry-stat-label">Peak</span>
                <span className="dash-telemetry-stat-val">{metricCfg.formatter(rawMax)}</span>
              </div>

              <div className="dash-telemetry-stat-item">
                <span className="dash-telemetry-stat-label">Avg</span>
                <span className="dash-telemetry-stat-val">{metricCfg.formatter(avgVal)}</span>
              </div>

              <div className="dash-telemetry-stat-item">
                <span className="dash-telemetry-stat-label">Temp</span>
                <span
                  className="dash-telemetry-stat-val"
                  style={{ color: activePoint.data.temperature >= 75 ? '#ef4444' : 'var(--ink-2)' }}
                >
                  {Math.round(activePoint.data.temperature)}°C
                </span>
              </div>

              <div className="dash-telemetry-stat-item">
                <span className="dash-telemetry-stat-label">Power</span>
                <span className="dash-telemetry-stat-val" style={{ color: 'var(--ink-2)' }}>
                  {Math.round(activePoint.data.power)} W
                </span>
              </div>

              {activePoint.data.activeNodes !== undefined && (
                <div className="dash-telemetry-stat-item">
                  <span className="dash-telemetry-stat-label">Nodes</span>
                  <span className="dash-telemetry-stat-val" style={{ color: 'var(--ink-2)' }}>
                    {activePoint.data.activeNodes} GPUs
                  </span>
                </div>
              )}
            </div>

            {displaySla && (
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
                <CheckCircle2 size={11} style={{ color: '#50e396' }} aria-hidden="true" />
                <span>
                  Cluster SLA: <strong style={{ color: 'var(--ink)' }}>{displaySla}</strong>
                </span>
              </div>
            )}
          </div>

          {/* ── 3. Aspect-Safe, Keyboard-Accessible SVG Graph Canvas ── */}
          <div
            ref={containerRef}
            className="dash-graph-container"
            tabIndex={0}
            role="slider"
            aria-label={accessibleSummary}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, points.length - 1)}
            aria-valuenow={activePtIndex}
            aria-valuetext={srReadout}
            style={{
              position: 'relative',
              zIndex: 2,
              cursor: 'crosshair',
              userSelect: 'none',
              height: SVG_HEIGHT,
              borderRadius: 8,
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handlePointerLeave}
            onTouchMove={handleTouchMove}
            onTouchEnd={handlePointerLeave}
            onKeyDown={handleChartKeyDown}
            onFocus={handleChartFocus}
            onBlur={handleChartBlur}
          >
            <svg
              viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
              className="dash-graph-svg"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              style={{ width: '100%', height: `${SVG_HEIGHT}px`, display: 'block' }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-hi, #50e396)" stopOpacity="0.28" />
                  <stop offset="45%" stopColor="var(--brand-hi, #50e396)" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="var(--brand-hi, #50e396)" stopOpacity="0.00" />
                </linearGradient>

                <filter id={glowFilterId} x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="2.5"
                    floodColor="var(--brand-hi, #50e396)"
                    floodOpacity="0.65"
                  />
                </filter>
              </defs>

              <line x1="0" y1="32" x2={svgWidth} y2="32" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" strokeDasharray="2 3" />
              <line x1="0" y1="64" x2={svgWidth} y2="64" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" strokeDasharray="2 3" />
              <line x1="0" y1="96" x2={svgWidth} y2="96" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" strokeDasharray="2 3" />

              <path
                d={areaPath}
                fill={`url(#${gradientId})`}
                style={
                  prefersReducedMotion
                    ? undefined
                    : { transition: 'd 0.35s cubic-bezier(0.22, 1, 0.36, 1)' }
                }
              />

              <path
                d={linePath}
                fill="none"
                stroke="var(--brand-hi, #50e396)"
                strokeWidth="2.2"
                strokeLinecap="round"
                filter={`url(#${glowFilterId})`}
                style={
                  prefersReducedMotion
                    ? undefined
                    : { transition: 'd 0.35s cubic-bezier(0.22, 1, 0.36, 1)' }
                }
              />

              {isInspecting && (
                <line
                  x1={activePoint.x}
                  y1="6"
                  x2={activePoint.x}
                  y2={SVG_HEIGHT - 8}
                  stroke="var(--brand-hi2, #6ee0a1)"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  opacity="0.85"
                />
              )}

              {/* Render individual point markers only for concise series (<= 36 points) */}
              {showAllDots &&
                points.map((pt, i) => {
                  const isHovered = isInspecting && activePtIndex === i
                  return (
                    <circle
                      key={i}
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 4.5 : 2}
                      fill={isHovered ? '#ffffff' : 'var(--brand-hi2, #6ee0a1)'}
                      stroke="var(--brand-hi, #50e396)"
                      strokeWidth={isHovered ? 1.8 : 0.8}
                      opacity={isHovered ? 1 : 0.6}
                    />
                  )
                })}

              {/* Latest endpoint dot (pulsing beacon ONLY when live telemetry is active and motion is allowed) */}
              {points.length > 0 && (
                <g>
                  <circle
                    cx={points[points.length - 1].x}
                    cy={points[points.length - 1].y}
                    r="3"
                    fill="var(--brand-hi, #50e396)"
                  />
                  {!isDemo && !prefersReducedMotion && (
                    <circle
                      cx={points[points.length - 1].x}
                      cy={points[points.length - 1].y}
                      r="7"
                      fill="none"
                      stroke="var(--brand-hi, #50e396)"
                      opacity="0.6"
                    >
                      <animate attributeName="r" values="3;9;3" dur="2.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.8;0;0.8" dur="2.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              )}

              {/* Active target ring + center dot (especially helpful when dense points skip individual dots) */}
              {isInspecting && (
                <g>
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.y}
                    r="7"
                    fill="none"
                    stroke="var(--brand-hi, #50e396)"
                    strokeWidth="1.8"
                    opacity="0.9"
                  />
                  {!showAllDots && (
                    <circle
                      cx={activePoint.x}
                      cy={activePoint.y}
                      r="3.5"
                      fill="#ffffff"
                      stroke="var(--brand-hi, #50e396)"
                      strokeWidth="1.6"
                    />
                  )}
                </g>
              )}
            </svg>

            {/* ── Clamped Floating Tooltip Overlay ──────────────────────── */}
            {isInspecting && tooltipPos && (
              <div
                className="dash-graph-tooltip"
                style={{
                  left: `${tooltipPos.leftPx}px`,
                  top: '6px',
                  width: `${Math.min(TOOLTIP_WIDTH_PX, Math.max(160, svgWidth - 16))}px`,
                  transform: 'none',
                }}
              >
                <div className="dash-graph-tooltip__time">
                  <span style={{ whiteSpace: 'nowrap' }}>{activePoint.data.timestamp}</span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background:
                        activePoint.data.status === 'Thermal Warning' || activePoint.data.status === 'Degraded'
                          ? 'rgba(239, 68, 68, 0.18)'
                          : 'rgba(118, 185, 0, 0.18)',
                      color:
                        activePoint.data.status === 'Thermal Warning' || activePoint.data.status === 'Degraded'
                          ? '#ef4444'
                          : 'var(--brand-hi)',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activePoint.data.status}
                  </span>
                </div>

                <div className="dash-graph-tooltip__val">{metricCfg.formatter(activePoint.value)}</div>

                <div className="dash-graph-tooltip__grid">
                  <span className="dash-graph-tooltip__meta-label">GPU Utilization:</span>
                  <span className="dash-graph-tooltip__meta-val">{activePoint.data.utilization.toFixed(1)}%</span>

                  <span className="dash-graph-tooltip__meta-label">VRAM Usage:</span>
                  <span className="dash-graph-tooltip__meta-val">
                    {activePoint.data.vram.toFixed(1)}%
                    {activePoint.data.vramUsedGb !== undefined && activePoint.data.vramTotalGb !== undefined
                      ? ` (${activePoint.data.vramUsedGb}/${activePoint.data.vramTotalGb} GB)`
                      : ''}
                  </span>

                  <span className="dash-graph-tooltip__meta-label">Temperature:</span>
                  <span className="dash-graph-tooltip__meta-val">{Math.round(activePoint.data.temperature)}°C</span>

                  <span className="dash-graph-tooltip__meta-label">Power Draw:</span>
                  <span className="dash-graph-tooltip__meta-val">{Math.round(activePoint.data.power)} W</span>

                  {activePoint.data.activeNodes !== undefined && (
                    <>
                      <span className="dash-graph-tooltip__meta-label">Active Pods:</span>
                      <span className="dash-graph-tooltip__meta-val">{activePoint.data.activeNodes} GPUs</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── 4. Compact Timeline Axis Labels ──────────────────── */}
          <div className="dash-axis-timeline" style={{ padding: '3px 4px 0', fontSize: '0.64rem' }}>
            {axisPoints.map(({ pt, index }) => (
              <span
                key={`${pt.data.time}-${index}`}
                style={{
                  cursor: 'pointer',
                  fontWeight: pt.data.time === 'Latest' || pt.data.time === 'NOW' ? 700 : 500,
                  color:
                    pt.data.time === 'Latest' || pt.data.time === 'NOW' ? 'var(--brand-hi)' : undefined,
                }}
                onClick={() => {
                  hoverIndexRef.current = index
                  setHoverIndex(index)
                  setIsInspecting(true)
                }}
              >
                {pt.data.time}
              </span>
            ))}
          </div>

          {(isDemo || wasDownsampled) && (
            <div
              style={{
                position: 'relative',
                zIndex: 2,
                marginTop: 8,
                fontSize: '0.68rem',
                color: 'var(--ink-4, var(--ink-3))',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {isDemo && (
                <span>
                  DEMO DATA: Illustrative GPU utilization, VRAM, thermal, and power curves. Connect a live hardware telemetry backend to view real-time metrics.
                </span>
              )}
              {wasDownsampled && (
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  LTTB optimized: {renderedData.length} rendered points from {rawData.length.toLocaleString()} samples
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export const InteractiveTelemetryGraph = memo(InteractiveTelemetryGraphInner)
InteractiveTelemetryGraph.displayName = 'InteractiveTelemetryGraph'
