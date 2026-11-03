import { motion } from 'framer-motion'

export interface GanttRow {
  id: string
  title: string
  weeks: [number, number]
  items: string
  color: string
}

/** 12-week bar timeline. Bars grow from the left when scrolled into view. */
export function Gantt({ rows, weeks = 12 }: { rows: GanttRow[]; weeks?: number }) {
  const cols = Array.from({ length: weeks }, (_, i) => i + 1)
  return (
    <div className="gantt-wrap">
      <div className="gantt" role="table" aria-label="MVP delivery timeline in weeks">
        <div className="gantt__row gantt__row--head" role="row">
          <span className="gantt__label engrave" role="columnheader">
            Track
          </span>
          {cols.map((w) => (
            <span key={w} className="gantt__wk" role="columnheader">
              W{w}
            </span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div className="gantt__row" role="row" key={r.id}>
            <span className="gantt__label" role="rowheader">
              <b>{r.title}</b>
            </span>
            <div className="gantt__lane" style={{ gridColumn: `2 / span ${weeks}` }}>
              <motion.div
                className="gantt__bar"
                style={{
                  left: `${((r.weeks[0] - 1) / weeks) * 100}%`,
                  width: `${((r.weeks[1] - r.weeks[0] + 1) / weeks) * 100}%`,
                  ['--c' as string]: r.color,
                }}
                initial={{ scaleX: 0, opacity: 0 }}
                whileInView={{ scaleX: 1, opacity: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.9, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="gantt__txt">{r.items}</span>
                <span className="gantt__range">
                  W{r.weeks[0]}–{r.weeks[1]}
                </span>
              </motion.div>
            </div>
          </div>
        ))}
        <div className="gantt__cols" aria-hidden>
          {cols.map((w) => (
            <i key={w} />
          ))}
        </div>
      </div>
    </div>
  )
}
