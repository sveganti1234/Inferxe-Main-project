import { motion, useScroll, useSpring } from 'framer-motion'
import { useRef, useState } from 'react'

/** Vertical timeline whose rail fills as it scrolls through the viewport. */
export function Timeline({ steps }: { steps: string[] }) {
  const ref = useRef<HTMLOListElement>(null)
  const [seen, setSeen] = useState(-1)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 65%', 'end 55%'] })
  const scaleY = useSpring(scrollYProgress, { stiffness: 110, damping: 26, mass: 0.4 })

  return (
    <ol className="tl" ref={ref}>
      <div className="tl__rail" aria-hidden>
        <motion.i style={{ scaleY }} />
      </div>
      {steps.map((s, i) => (
        <motion.li
          key={s}
          className={`tl__item ${i <= seen ? 'is-lit' : ''}`}
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          onViewportEnter={() => setSeen((v) => Math.max(v, i))}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="tl__node">{String(i + 1).padStart(2, '0')}</span>
          <span className="tl__text">{s}</span>
        </motion.li>
      ))}
    </ol>
  )
}
