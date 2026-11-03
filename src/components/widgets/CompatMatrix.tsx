import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MODELS, QUANTS, gpuById, type Quant } from '../../data/gpus'
import { UTIL, estimateMemory, fmtGB } from '../../lib/calc'

const COLS = ['l4', 'l40s', 'h100', 'h200']
const CONTEXTS = [2048, 4096, 8192, 16384, 32768, 65536, 131072]

/** Model × GPU fit matrix driven by the same memory maths as the placement console. */
export function CompatMatrix() {
  const [quant, setQuant] = useState<Quant>('fp16')
  const [context, setContext] = useState(8192)
  const [conc, setConc] = useState(4)

  const rows = useMemo(
    () =>
      MODELS.map((m) => {
        const mem = estimateMemory({ modelId: m.id, quant, context, concurrency: conc })
        const cells = COLS.map((id) => {
          const g = gpuById(id)
          const usable = (g.vram ?? 0) * UTIL
          return { id, fits: mem.need <= usable, headroom: 1 - mem.need / usable }
        })
        const first = cells.findIndex((c) => c.fits)
        return { m, mem, cells, first }
      }),
    [quant, context, conc],
  )

  return (
    <div className="matrix glass glass--deep">
      <div className="matrix__ctl">
        <div className="field">
          <span className="label">Precision</span>
          <div className="seg" role="group" aria-label="Precision">
            {QUANTS.map((q) => (
              <button key={q.id} aria-pressed={quant === q.id} onClick={() => setQuant(q.id)}>
                {q.id === 'fp16' ? 'FP16' : q.id === 'fp8' ? 'FP8' : 'INT4'}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="mx-ctx">Context length</label>
          <select id="mx-ctx" className="select" value={context} onChange={(e) => setContext(Number(e.target.value))}>
            {CONTEXTS.map((c) => (
              <option key={c} value={c}>
                {c / 1024}K tokens
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label">Concurrent requests</span>
          <div className="seg" role="group" aria-label="Concurrent requests">
            {[1, 4, 16].map((c) => (
              <button key={c} aria-pressed={conc === c} onClick={() => setConc(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table matrix__table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Memory need</th>
              {COLS.map((id) => (
                <th key={id}>
                  {gpuById(id).name} <span className="dim">· {gpuById(id).vramLabel}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m.id}>
                <td>
                  {r.m.name}
                  <small className="matrix__arch">{r.m.arch}</small>
                </td>
                <td className="num readout">{fmtGB(r.mem.need)}</td>
                {r.cells.map((c, i) => (
                  <td key={c.id}>
                    <motion.span
                      layout
                      className={`mcell ${c.fits ? 'mcell--ok' : 'mcell--no'} ${i === r.first ? 'mcell--best' : ''}`}
                      title={c.fits ? `${Math.round(c.headroom * 100)}% headroom` : 'Does not fit'}
                    >
                      {c.fits ? <Check aria-hidden /> : <X aria-hidden />}
                      {c.fits ? `${Math.round(c.headroom * 100)}%` : 'no fit'}
                      {i === r.first && <em>smallest</em>}
                    </motion.span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="matrix__foot">
        Worst case: every concurrent request at full context. Fit = weights + KV cache + runtime overhead ≤ {Math.round(UTIL * 100)}% of device memory.
        Percentages show remaining headroom. Illustrative — production routing validates against measured benchmarks.
      </p>
    </div>
  )
}
