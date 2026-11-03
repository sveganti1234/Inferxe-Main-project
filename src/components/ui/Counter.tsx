import { animate, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

interface CounterProps {
  to: number
  from?: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}

/** Counts up once when scrolled into view. */
export function Counter({ to, from = 0, duration = 1.8, decimals = 0, prefix = '', suffix = '', className }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [v, setV] = useState(reduce ? to : from)

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      setV(to)
      return
    }
    const c = animate(from, to, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: setV })
    return () => c.stop()
  }, [inView, from, to, duration, reduce])

  return (
    <span ref={ref} className={className}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  )
}
