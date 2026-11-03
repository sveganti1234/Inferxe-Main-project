import { motion, useScroll, useTransform } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SplitHeading } from './ui/Reveal'

interface PageHeroProps {
  eyebrow: string
  title: string[]
  lead: ReactNode
  image: string
  crumb: string
  actions?: ReactNode
  aside?: ReactNode
  /** which image area stays visible */
  focus?: string
}

/** Shared hero for inner pages: parallax photograph under a green-black wash. */
export function PageHero({ eyebrow, title, lead, image, crumb, actions, aside, focus = 'center' }: PageHeroProps) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '22%'])
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1.18])
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0.2])

  return (
    <section ref={ref} className="page-hero">
      <motion.div className="page-hero__bg" style={{ y, scale, opacity: fade }}>
        <img src={image} alt="" style={{ objectPosition: focus }} fetchPriority="high" />
      </motion.div>
      <div className="page-hero__wash" aria-hidden />
      <div className="page-hero__grid" aria-hidden />

      <div className="container page-hero__inner">
        <div className="page-hero__copy">
          <motion.nav className="crumbs" aria-label="Breadcrumb" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Link to="/">Home</Link>
            <ChevronRight aria-hidden />
            <span aria-current="page">{crumb}</span>
          </motion.nav>
          <motion.span className="eyebrow" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}>
            {eyebrow}
          </motion.span>
          <SplitHeading lines={title} className="h1 page-hero__title" delay={0.1} />
          <motion.p className="lead" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.45 }}>
            {lead}
          </motion.p>
          {actions && (
            <motion.div className="row row--wrap page-hero__actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.6 }}>
              {actions}
            </motion.div>
          )}
        </div>
        {aside && (
          <motion.div className="page-hero__aside" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            {aside}
          </motion.div>
        )}
      </div>
    </section>
  )
}
