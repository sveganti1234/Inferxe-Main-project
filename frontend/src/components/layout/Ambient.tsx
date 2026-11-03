import { motion, useScroll, useSpring } from 'framer-motion'

/** Fixed, GPU-cheap background: drifting aurora blobs, a masked grid and film grain. */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden>
      <div className="ambient__blob ambient__blob--a" />
      <div className="ambient__blob ambient__blob--b" />
      <div className="ambient__blob ambient__blob--c" />
      <div className="ambient__grid" />
      <div className="ambient__noise" />
    </div>
  )
}

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 })
  return <motion.div className="progress" style={{ scaleX }} aria-hidden />
}
