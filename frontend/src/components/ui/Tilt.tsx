import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import type { PointerEvent, ReactNode } from 'react'

/** Pointer-driven 3D tilt. Children can use translateZ for depth. */
export function Tilt({
  children,
  max = 8,
  className,
  perspective = 1100,
}: {
  children: ReactNode
  max?: number
  className?: string
  perspective?: number
}) {
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), { stiffness: 140, damping: 18, mass: 0.6 })
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), { stiffness: 140, damping: 18, mass: 0.6 })

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const r = e.currentTarget.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }
  const reset = () => {
    px.set(0)
    py.set(0)
  }

  return (
    <motion.div
      className={className}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{ rotateX, rotateY, transformPerspective: perspective, transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.div>
  )
}
