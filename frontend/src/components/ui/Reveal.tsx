import { motion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const

interface RevealProps {
  children: ReactNode
  delay?: number
  y?: number
  x?: number
  scale?: number
  className?: string
  once?: boolean
  amount?: number
}

/** Fade + rise when scrolled into view. */
export function Reveal({ children, delay = 0, y = 28, x = 0, scale = 1, className, once = true, amount = 0.2 }: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, x, scale }}
      whileInView={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      viewport={{ once, amount, margin: '0px 0px -60px 0px' }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

const container = (stagger: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
})
const item: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE } },
}

/** Staggered group — wrap children in <StaggerItem>. */
export function Stagger({
  children,
  className,
  stagger = 0.09,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  stagger?: number
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      variants={container(stagger, delay)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -60px 0px' }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  )
}

/** Word-by-word headline reveal. `lines` renders each string on its own row. */
export function SplitHeading({
  lines,
  className,
  delay = 0,
  accentLast = false,
  as: Tag = 'h1',
}: {
  lines: string[]
  className?: string
  delay?: number
  accentLast?: boolean
  as?: 'h1' | 'h2'
}) {
  const M = motion[Tag]
  let idx = 0
  return (
    <M className={className} aria-label={lines.join(' ')}>
      {lines.map((line, li) => (
        <span key={li} style={{ display: 'block' }} aria-hidden>
          {line.split(' ').map((w, wi) => {
            const i = idx++
            const accent = accentLast && li === lines.length - 1
            return (
              <span key={wi} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
                <motion.span
                  className={accent ? 'grad-text' : undefined}
                  style={{ display: 'inline-block', marginRight: '0.26em' }}
                  initial={{ y: '110%', rotate: 3 }}
                  animate={{ y: 0, rotate: 0 }}
                  transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.07 }}
                >
                  {w}
                </motion.span>
              </span>
            )
          })}
        </span>
      ))}
    </M>
  )
}
