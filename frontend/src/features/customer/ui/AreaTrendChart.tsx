/**
 * Area / line trend for ONE real series (e.g. requests per day). Zero days are real zeros.
 * Decorative for assistive technology; the same numbers are exposed as a visually hidden table.
 */
import { useId, useMemo, useState } from 'react'
import { niceTicks } from './charts'

export interface TrendDatum {
  key: string
  /** Full label for tooltips and the data table, e.g. "Mon 17 Nov 2026". */
  label: string
  /** Short label for the x axis, e.g. "17 Nov". */
  axisLabel: string
  value: number
}

function axisIndices(count: number): number[] {
  if (count <= 1) return [0]
  const shown = Math.min(count, count <= 8 ? count : 6)
  return Array.from(new Set(Array.from({ length: shown }, (_, i) => Math.round((i * (count - 1)) / (shown - 1)))))
}

export function AreaTrendChart({
  data,
  seriesLabel,
  valueLabel,
  tickLabel,
  ariaLabel,
  height = 200,
}: {
  data: TrendDatum[]
  seriesLabel: string
  valueLabel: (value: number) => string
  tickLabel: (value: number) => string
  ariaLabel: string
  height?: number
}) {
  const gradientId = useId()
  const [active, setActive] = useState<number | null>(null)
  const W = 640
  const H = 200
  const padTop = 0
  const padBottom = 0
  const ticks = useMemo(() => niceTicks(Math.max(0, ...data.map((d) => d.value))), [data])
  const top = ticks[ticks.length - 1]
  const xs = useMemo(() => axisIndices(data.length), [data.length])
  const n = data.length
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => padTop + (1 - v / top) * (H - padTop - padBottom)
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z` : ''
  const activeDatum = active !== null ? data[active] : null
  const pct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)

  return (
    <figure className="cx-chart cx-trend" role="group" aria-label={ariaLabel}>
      <div
        className="cx-chart__plot cx-trend__plot"
        style={{ height }}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (rect.width <= 0 || n === 0) return
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
          setActive(n <= 1 ? 0 : Math.round(ratio * (n - 1)))
        }}
      >
        <div className="cx-chart__grid" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="cx-chart__gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{tickLabel(t)}</span>
            </div>
          ))}
        </div>
        <svg className="cx-trend__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cx-accent)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--cx-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
          {line ? <path d={line} className="cx-trend__line" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {activeDatum && active !== null ? (
          <>
            <span className="cx-trend__marker" style={{ left: `${pct(active)}%`, top: `${(y(activeDatum.value) / H) * 100}%` }} aria-hidden="true" />
            <div className="cx-chart__tip" style={{ left: `clamp(86px, ${pct(active)}%, calc(100% - 86px))` }} role="status">
              <div className="cx-chart__tip-title">{activeDatum.label}</div>
              <div className="cx-chart__tip-row">
                <span className="cx-chart__swatch cx-chart__seg--accent" aria-hidden="true" />
                {seriesLabel}
                <strong>{valueLabel(activeDatum.value)}</strong>
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div className="cx-chart__axis" aria-hidden="true">
        {xs.map((idx, k) => {
          const first = k === 0
          const last = k === xs.length - 1 && xs.length > 1
          return (
            <span
              key={data[idx].key}
              className={`cx-chart__tick${first ? ' is-first' : last ? ' is-last' : ''}`}
              style={first || last ? undefined : { left: `${pct(idx)}%` }}
            >
              {data[idx].axisLabel}
            </span>
          )
        })}
      </div>
      <figcaption className="cx-chart__legend">
        <span className="cx-chart__legend-item">
          <span className="cx-chart__swatch cx-chart__seg--accent" aria-hidden="true" />
          {seriesLabel} per day
        </span>
      </figcaption>
      <table className="cx-sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{seriesLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{valueLabel(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
