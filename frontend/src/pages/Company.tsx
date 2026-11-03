import { Layers } from 'lucide-react'
import { CtaBand } from '../components/CtaBand'
import { LogoMark } from '../components/Logo'
import { PageHero } from '../components/PageHero'
import { LinkButton } from '../components/ui/Button'
import { Glass, Plate } from '../components/ui/Glass'
import { Reveal, Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { MARKET, MOAT, PRINCIPLES } from '../data/content'
import { SITE } from '../data/site'
import { usePageMeta } from '../lib/hooks'

export default function Company() {
  usePageMeta('Company', 'Inferxe is the decision layer above GPU capacity — a product of Automatrix. Vision, principles, moat, market position and the technology behind it.')
  return (
    <>
      <PageHero
        crumb="Company"
        eyebrow="About Inferxe"
        title={['The decision layer', 'above GPU capacity.']}
        lead="Existing platforms rent capacity. The opportunity is the layer above them — the one that decides which GPU, on which provider, for which workload."
        image="/images/workspace.webp"
        focus="center 40%"
        actions={
          <>
            <LinkButton to="/contact" size="lg" arrow>
              Get in touch
            </LinkButton>
            <LinkButton to="/platform" variant="glass" size="lg">
              Platform &amp; architecture
            </LinkButton>
          </>
        }
        aside={
          <Plate className="about-plate">
            <div className="about-plate__mark">
              <LogoMark size={64} />
            </div>
            <div>
              <span className="engrave">A product of</span>
              <b className="about-plate__name">{SITE.parent}</b>
              <small className="dim">{SITE.domain}</small>
            </div>
            <div className="about-plate__stage">
              <span className="chip chip--lime">
                {SITE.stage} · {SITE.updated}
              </span>
              <span className="chip">
                <Layers aria-hidden /> Live provider: JarvisLabs
              </span>
            </div>
          </Plate>
        }
      />

      <section className="section">
        <div className="container split">
          <div>
            <SectionHead
              eyebrow="Vision"
              title={
                <>
                  Make GPU inference an <span className="grad-text">application workflow</span>.
                </>
              }
            />
            <Reveal delay={0.1}>
              <p className="lead">
                Customers should specify <b>what they need</b>, not <b>how to build it</b>. The platform translates workload requirements into an appropriate GPU configuration, provisions the resource,
                deploys the model and exposes an inference path.
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <p className="muted mt-2">
                Inferxe does not own physical GPUs. It is the intermediary and orchestration layer: it collects requirements, evaluates GPU choices, requests the resource from a provider, deploys an open
                LLM with Docker and vLLM, and records usage, performance and estimated cost.
              </p>
            </Reveal>
          </div>
          <Reveal x={30}>
            <div className="photo-card glass glass--m">
              <img src="/images/team.webp" alt="Engineers collaborating around laptops" loading="lazy" />
              <div className="photo-card__cap">
                <span className="engrave">Built by engineers, for engineers</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <SectionHead center eyebrow="Principles" title="How we build" lead="Six architectural commitments that keep the platform honest as it grows." />
          <Stagger className="grid grid-3">
            {PRINCIPLES.map((p) => (
              <StaggerItem key={p.title}>
                <Glass lift radius="m" className="pad princ">
                  <span className="icon-tile icon-tile--sm">
                    <p.icon />
                  </span>
                  <h3 className="h3">{p.title}</h3>
                  <p>{p.body}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead
            eyebrow="Moat"
            title={
              <>
                What compounds <span className="grad-text">over time</span>.
              </>
            }
            lead="Seven assets that get harder to replicate with every provider, workload and benchmark run."
          />
          <Stagger className="moat" stagger={0.06}>
            {MOAT.map((m, i) => (
              <StaggerItem key={m.title} className={i === MOAT.length - 1 ? 'moat__last' : ''}>
                <Glass lift radius="m" className="pad moat__card">
                  <div className="row row--between">
                    <span className="icon-tile icon-tile--sm">
                      <m.icon />
                    </span>
                    <span className="readout-label">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 className="h3">{m.title}</h3>
                  <p>{m.body}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="section market">
        <div className="container">
          <SectionHead center eyebrow="Market position" title="Competitive position" lead="Marketplaces and providers rent or aggregate capacity. Inferxe is the decision layer above both." />
          <div className="mkt">
            <Reveal>
              <Glass className="pad-l mkt__col" variant="deep">
                <span className="engrave">{MARKET.supply.caption}</span>
                <h3 className="h3">{MARKET.supply.title}</h3>
                <div className="row row--wrap" style={{ gap: 8 }}>
                  {MARKET.supply.names.map((n) => (
                    <span key={n} className="chip">
                      {n}
                    </span>
                  ))}
                </div>
                <p className="dim">{MARKET.supply.note}</p>
              </Glass>
            </Reveal>
            <Reveal delay={0.1}>
              <Glass className="pad-l mkt__col mkt__us" variant="lime">
                <span className="engrave">Decide</span>
                <h3 className="h3">Inferxe · decision layer</h3>
                <p className="muted">Normalized provider and GPU data, measured benchmarks, routing and policy — above every source of capacity.</p>
                <ul>
                  <li>Compatibility first, then scored placement</li>
                  <li>One API and one adapter contract</li>
                  <li>Telemetry and reliability history</li>
                </ul>
              </Glass>
            </Reveal>
            <Reveal delay={0.2}>
              <Glass className="pad-l mkt__col" variant="deep">
                <span className="engrave">{MARKET.intermediaries.caption}</span>
                <h3 className="h3">{MARKET.intermediaries.title}</h3>
                <div className="row row--wrap" style={{ gap: 8 }}>
                  {MARKET.intermediaries.names.map((n) => (
                    <span key={n} className="chip">
                      {n}
                    </span>
                  ))}
                </div>
                <p className="dim">{MARKET.intermediaries.note}</p>
              </Glass>
            </Reveal>
          </div>
          <p className="center dim mkt__note">Named for context only; Inferxe has no affiliation with, or endorsement from, the companies listed.</p>
        </div>
      </section>


      <CtaBand />
    </>
  )
}
