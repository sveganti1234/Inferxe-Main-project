import { motion } from 'framer-motion'
import { CircleCheck, CircleDashed, Loader2, Play, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { modelById } from '../../data/gpus'
import { fmtGB, inr, recommend, type Workload } from '../../lib/calc'
import { Button } from '../ui/Button'

const PRESETS: { id: string; label: string; sub: string; w: Workload }[] = [
  {
    id: 'chat',
    label: 'Chat assistant',
    sub: 'Qwen2.5 7B · 8K × 8 · cheapest',
    w: { modelId: 'qwen2.5-7b', quant: 'fp16', context: 8192, concurrency: 8, priority: 'cost', budget: 150, minTps: 40 },
  },
  {
    id: 'long',
    label: 'Long-context 14B',
    sub: 'Qwen2.5 14B · 32K × 4 · fastest',
    w: { modelId: 'qwen2.5-14b', quant: 'fp16', context: 32768, concurrency: 4, priority: 'speed', budget: 400, minTps: 40 },
  },
  {
    id: 'policy',
    label: 'Latency target',
    sub: 'Mistral Small 24B FP8 · ≥ 60 tok/s',
    w: { modelId: 'mistral-small-24b', quant: 'fp8', context: 8192, concurrency: 4, priority: 'policy', budget: 400, minTps: 60 },
  },
  {
    id: 'big',
    label: 'Too large',
    sub: 'Llama 3.1 70B FP16 · 128K × 32',
    w: { modelId: 'llama-3.1-70b', quant: 'fp16', context: 131072, concurrency: 32, priority: 'cost', budget: 1200, minTps: 40 },
  },
]

const STAGES = ['intake', 'filter', 'score', 'select', 'adapter', 'deploy', 'observe'] as const

export function Simulator() {
  const [presetId, setPresetId] = useState('chat')
  const [stage, setStage] = useState(0) // number of completed stages
  const [running, setRunning] = useState(false)
  const preset = PRESETS.find((p) => p.id === presetId)!
  const r = useMemo(() => recommend(preset.w), [preset])
  const model = modelById(preset.w.modelId)
  const ok = !!r.pick

  const lines = useMemo(() => {
    const compat = r.candidates.filter((c) => c.headroom >= 0).length
    return [
      `workload profile validated · ${model.name} · ${preset.w.quant.toUpperCase()} · ${preset.w.context / 1024}K ctx × ${preset.w.concurrency}`,
      `memory need ${fmtGB(r.memory.need)} · ${compat} of ${r.candidates.length} configurations pass hard constraints`,
      `ranking by price · latency · throughput · availability  (mode: ${preset.w.priority})`,
      ok ? `selected ${r.pick!.label} · ${r.pick!.rate == null ? 'price on request' : inr(r.pick!.rate) + '/hr'} · ${Math.round(r.pick!.headroom * 100)}% VRAM headroom` : `no eligible placement — ${r.note}`,
      ok ? `provider adapter: create(gpu="${r.pick!.label}") → instance requested, state=provisioning` : 'skipped — nothing to provision, state stays clean',
      ok ? 'docker + vLLM configured → model loading → endpoint ready, state=running' : 'skipped',
      ok ? 'ttft · tokens/sec · ₹/hr recorded — feeds the next routing decision' : 'controlled error returned to the caller (HTTP 409/400), no orphaned resources',
    ]
  }, [r, model, preset, ok])

  useEffect(() => {
    if (!running) return
    if (stage >= STAGES.length) {
      setRunning(false)
      return
    }
    const t = window.setTimeout(() => setStage((s) => s + 1), 720)
    return () => window.clearTimeout(t)
  }, [running, stage])

  const run = () => {
    setStage(0)
    setRunning(true)
  }
  const reset = () => {
    setRunning(false)
    setStage(0)
  }
  const done = !running && stage >= STAGES.length

  return (
    <div className="sim">
      <div className="sim__side glass glass--deep pad">
        <span className="engrave">Choose a workload</span>
        <div className="sim__presets" role="radiogroup" aria-label="Workload preset">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={p.id === presetId}
              className={`sim__preset ${p.id === presetId ? 'is-on' : ''}`}
              onClick={() => {
                setPresetId(p.id)
                reset()
              }}
            >
              <b>{p.label}</b>
              <small>{p.sub}</small>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Button onClick={run} disabled={running} icon={running ? <Loader2 className="spin" /> : <Play />}>
            {running ? 'Running…' : done ? 'Run again' : 'Run workload'}
          </Button>
          {(running || done) && (
            <Button variant="ghost" onClick={reset} icon={<RotateCcw />} aria-label="Reset simulation">
              Reset
            </Button>
          )}
        </div>
        <p className="sim__note">Simulated with the same compatibility and scoring maths as the placement console. No GPU is provisioned.</p>
      </div>

      <div className="code sim__term">
        <div className="code__bar">
          <span className="code__dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="code__title">inferxe · placement trace</span>
          <span className="chip chip--sm chip--amber" style={{ marginLeft: 'auto' }}>
            simulation
          </span>
        </div>
        <ol className="sim__log" aria-live="polite">
          {STAGES.map((s, i) => {
            const state = i < stage ? (!ok && i >= 4 ? 'skipped' : !ok && i === 3 ? 'failed' : 'done') : i === stage && running ? 'active' : 'pending'
            return (
              <motion.li key={s} className={`sim__row sim__row--${state}`} animate={{ opacity: state === 'pending' ? 0.35 : 1 }}>
                <span className="sim__ic" aria-hidden>
                  {state === 'done' && <CircleCheck />}
                  {state === 'active' && <Loader2 className="spin" />}
                  {state === 'pending' && <CircleDashed />}
                  {state === 'failed' && <TriangleAlert />}
                  {state === 'skipped' && <CircleDashed />}
                </span>
                <span className="sim__stage">{s}</span>
                <span className="sim__text">{state === 'pending' ? '…' : lines[i]}</span>
              </motion.li>
            )
          })}
        </ol>
        <div className="sim__progress" aria-hidden>
          <motion.i animate={{ width: `${(Math.min(stage, STAGES.length) / STAGES.length) * 100}%` }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
        </div>
        {done && (
          <motion.div className={`sim__result ${ok ? '' : 'sim__result--bad'}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {ok ? (
              <>
                Deployment ready on <b>{r.pick!.label}</b>
                {r.pick!.rate != null && (
                  <>
                    {' '}
                    at <b>{inr(r.pick!.rate)}/hr</b> (list rate)
                  </>
                )}
                .
              </>
            ) : (
              <>
                Request rejected cleanly — try a lower precision, shorter context or fewer concurrent requests.
              </>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
