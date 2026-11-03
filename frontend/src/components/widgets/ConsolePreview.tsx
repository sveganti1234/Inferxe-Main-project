import { motion, useInView } from 'framer-motion'
import { Activity, BarChart3, Cpu, FileText, KeyRound, LayoutDashboard, Server } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/** Catmull-Rom → cubic Bézier smoothing for the sample chart. */
function smooth(pts: [number, number][]) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`
  }
  return d
}

const toPts = (vals: number[], w: number, h: number, pad = 6): [number, number][] => {
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  return vals.map((v, i) => [(i / (vals.length - 1)) * w, h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)])
}

const KPIS = [
  { label: 'Active deployments', value: '3', series: [2, 2, 3, 3, 2, 3, 3, 3] },
  { label: 'Est. spend · today', value: '₹1,240', series: [10, 18, 26, 40, 55, 70, 88, 100] },
  { label: 'p95 TTFT', value: '0.42 s', series: [0.6, 0.55, 0.5, 0.52, 0.46, 0.44, 0.43, 0.42] },
  { label: 'Throughput', value: '118 tok/s', series: [80, 92, 88, 104, 110, 106, 116, 118] },
]
const SERIES = [22, 26, 24, 31, 38, 34, 42, 51, 47, 55, 62, 58, 66, 72, 69, 78, 84, 80, 88, 95, 91, 99, 104, 110]
const ROWS = [
  { name: 'qwen-chat-prod', model: 'Qwen2.5 7B', gpu: 'L4', state: 'Running', rate: '₹60/hr' },
  { name: 'llama-8b-api', model: 'Llama 3.1 8B', gpu: 'L40S', state: 'Running', rate: '₹100/hr' },
  { name: 'mistral-eval', model: 'Mistral 7B', gpu: 'L40S', state: 'Provisioning', rate: '₹100/hr' },
]
const REPLY =
  'A 14B model at FP16 needs ≈ 30 GB for weights plus KV cache. An L40S (48 GB) fits with headroom; an L4 (24 GB) does not. Estimated ₹100/hr.'

function Spark({ series }: { series: number[] }) {
  const pts = toPts(series, 100, 28, 3)
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="spark" aria-hidden>
      <motion.path d={smooth(pts)} fill="none" stroke="#9be015" strokeWidth="1.6" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.4, ease: 'easeOut' }} />
    </svg>
  )
}

export function ConsolePreview() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const [chars, setChars] = useState(0)

  useEffect(() => {
    if (!inView) return
    const t = window.setInterval(() => setChars((c) => (c >= REPLY.length + 40 ? 0 : c + 1)), 38)
    return () => window.clearInterval(t)
  }, [inView])

  const pts = toPts(SERIES, 560, 150, 10)
  const line = smooth(pts)
  const area = `${line} L 560 150 L 0 150 Z`

  return (
    <div className="console glass glass--deep" ref={ref}>
      <div className="console__bar">
        <span className="code__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="console__url">Inferxe Console</span>
        <span className="chip chip--amber chip--sm">sample data</span>
      </div>
      <div className="console__body">
        <aside className="console__side" aria-hidden>
          {[LayoutDashboard, Server, Cpu, BarChart3, KeyRound, FileText].map((Icon, i) => (
            <span key={i} className={i === 0 ? 'is-on' : ''}>
              <Icon />
            </span>
          ))}
        </aside>

        <div className="console__main">
          <div className="console__kpis">
            {KPIS.map((k) => (
              <div key={k.label} className="well console__kpi">
                <span className="readout-label">{k.label}</span>
                <b className="readout">{k.value}</b>
                <Spark series={k.series} />
              </div>
            ))}
          </div>

          <div className="console__grid">
            <div className="console__chart well">
              <div className="row row--between">
                <span className="readout-label">Usage · last 24 h</span>
                <span className="row" style={{ gap: 6 }}>
                  <Activity className="console__act" aria-hidden />
                  <span className="readout-label">live</span>
                </span>
              </div>
              <svg viewBox="0 0 560 150" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <linearGradient id="ca" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#76b900" stopOpacity=".45" />
                    <stop offset="1" stopColor="#76b900" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[30, 70, 110].map((y) => (
                  <line key={y} x1="0" x2="560" y1={y} y2={y} stroke="#fff" strokeOpacity=".05" />
                ))}
                <motion.path d={area} fill="url(#ca)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.5 }} />
                <motion.path d={line} fill="none" stroke="#b6f23a" strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.8, ease: 'easeOut' }} />
              </svg>
            </div>

            <div className="console__chat well">
              <span className="readout-label">Inference playground</span>
              <p className="console__q">Which GPU should serve a 14B model at 16k context?</p>
              <p className="console__a">
                {REPLY.slice(0, chars)}
                <i className="console__caret" />
              </p>
            </div>
          </div>

          <div className="console__table">
            {ROWS.map((r) => (
              <div key={r.name} className="console__row">
                <span className="row" style={{ gap: 9 }}>
                  <b>{r.name}</b>
                </span>
                <span>{r.model}</span>
                <span className="tag">{r.gpu}</span>
                <span className="console__state">{r.state}</span>
                <span className="readout-label">{r.rate}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
