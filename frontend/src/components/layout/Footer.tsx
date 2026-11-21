import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FOOTER_COLS, SITE } from '../../data/site'
import { Logo } from '../Logo'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__top">
          <div className="footer__brand">
            <Logo />
            <p>
              A unified control plane between applications and GPU providers. Request compute by what your workload needs — placed by
              compatibility, cost and measured performance.
            </p>
            <div className="row row--wrap" style={{ gap: 10 }}>
              <span className="chip chip--lime">
                {SITE.stage} · {SITE.updated}
              </span>
              <span className="chip">A product of {SITE.parent}</span>
            </div>
          </div>

          {FOOTER_COLS.map((col) => (
            <nav key={col.title} className="footer__col" aria-label={col.title}>
              <h3 className="engrave">{col.title}</h3>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="footer__bottom">
          <span>
            © {new Date().getFullYear()} {SITE.name}, a product of {SITE.parent} ·{' '}
            <a href={SITE.url} className="footer__ext">
              {SITE.domain} <ArrowUpRight aria-hidden />
            </a>
          </span>
          <span className="footer__legal">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href="https://unsplash.com" target="_blank" rel="noreferrer">
              Photography via Unsplash
            </a>
          </span>
        </div>
      </div>
      <div className="footer__wordmark" aria-hidden>
        INFERXE
      </div>
    </footer>
  )
}
