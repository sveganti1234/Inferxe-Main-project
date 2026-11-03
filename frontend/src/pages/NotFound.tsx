import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { LinkButton } from '../components/ui/Button'
import { Plate } from '../components/ui/Glass'
import { PAGE_INDEX } from '../data/site'
import { usePageMeta } from '../lib/hooks'

export default function NotFound() {
  usePageMeta('Page not found')
  return (
    <section className="section nf">
      <div className="container nf__wrap">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <Plate className="nf__plate">
            <div className="row" style={{ gap: 10 }}>
              <span className="engrave">Routing error</span>
            </div>
            <div className="well nf__lcd">
              <span className="readout readout--amber nf__code">404</span>
              <span className="readout-label">no compatible route found</span>
            </div>
            <h1 className="h2">That page is not on the map.</h1>
            <p className="muted">The address may have changed, or the page was never part of the plan. Here is where you can go instead.</p>
            <div className="row row--wrap">
              <LinkButton to="/" arrow>
                Back to home
              </LinkButton>
              <LinkButton to="/contact" variant="glass">
                Contact us
              </LinkButton>
            </div>
            <ul className="nf__links">
              {PAGE_INDEX.slice(1, 9).map((p) => (
                <li key={p.to}>
                  <Link to={p.to}>{p.title}</Link>
                </li>
              ))}
            </ul>
          </Plate>
        </motion.div>
      </div>
    </section>
  )
}
