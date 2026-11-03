import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Info, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MODELS, QUANTS, gpuById, modelById, type Quant } from '../../data/gpus'
import { BUDGET_MAX, defaultWorkload, fmtGB, inr, recommend, type CandidateState, type Priority, type Workload } from '../../lib/calc'
import { Plate } from '../ui/Glass'
import { Dial } from './Dial'

const CONTEXTS = [2048, 4096, 8192, 16384, 32768, 65536, 131072]
const CONCURRENCY = [1, 2, 4, 8, 16, 32, 64]
const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'cost', label: 'COST' },
  { id: 'speed', label: 'SPEED' },
  { id: 'policy', label: 'POLICY' },
]

const STATE_LABEL: Record<CandidateState, string> = {
  recommended: 'Recommended',
  fits: 'Compatible',
  'too-small': 'Not enough VRAM',
  'over-budget': 'Over budget',
  'too-slow': 'Below target',
  'no-price': 'Price unverified',
}

const pct = (v: number, min: number, max: number) => `${((v - min) / (max - min)) * 100}%`

function Fader({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  readout,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (n: number) => void
  readout: string
}) {
  return (
    <div className="studio__ctl">
      <div className="studio__ctl-head">
        <span className="engrave">{label}</span>
        <span className="readout studio__readout">{readout}</span>
      </div>
      <input
        type="range"
        className="fader"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ ['--pct' as string]: pct(value, min, max) }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function GpuStudio({ id = 'studio' }: { id?: string }) {
  const [w, setW] = useState<Workload>(defaultWorkload)
  const set = <K extends keyof Workload>(k: K, v: Workload[K]) => setW((p) => ({ ...p, [k]: v }))

  const model = modelById(w.modelId)
  const { memory, candidates, pick, note } = useMemo(() => recommend(w), [w])
  const total = memory.need
  const seg = (v: number) => `${(v / total) * 100}%`
  const ctxIdx = CONTEXTS.indexOf(w.context)
  const concIdx = CONCURRENCY.indexOf(w.concurrency)

  return (
    <div className="studio" id={id}>
      {/* ── Control panel ── */}
      <Plate className="studio__panel">
        <div className="studio__panel-head">
          <span className="row" style={{ gap: 10 }}>
            <span className="engrave">Placement console</span>
          </span>
          <span className="tag">illustrative</span>
        </div>

        <div className="studio__ctl">
          <div className="studio__ctl-head">
            <span className="engrave">Model</span>
            <span className="readout-label">{model.arch}</span>
          </div>
          <div className="well studio__select">
            <select className="select" value={w.modelId} onChange={(e) => set('modelId', e.target.value)} aria-label="Model">
              {(['Qwen', 'Llama', 'Mistral'] as const).map((f) => (
                <optgroup key={f} label={f}>
                  {MODELS.filter((m) => m.family === f).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="studio__ctl">
          <div className="studio__ctl-head">
            <span className="engrave">Precision</span>
            <span className="readout-label">{QUANTS.find((q) => q.id === w.quant)!.hint}</span>
          </div>
          <div className="seg studio__seg" role="group" aria-label="Precision">
            {QUANTS.map((q) => (
              <button key={q.id} aria-pressed={w.quant === q.id} onClick={() => set('quant', q.id as Quant)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="studio__pair">
          <Fader
            label="Context"
            value={ctxIdx}
            min={0}
            max={CONTEXTS.length - 1}
            onChange={(i) => set('context', CONTEXTS[i])}
            readout={`${(w.context / 1024).toFixed(0)}K tok`}
          />
          <Fader
            label="Concurrency"
            value={concIdx}
            min={0}
            max={CONCURRENCY.length - 1}
            onChange={(i) => set('concurrency', CONCURRENCY[i])}
            readout={`${w.concurrency} req`}
          />
        </div>

        <Fader
          label="Budget cap"
          value={w.budget}
          min={40}
          max={BUDGET_MAX}
          step={10}
          onChange={(n) => set('budget', n)}
          readout={w.budget >= BUDGET_MAX ? 'NO CAP' : `${inr(w.budget)}/hr`}
        />

        <div className="studio__dial-row">
          <div>
            <span className="engrave">Optimise for</span>
            <Dial options={PRIORITIES} value={w.priority} onChange={(p) => set('priority', p)} label="Optimise for" />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {w.priority === 'policy' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }}>
              <Fader label="Latency target" value={w.minTps} min={10} max={300} step={5} onChange={(n) => set('minTps', n)} readout={`≥ ${w.minTps} tok/s`} />
              <p className="studio__hint">
                <Info aria-hidden /> Policy mode also carries region and residency constraints; with a single provider in the MVP, region is applied at the provider-filter step.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </Plate>

      {/* ── Results ── */}
      <div className="studio__results glass glass--deep">
        <div className="studio__mem">
          <div className="row row--between">
            <span className="eyebrow eyebrow--plain">Memory required</span>
            <span className="readout studio__total">{fmtGB(memory.need)}</span>
          </div>
          <div className="membar" role="img" aria-label={`Weights ${fmtGB(memory.weights)}, KV cache ${fmtGB(memory.kv)}, overhead ${fmtGB(memory.overhead)}`}>
            <motion.i className="membar__w" animate={{ width: seg(memory.weights) }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            <motion.i className="membar__k" animate={{ width: seg(memory.kv) }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            <motion.i className="membar__o" animate={{ width: seg(memory.overhead) }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
          </div>
          <div className="membar__legend">
            <span><i className="dot dot--w" /> Weights <b>{fmtGB(memory.weights)}</b></span>
            <span><i className="dot dot--k" /> KV cache <b>{fmtGB(memory.kv)}</b></span>
            <span><i className="dot dot--o" /> Runtime <b>{fmtGB(memory.overhead)}</b></span>
          </div>
        </div>

        <ul className="cand" aria-live="polite">
          {candidates.map((c) => {
            const fill = Math.min(1, memory.need / c.usable)
            const g = gpuById(c.gpuId)
            return (
              <motion.li key={c.key} layout className={`cand__row cand__row--${c.state}`}>
                <div className="cand__name">
                  <strong>{c.label}</strong>
                  <small>{c.total >= 1 ? `${c.total} GB` : g.vramLabel}</small>
                </div>
                <div className="cand__bar" aria-hidden>
                  <motion.i animate={{ width: `${fill * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
                  <span className="cand__limit" />
                </div>
                <div className="cand__meta">
                  <span className="cand__rate readout-label">{c.rate == null ? 'Price on request' : `${inr(c.rate)}/hr`}</span>
                  <span className={`cand__state cand__state--${c.state}`}>
                    {STATE_LABEL[c.state]}
                  </span>
                </div>
              </motion.li>
            )
          })}
        </ul>

        <AnimatePresence mode="wait">
          {pick ? (
            <motion.div key={pick.key + w.priority} className="studio__verdict" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>
              <div className="studio__verdict-head">
                <Sparkles aria-hidden />
                <span>Placement decision</span>
              </div>
              <div className="studio__verdict-main">
                <div>
                  <span className="readout-label">GPU</span>
                  <b className="readout">{pick.label}</b>
                </div>
                <div>
                  <span className="readout-label">Headroom</span>
                  <b className="readout">{Math.round(pick.headroom * 100)}%</b>
                </div>
                <div>
                  <span className="readout-label">Cost</span>
                  <b className="readout">{pick.rate == null ? 'On request' : `${inr(pick.rate)}/hr`}</b>
                </div>
                <div>
                  <span className="readout-label">Decode ceiling</span>
                  <b className="readout">≤ {Math.round(pick.ceiling)} tok/s</b>
                </div>
              </div>
              <p>
                {w.priority === 'cost' && 'Cheapest configuration that holds weights, KV cache and runtime overhead.'}
                {w.priority === 'speed' && 'Highest memory-bandwidth configuration that is compatible and within your budget.'}
                {w.priority === 'policy' && 'Cheapest compatible configuration that meets your latency target.'}
              </p>
              <Link to="/contact" className="link-arrow">
                Run this on Inferxe <ArrowRight aria-hidden />
              </Link>
            </motion.div>
          ) : (
            <motion.div key="none" className="studio__verdict studio__verdict--none" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="studio__verdict-head">
                <Info aria-hidden />
                <span>No placement</span>
              </div>
              <p>{note}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="studio__foot">
          Illustrative maths: weights + KV cache (context × concurrency) + runtime overhead must fit within 90&nbsp;% of device memory. Decode
          ceiling = memory bandwidth ÷ weight bytes — an upper bound, not a benchmark. Production routing validates against measured TTFT and
          tokens/sec. Rates are the DPR&apos;s planning figures.
        </p>
      </div>
    </div>
  )
}
