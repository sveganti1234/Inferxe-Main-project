import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { STEPS } from '../../data/content'

const SAMPLE = [
  '{ model: "qwen2.5-14b", context: 16384, concurrency: 8, budget_inr_per_hr: 150, region: "IN" }',
  'L4 ✗ (24 GB)   L40S ✓ (48 GB)   H100 ✓ (80 GB)   H200 ✓ (141 GB)   →  3 compatible',
  'score = f(price, latency, throughput, availability)   →   L40S ranks #1 within budget',
  'adapter.create(gpu="L40S")   →   state: provisioning → deploying → running',
  'ttft · tokens/sec · ₹/hr recorded   →   fed back into the next routing decision',
]

export function PipelineSteps() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const t = window.setInterval(() => setActive((a) => (a + 1) % STEPS.length), 2800)
    return () => window.clearInterval(t)
  }, [paused])

  return (
    <div className="pipe" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="pipe__rail" aria-hidden>
        <motion.i animate={{ width: `${(active / (STEPS.length - 1)) * 100}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
      </div>
      <ol className="pipe__steps">
        {STEPS.map((s, i) => (
          <li key={s.n} className={`${i < active ? 'is-done' : ''} ${i === active ? 'is-active' : ''}`}>
            <button onClick={() => setActive(i)} aria-current={i === active ? 'step' : undefined}>
              <span className="pipe__node">
                <s.icon aria-hidden />
              </span>
              <span className="pipe__n">{s.n}</span>
              <strong>{s.title}</strong>
              <small>{s.body}</small>
            </button>
          </li>
        ))}
      </ol>

      <div className="pipe__out well" aria-live="polite">
        <span className="engrave">Sample · step {STEPS[active].n}</span>
        <AnimatePresence mode="wait">
          <motion.code key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28 }}>
            <span className="tok-k">›</span> {SAMPLE[active]}
          </motion.code>
        </AnimatePresence>
      </div>
    </div>
  )
}
