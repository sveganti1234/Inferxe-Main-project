import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { GPUS, gpuById } from '../../data/gpus'
import { inr } from '../../lib/calc'
import { Plate } from '../ui/Glass'

const PRICED = GPUS.filter((g) => g.listRange)
const SCALE = 420

/** Provider range vs suggested list range on a shared ₹/hr axis. */
export function RateRanges() {
  return (
    <div className="ranges">
      <div className="ranges__axis" aria-hidden>
        {[0, 100, 200, 300, 400].map((t) => (
          <span key={t} style={{ left: `${(t / SCALE) * 100}%` }}>
            ₹{t}
          </span>
        ))}
      </div>
      {PRICED.map((g, i) => {
        const [pl, ph] = g.providerRange!
        const [ll, lh] = g.listRange!
        return (
          <div className="ranges__row" key={g.id}>
            <div className="ranges__name">
              <b>{g.name}</b>
              <small>{g.vramLabel}</small>
            </div>
            <div className="ranges__track">
              <motion.i
                className="ranges__prov"
                style={{ left: `${(pl / SCALE) * 100}%` }}
                initial={{ width: 0 }}
                whileInView={{ width: `${((ph - pl) / SCALE) * 100}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.1, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.i
                className="ranges__list"
                style={{ left: `${(ll / SCALE) * 100}%` }}
                initial={{ width: 0 }}
                whileInView={{ width: `${((lh - ll) / SCALE) * 100}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.1, delay: 0.25 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <div className="ranges__val">
              <b className="readout">
                ₹{ll}–{lh}
              </b>
              <small>
                provider ₹{pl}–{ph}
              </small>
            </div>
          </div>
        )
      })}
      <div className="ranges__legend">
        <span>
          <i className="dot ranges__dot-prov" /> Indicative provider on-demand range
        </span>
        <span>
          <i className="dot dot--w" /> Suggested marketplace list rate
        </span>
      </div>
    </div>
  )
}

const PRESETS = [
  { id: 'biz', label: 'Business hours', h: 8, d: 22 },
  { id: 'burst', label: 'Burst testing', h: 2, d: 10 },
  { id: 'always', label: 'Always on', h: 24, d: 30 },
]

function Slider({ label, value, min, max, onChange, readout }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; readout: string }) {
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
        value={value}
        aria-label={label}
        style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/** Monthly infrastructure-cost estimator on the DPR's planning rates. */
export function CostEstimator() {
  const [gpuId, setGpuId] = useState('l40s')
  const [count, setCount] = useState(1)
  const [hours, setHours] = useState(8)
  const [days, setDays] = useState(22)
  const g = gpuById(gpuId)
  const [ll, lh] = g.listRange!
  const [pl, ph] = g.providerRange!
  const hrs = hours * days * count
  const lowL = hrs * ll
  const highL = hrs * lh
  const mid = (lowL + highL) / 2

  return (
    <div className="est">
      <Plate className="est__panel">
        <div className="studio__panel-head">
          <span className="row" style={{ gap: 10 }}>
            <span className="engrave">Cost estimator</span>
          </span>
          <span className="tag">planning rates</span>
        </div>

        <div className="studio__ctl">
          <div className="studio__ctl-head">
            <span className="engrave">GPU</span>
            <span className="readout-label">{g.vramLabel}</span>
          </div>
          <div className="seg studio__seg" role="group" aria-label="GPU">
            {PRICED.map((p) => (
              <button key={p.id} aria-pressed={gpuId === p.id} onClick={() => setGpuId(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="est__presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`chip ${hours === p.h && days === p.d ? 'chip--lime' : ''}`}
              onClick={() => {
                setHours(p.h)
                setDays(p.d)
              }}
            >
              {p.label} · {p.h}h × {p.d}d
            </button>
          ))}
        </div>

        <Slider label="GPUs" value={count} min={1} max={8} onChange={setCount} readout={`${count} × ${g.name}`} />
        <Slider label="Hours per day" value={hours} min={1} max={24} onChange={setHours} readout={`${hours} h`} />
        <Slider label="Days per month" value={days} min={1} max={31} onChange={setDays} readout={`${days} d`} />
      </Plate>

      <div className="est__out glass glass--deep">
        <span className="eyebrow eyebrow--plain">Estimated monthly infrastructure cost</span>
        <div className="est__big">
          <motion.b key={Math.round(mid)} className="readout" initial={{ opacity: 0.4, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            {inr(mid)}
          </motion.b>
          <span className="readout-label">
            range {inr(lowL)} – {inr(highL)}
          </span>
        </div>

        <div className="est__rows">
          <div className="well">
            <span className="readout-label">Runtime</span>
            <b className="readout">{hrs.toLocaleString('en-IN')} GPU-hrs</b>
          </div>
          <div className="well">
            <span className="readout-label">List rate</span>
            <b className="readout">
              ₹{ll}–{lh}/hr
            </b>
          </div>
          <div className="well">
            <span className="readout-label">Per day</span>
            <b className="readout">{inr((mid / days) || 0)}</b>
          </div>
        </div>

        <div className="est__formula equation">
          <span className="var">{hours}h</span>
          <span className="op">×</span>
          <span className="var">{days}d</span>
          <span className="op">×</span>
          <span className="var">{count} GPU</span>
          <span className="op">×</span>
          <span className="var">
            ₹{ll}–{lh}
          </span>
          <span className="op">=</span>
          <span className="var">
            {inr(lowL)}–{inr(highL)}
          </span>
        </div>
        <p className="est__note">
          <Info aria-hidden /> Indicative provider on-demand range for this GPU is ₹{pl}–₹{ph}/hr. Estimates exclude applicable taxes, storage and network charges; real
          rates are verified against live provider rate cards before commercial launch.
        </p>
      </div>
    </div>
  )
}

/** Effective cost per 1M tokens from a GPU rate and a measured throughput. */
export function TokenCostCalc() {
  const [gpuId, setGpuId] = useState('l40s')
  const [tps, setTps] = useState(900)
  const [util, setUtil] = useState(70)
  const g = gpuById(gpuId)
  const rate = g.rate ?? 0
  const tokensPerHour = tps * 3600 * (util / 100)
  const perM = tokensPerHour > 0 ? (rate / tokensPerHour) * 1e6 : 0

  return (
    <div className="est">
      <Plate className="est__panel">
        <div className="studio__panel-head">
          <span className="row" style={{ gap: 10 }}>
            <span className="engrave">Token-equivalent price</span>
          </span>
          <span className="tag">illustrative</span>
        </div>
        <div className="studio__ctl">
          <div className="studio__ctl-head">
            <span className="engrave">GPU</span>
            <span className="readout-label">₹{rate}/hr (mid list rate)</span>
          </div>
          <div className="seg studio__seg" role="group" aria-label="GPU">
            {PRICED.map((p) => (
              <button key={p.id} aria-pressed={gpuId === p.id} onClick={() => setGpuId(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Aggregate throughput" value={tps} min={50} max={5000} onChange={setTps} readout={`${tps.toLocaleString('en-IN')} tok/s`} />
        <Slider label="GPU utilization" value={util} min={5} max={100} onChange={setUtil} readout={`${util}%`} />
      </Plate>
      <div className="est__out glass glass--deep">
        <span className="eyebrow eyebrow--plain">Effective cost per 1M tokens</span>
        <div className="est__big">
          <b className="readout">{inr(perM)}</b>
          <span className="readout-label">per 1M tokens processed</span>
        </div>
        <div className="est__rows est__rows--2">
          <div className="well">
            <span className="readout-label">Tokens / hour</span>
            <b className="readout">{(tokensPerHour / 1e6).toFixed(2)} M</b>
          </div>
          <div className="well">
            <span className="readout-label">GPU rate</span>
            <b className="readout">₹{rate}/hr</b>
          </div>
        </div>
        <div className="est__formula equation">
          <span className="var">₹{rate}/hr</span>
          <span className="op">÷</span>
          <span className="var">{(tokensPerHour / 1e6).toFixed(2)}M tok/hr</span>
          <span className="op">×</span>
          <span className="var">1,000,000</span>
        </div>
        <p className="est__note">
          <Info aria-hidden /> Throughput and utilization are placeholders — Inferxe uses throughput measured per workload from the benchmark corpus. At low concurrency a dedicated GPU
          is costly per token; at high concurrency its hourly rate amortizes across requests.
        </p>
      </div>
    </div>
  )
}
