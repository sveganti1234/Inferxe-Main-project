import { Reveal } from './ui/Reveal'
import { Glass } from './ui/Glass'
import { LinkButton } from './ui/Button'

export function CtaBand({
  title = 'Stop mapping workloads to GPU SKUs.',
  lead = 'Describe what your workload needs. Inferxe handles compatibility, placement and provisioning — and shows you the cost before you commit.',
  image = '/images/circuit-glass.webp',
}: {
  title?: string
  lead?: string
  image?: string
}) {
  return (
    <section className="section cta">
      <div className="container">
        <Reveal>
          <Glass className="cta__card" variant="deep">
            <img className="cta__img" src={image} alt="" loading="lazy" />
            <div className="cta__shade" aria-hidden />
            <div className="cta__body">
              <span className="eyebrow">Request access</span>
              <h2 className="h2">{title}</h2>
              <p className="lead">{lead}</p>
              <div className="row row--wrap">
                <LinkButton to="/contact" size="lg" arrow>
                  Request access
                </LinkButton>
                <LinkButton to="/how-it-works" variant="glass" size="lg">
                  See how it works
                </LinkButton>
              </div>
            </div>
          </Glass>
        </Reveal>
      </div>
    </section>
  )
}
