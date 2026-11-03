import { motion } from 'framer-motion'

export interface Bar {
  label: string
  value: number
  display: string
  note?: string
  tone?: 'lime' | 'cyan' | 'amber' | 'dim'
}

/** Horizontal bar chart with skeuomorphic recessed tracks. */
export function BarChart({ title, bars, max, unit }: { title: string; bars: Bar[]; max: number; unit?: string }) {
  return (
    <figure className="bars">
      <figcaption className="row row--between">
        <span className="engrave">{title}</span>
        {unit && <span className="readout-label">{unit}</span>}
      </figcaption>
      <ul>
        {bars.map((b, i) => (
          <li key={b.label}>
            <span className="bars__label">{b.label}</span>
            <span className="bars__track" aria-hidden>
              <motion.i
                className={`bars__fill bars__fill--${b.tone ?? 'lime'}`}
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.max(2, (b.value / max) * 100)}%` }}
                viewport={{ once: true, amount: 0.8 }}
                transition={{ duration: 1.1, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <span className="bars__val readout">{b.display}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
