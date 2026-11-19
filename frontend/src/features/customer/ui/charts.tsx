/**
 * Dependency-free chart for real time-series data (stacked columns).
 *
 * The visual chart is decorative for assistive technology (`aria-hidden`); the same data is
 * exposed as a visually hidden table. Days with no records are real zeros and render as a
 * faint baseline tick so the time axis stays continuous.
 */
import { useMemo, useState } from 'react'

export type SeriesTone = 'accent' | 'danger' | 'info' | 'violet'

export interface ChartSeries {
  id: string
  label: string
  tone: SeriesTone
}

export interface ChartDatum {
  key: string
  /** Full label for tooltips and the data table, e.g. "Mon 17 Nov 2026". */
  label: string
  /** Short label for the x axis, e.g. "17 Nov". */
  axisLabel: string
  values: Record<string, number>
}

/** 1/2/5 × 10^k tick step so that `max` fits in at most ~4 steps. */
export function niceTicks(max: number): number[] {
  const safeMax = Math.max(1, max)
  const magnitude = Math.pow(10, Math.floor(Math.log10(safeMax)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => safeMax / s <= 4) ?? magnitude * 10
  const ticks = [0]
  while (ticks[ticks.length - 1] < safeMax) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(6)))
  return ticks
}

function axisIndices(count: number): number[] {
  if (count <= 1) return [0]
  const shown = Math.min(count, count <= 8 ? count : 6)
  return Array.from(new Set(Array.from({ length: shown }, (_, i) => Math.round((i * (count - 1)) / (shown - 1)))))
}

export function StackedColumnChart({
  data,
  series,
  valueLabel,
  tickLabel,
  ariaLabel,
  height = 190,
}: {
  data: ChartDatum[]
  series: ChartSeries[]
  /** Exact value for tooltips / table, e.g. "1,204". */
  valueLabel: (value: number) => string
  /** Compact value for y-axis ticks, e.g. "1.2K". */
  tickLabel: (value: number) => string
  ariaLabel: string
  height?: number
}) {
  const [active, setActive] = useState<number | null>(null)
  const totals = useMemo(() => data.map((d) => series.reduce((sum, s) => sum + (d.values[s.id] ?? 0), 0)), [data, series])
  const ticks = useMemo(() => niceTicks(Math.max(0, ...totals)), [totals])
  const top = ticks[ticks.length - 1]
  const xs = useMemo(() => axisIndices(data.length), [data.length])
  const activeDatum = active !== null ? data[active] : null

  return (
    <figure className="cx-chart" role="group" aria-label={ariaLabel}>
      <div className="cx-chart__plot" style={{ height }} onPointerLeave={() => setActive(null)}>
        <div className="cx-chart__grid" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="cx-chart__gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{tickLabel(t)}</span>
            </div>
          ))}
        </div>
        <div className="cx-chart__cols" aria-hidden="true">
          {data.map((d, i) => (
            <div
              key={d.key}
              className={`cx-chart__col${active === i ? ' is-active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive((a) => (a === i ? null : i))}
            >
              <div className="cx-chart__stack" style={{ height: `${(totals[i] / top) * 100}%` }}>
                {series.map((s) =>
                  (d.values[s.id] ?? 0) > 0 ? (
                    <span key={s.id} className={`cx-chart__seg cx-chart__seg--${s.tone}`} style={{ flexGrow: d.values[s.id] }} />
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
        {activeDatum && active !== null ? (
          <div
            className="cx-chart__tip"
            style={{ left: `clamp(86px, ${((active + 0.5) / data.length) * 100}%, calc(100% - 86px))` }}
            role="status"
          >
            <div className="cx-chart__tip-title">{activeDatum.label}</div>
            {series.map((s) => (
              <div key={s.id} className="cx-chart__tip-row">
                <span className={`cx-chart__swatch cx-chart__seg--${s.tone}`} aria-hidden="true" />
                {s.label}
                <strong>{valueLabel(activeDatum.values[s.id] ?? 0)}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="cx-chart__axis" aria-hidden="true">
        {xs.map((idx, n) => {
          const first = n === 0
          const last = n === xs.length - 1 && xs.length > 1
          return (
            <span
              key={data[idx].key}
              className={`cx-chart__tick${first ? ' is-first' : last ? ' is-last' : ''}`}
              // First and last labels hug the plot edges; the rest are centred under their column.
              style={first || last ? undefined : { left: `${((idx + 0.5) / data.length) * 100}%` }}
            >
              {data[idx].axisLabel}
            </span>
          )
        })}
      </div>

      <figcaption className="cx-chart__legend">
        {series.map((s) => (
          <span key={s.id} className="cx-chart__legend-item">
            <span className={`cx-chart__swatch cx-chart__seg--${s.tone}`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </figcaption>

      <table className="cx-sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.id} scope="col">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              {series.map((s) => (
                <td key={s.id}>{valueLabel(d.values[s.id] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
