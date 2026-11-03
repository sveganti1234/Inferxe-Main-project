import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { RISKS } from '../../data/content'

const band = (s: number) => (s >= 17 ? 'critical' : s >= 10 ? 'high' : s >= 5 ? 'medium' : 'low')
const BAND_LABEL = { low: 'Low 1–4', medium: 'Medium 5–9', high: 'High 10–16', critical: 'Critical 17–25' } as const

/** 5×5 likelihood × impact matrix with the DPR risk register plotted on it. */
export function RiskMatrix() {
  const [sel, setSel] = useState<{ l: number; i: number }>({ l: 3, i: 5 })
  const impacts = [5, 4, 3, 2, 1]
  const likes = [1, 2, 3, 4, 5]
  const here = RISKS.filter((r) => r.l === sel.l && r.i === sel.i)

  return (
    <div className="risk">
      <div className="risk__grid-wrap glass glass--deep pad-l">
        <div className="risk__axis-y engrave">Impact →</div>
        <div className="risk__grid" role="grid" aria-label="Risk matrix: likelihood versus impact">
          {impacts.map((i) =>
            likes.map((l) => {
              const list = RISKS.filter((r) => r.l === l && r.i === i)
              const s = l * i
              const on = sel.l === l && sel.i === i
              return (
                <button
                  key={`${l}-${i}`}
                  role="gridcell"
                  className={`risk__cell risk__cell--${band(s)} ${on ? 'is-on' : ''} ${list.length ? 'has' : ''}`}
                  onClick={() => setSel({ l, i })}
                  aria-label={`Likelihood ${l}, impact ${i}, score ${s}, ${list.length} risks`}
                  aria-pressed={on}
                >
                  <small>{s}</small>
                  {list.length > 0 && (
                    <motion.b initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 + (l + i) * 0.04 }}>
                      {list.length}
                    </motion.b>
                  )}
                </button>
              )
            }),
          )}
        </div>
        <div className="risk__axis-x engrave">Likelihood →</div>
        <div className="risk__legend">
          {(Object.keys(BAND_LABEL) as (keyof typeof BAND_LABEL)[]).map((b) => (
            <span key={b}>
              <i className={`risk__sw risk__sw--${b}`} /> {BAND_LABEL[b]}
            </span>
          ))}
        </div>
      </div>

      <div className="risk__list glass glass--deep pad-l">
        <div className="row row--between">
          <span className="eyebrow eyebrow--plain">
            L{sel.l} × I{sel.i} = {sel.l * sel.i}
          </span>
          <span className={`chip chip--sm risk__chip risk__chip--${band(sel.l * sel.i)}`}>{BAND_LABEL[band(sel.l * sel.i)]}</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.ul key={`${sel.l}-${sel.i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
            {here.length === 0 && <li className="risk__empty">No risks in this cell. Select a numbered cell to see the register entries and mitigations.</li>}
            {here.map((r) => (
              <li key={r.id}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="tag">{r.id}</span>
                  <b>{r.title}</b>
                </div>
                <p>
                  <span className="dim">Mitigation —</span> {r.mitigation}
                </p>
              </li>
            ))}
          </motion.ul>
        </AnimatePresence>
        <p className="risk__method">Likelihood (L) and Impact (I) are each scored 1–5; Risk Score = L × I. Lifecycle: identify → assess → prioritise → mitigate → monitor.</p>
      </div>
    </div>
  )
}
