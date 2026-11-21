import { motion } from 'framer-motion'
import type { KeyboardEvent } from 'react'

export interface DialOption<T extends string> {
  id: T
  label: string
}

/**
 * Skeuomorphic rotary selector. Labels are real radio buttons (keyboard + screen-reader
 * friendly); the knob is a tactile, click-to-advance affordance that rotates with a spring.
 */
export function Dial<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: DialOption<T>[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const idx = Math.max(0, options.findIndex((o) => o.id === value))
  const span = 120
  const angleOf = (i: number) => (options.length > 1 ? -span / 2 + (span / (options.length - 1)) * i : 0)
  const angle = angleOf(idx)
  const R = 96

  const cycle = () => onChange(options[(idx + 1) % options.length].id)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), onChange(options[Math.min(idx + 1, options.length - 1)].id))
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), onChange(options[Math.max(idx - 1, 0)].id))
  }

  return (
    <div className="dial" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      <svg className="dial__arc" viewBox="0 0 260 170" aria-hidden>
        <path d="M 34 112 A 96 96 0 0 1 226 112" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
      </svg>

      {options.map((o, i) => {
        const a = (angleOf(i) * Math.PI) / 180
        const x = 130 + R * Math.sin(a)
        const y = 118 - R * Math.cos(a)
        const on = o.id === value
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`dial__label ${on ? 'is-on' : ''}`}
            style={{ left: x, top: y }}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        )
      })}

      <div className="dial__well" aria-hidden>
        <button className="dial__knob-btn" tabIndex={-1} onClick={cycle}>
          <motion.div className="dial__knob" animate={{ rotate: angle }} transition={{ type: 'spring', stiffness: 220, damping: 16, mass: 0.7 }}>
            <span className="dial__grip" />
            <span className="dial__pointer" />
          </motion.div>
        </button>
      </div>
    </div>
  )
}
